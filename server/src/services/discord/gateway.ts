import { WebSocket } from 'ws';

/** Gateway intent bits the bot may ask for. */
export const Intents = {
  Guilds: 1 << 0,
  GuildModeration: 1 << 2,
  GuildMessages: 1 << 9,
  /** Privileged: has to be switched on in the Developer Portal. Only asked for when the chat relay is on. */
  MessageContent: 1 << 15,
} as const;

export type GatewayStatusName = 'off' | 'connecting' | 'connected' | 'error';

export interface GatewayStatus {
  state: GatewayStatusName;
  message: string | null;
  /** The bot's own user id, once Discord has said hello. */
  botUserId: string | null;
}

export interface Presence {
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  /** Shown under the bot's name, e.g. "Watching 5/32 players". */
  activity: { name: string; type: 0 | 1 | 2 | 3 | 4 | 5 } | null;
}

export interface GatewayOptions {
  token: string;
  intents: number;
  presence: () => Presence;
  onDispatch: (event: string, data: unknown) => void;
  /** Overridable for tests. */
  url?: string;
}

const DEFAULT_URL = 'wss://gateway.discord.gg';
const MAX_PAYLOAD = 4 * 1024 * 1024;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

/** Codes after which reconnecting cannot help; they need a person to fix something. */
const FATAL: Record<number, string> = {
  4004: 'Discord rejected the bot token',
  4010: 'Discord rejected the connection (invalid shard)',
  4011: 'Discord says this bot is too large for one connection',
  4012: 'Discord rejected the gateway version',
  4013: 'Discord rejected the requested intents',
  4014: 'A privileged intent is switched off. In the Developer Portal, open Bot and enable “Message Content Intent”, then save.',
};

/**
 * A small Discord gateway client: identifies, keeps the heartbeat, resumes after
 * a dropped connection, and reconnects with a growing pause. It only does what
 * the bot needs, which is showing a presence and receiving events.
 * https://discord.com/developers/docs/events/gateway
 */
export class DiscordGateway {
  private socket: WebSocket | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private acked = true;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private backoff = MIN_BACKOFF_MS;
  private stopped = true;
  private current: GatewayStatus = { state: 'off', message: null, botUserId: null };

  constructor(private readonly options: GatewayOptions) {}

  status(): GatewayStatus {
    return { ...this.current };
  }

  start(): void {
    this.stopped = false;
    this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.close(1000);
      setTimeout(() => socket.terminate(), 500).unref();
    }
    this.sessionId = null;
    this.sequence = null;
    this.current = { state: 'off', message: null, botUserId: null };
  }

  /** Sends the bot's status and activity. Called whenever the server's state changes. */
  updatePresence(): void {
    this.send({ op: 3, d: { since: null, activities: this.activities(), status: this.options.presence().status, afk: false } });
  }

  private activities() {
    const activity = this.options.presence().activity;
    return activity ? [{ name: activity.name, type: activity.type }] : [];
  }

  private connect(resume: boolean): void {
    if (this.stopped) return;
    this.current = { ...this.current, state: 'connecting', message: null };
    const base = resume && this.resumeUrl ? this.resumeUrl : (this.options.url ?? DEFAULT_URL);
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${base.replace(/\/$/, '')}/?v=10&encoding=json`, { maxPayload: MAX_PAYLOAD, handshakeTimeout: 10_000, followRedirects: false });
    } catch {
      this.scheduleReconnect(false, 'Could not open the connection');
      return;
    }
    this.socket = socket;
    socket.on('message', (data) => this.receive(data.toString(), socket));
    socket.on('error', () => undefined);
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.clearHeartbeat();
      const fatal = FATAL[code];
      if (fatal) {
        this.stopped = true;
        this.current = { state: 'error', message: fatal, botUserId: this.current.botUserId };
        return;
      }
      this.scheduleReconnect(this.sessionId !== null, code === 1000 ? 'The connection was closed' : `Connection lost (${code || 'no code'}); reconnecting`);
    });
  }

  private receive(text: string, socket: WebSocket): void {
    let frame: { op: number; d: unknown; s: number | null; t: string | null };
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof frame.s === 'number') this.sequence = frame.s;
    switch (frame.op) {
      case 10: {
        const interval = (frame.d as { heartbeat_interval: number }).heartbeat_interval;
        this.startHeartbeat(interval);
        if (this.sessionId && this.sequence !== null) {
          this.send({ op: 6, d: { token: this.options.token, session_id: this.sessionId, seq: this.sequence } });
        } else {
          this.send({
            op: 2,
            d: {
              token: this.options.token,
              intents: this.options.intents,
              properties: { os: process.platform, browser: 'palops', device: 'palops' },
              presence: { since: null, activities: this.activities(), status: this.options.presence().status, afk: false },
            },
          });
        }
        return;
      }
      case 11:
        this.acked = true;
        return;
      case 1:
        this.sendHeartbeat();
        return;
      case 7:
        // Discord asks us to reconnect and pick up where we left off.
        socket.close(4000);
        return;
      case 9:
        // Invalid session: resume if Discord says we can, otherwise start a fresh session.
        if (frame.d !== true) {
          this.sessionId = null;
          this.sequence = null;
        }
        setTimeout(() => (frame.d === true && this.sessionId ? this.send({ op: 6, d: { token: this.options.token, session_id: this.sessionId, seq: this.sequence } }) : this.identifyAgain(socket)), 1000 + Math.random() * 4000).unref();
        return;
      case 0:
        this.dispatch(frame.t ?? '', frame.d);
        return;
    }
  }

  private identifyAgain(socket: WebSocket): void {
    if (this.socket !== socket) return;
    socket.close(4000);
  }

  private dispatch(event: string, data: unknown): void {
    if (event === 'READY') {
      const ready = data as { session_id: string; resume_gateway_url?: string; user?: { id: string } };
      this.sessionId = ready.session_id;
      this.resumeUrl = ready.resume_gateway_url ?? null;
      this.backoff = MIN_BACKOFF_MS;
      this.current = { state: 'connected', message: null, botUserId: ready.user?.id ?? null };
    } else if (event === 'RESUMED') {
      this.backoff = MIN_BACKOFF_MS;
      this.current = { ...this.current, state: 'connected', message: null };
    }
    try {
      this.options.onDispatch(event, data);
    } catch {
      // One bad event handler must not take the connection down.
    }
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat();
    this.acked = true;
    // The first beat is jittered so many clients don't all beat at once.
    const first = setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeat = setInterval(() => this.sendHeartbeat(), interval);
      this.heartbeat.unref();
    }, interval * Math.random());
    first.unref();
    this.heartbeat = first as unknown as NodeJS.Timeout;
  }

  private sendHeartbeat(): void {
    const socket = this.socket;
    if (!socket) return;
    if (!this.acked) {
      // The last beat was never answered: the connection is dead. Reconnect and resume.
      socket.close(4000);
      return;
    }
    this.acked = false;
    this.send({ op: 1, d: this.sequence });
  }

  private send(frame: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private scheduleReconnect(resume: boolean, message: string): void {
    if (this.stopped || this.reconnectTimer) return;
    this.current = { ...this.current, state: 'error', message };
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(resume);
    }, wait);
    this.reconnectTimer.unref();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearTimeout(this.heartbeat);
      clearInterval(this.heartbeat);
    }
    this.heartbeat = undefined;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
