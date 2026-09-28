import { isIPv6 } from 'node:net';
import { WebSocket } from 'ws';

export interface LoggerSocketConfig {
  host: string;
  port: number;
  tls: boolean;
  token: string;
}

export interface LoggerSocketStatus {
  state: 'off' | 'connecting' | 'connected' | 'error';
  message: string | null;
  lastMessageAt: string | null;
}

const MAX_PAYLOAD = 256 * 1024;
const HANDSHAKE_MS = 5000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

const urlFor = (c: LoggerSocketConfig) => `${c.tls ? 'wss' : 'ws'}://${isIPv6(c.host) ? `[${c.host}]` : c.host}:${c.port}/`;

/** Turns a failed connection into something an owner can act on. */
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403/.test(message)) return 'PalServerLogger rejected the token (check websocket_secret in its Config.json)';
  if (/ECONNREFUSED/.test(message)) return 'Nothing is listening there. Is the server running with PalServerLogger, and is websocket_enabled on?';
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return 'That host name can’t be found';
  if (/ETIMEDOUT|timeout|Opening handshake/i.test(message)) return 'PalServerLogger didn’t answer in time';
  return `Couldn’t connect: ${message}`.slice(0, 200);
}

/**
 * A client for the PalServerLogger DLL's websocket (default 127.0.0.1:8765).
 * The token goes in an Authorization header, never a URL. Each message is
 * `{"type":"log","message":"..."}`; other message types aren't documented and
 * are ignored. It reconnects with a growing pause when the server is away.
 * https://github.com/GlitchApotamus/PalServerLogger
 */
export class LoggerSocket {
  private socket: WebSocket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private backoff = MIN_BACKOFF_MS;
  private config: LoggerSocketConfig | undefined;
  private current: LoggerSocketStatus = { state: 'off', message: null, lastMessageAt: null };

  constructor(private readonly onLine: (message: string) => void) {}

  start(config: LoggerSocketConfig): void {
    this.stop();
    this.config = config;
    this.backoff = MIN_BACKOFF_MS;
    this.connect();
  }

  stop(): void {
    this.config = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.terminate();
    }
    this.current = { state: 'off', message: null, lastMessageAt: null };
  }

  status(): LoggerSocketStatus {
    return { ...this.current };
  }

  private connect(): void {
    const config = this.config;
    if (!config) return;
    this.current = { ...this.current, state: 'connecting', message: null };
    let socket: WebSocket;
    try {
      socket = new WebSocket(urlFor(config), { headers: { Authorization: `Bearer ${config.token}` }, handshakeTimeout: HANDSHAKE_MS, maxPayload: MAX_PAYLOAD, followRedirects: false });
    } catch (err) {
      this.fail(explain(err));
      return;
    }
    this.socket = socket;
    socket.on('open', () => {
      this.backoff = MIN_BACKOFF_MS;
      this.current = { ...this.current, state: 'connected', message: null };
    });
    socket.on('message', (data) => this.receive(data.toString()));
    socket.on('unexpected-response', (_req, res) => {
      this.fail(explain(new Error(`HTTP ${res.statusCode}`)));
      socket.terminate();
    });
    socket.on('error', (err) => this.fail(explain(err)));
    socket.on('close', () => {
      if (this.socket === socket) this.fail(this.current.state === 'error' ? this.current.message : 'The connection closed');
    });
  }

  private receive(text: string): void {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    if (body && typeof body === 'object' && (body as { type?: unknown }).type === 'log' && typeof (body as { message?: unknown }).message === 'string') {
      this.current.lastMessageAt = new Date().toISOString();
      this.onLine((body as { message: string }).message);
    }
  }

  private fail(message: string | null): void {
    if (!this.config) return;
    this.current = { ...this.current, state: 'error', message };
    const socket = this.socket;
    this.socket = undefined;
    socket?.removeAllListeners();
    socket?.on('error', () => undefined);
    socket?.terminate();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, this.backoff);
    this.timer.unref();
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  /** Tries to connect once and reports how it went, without keeping the connection. */
  static probe(config: LoggerSocketConfig): Promise<{ ok: boolean; message: string | null }> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      const done = (result: { ok: boolean; message: string | null }) => {
        socket?.removeAllListeners();
        socket?.on('error', () => undefined);
        socket?.terminate();
        resolve(result);
      };
      try {
        socket = new WebSocket(urlFor(config), { headers: { Authorization: `Bearer ${config.token}` }, handshakeTimeout: HANDSHAKE_MS, maxPayload: MAX_PAYLOAD, followRedirects: false });
      } catch (err) {
        return resolve({ ok: false, message: explain(err) });
      }
      socket.on('open', () => done({ ok: true, message: null }));
      socket.on('unexpected-response', (_req, res) => done({ ok: false, message: explain(new Error(`HTTP ${res.statusCode}`)) }));
      socket.on('error', (err) => done({ ok: false, message: explain(err) }));
    });
  }
}
