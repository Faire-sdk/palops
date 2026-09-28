import { isIPv6 } from 'node:net';
import type {
  PalworldAdapter,
  PalworldMetrics,
  PalworldPlayer,
  PalworldServerInfo,
  PalworldSettings,
} from './types.js';
import { PalworldError } from './types.js';

export interface RestApiConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Talks to the official Palworld dedicated server REST API
 * (RESTAPIEnabled=True in PalWorldSettings.ini, default port 8212).
 * Authentication is HTTP Basic with the server's AdminPassword.
 */
export class RestApiAdapter implements PalworldAdapter {
  readonly kind = 'rest';
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(connection: RestApiConnection) {
    const host = isIPv6(connection.host) ? `[${connection.host}]` : connection.host;
    this.baseUrl = new URL(`http://${host}:${connection.port}/v1/api/`).toString();
    this.authHeader = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`;
    this.timeoutMs = connection.timeoutMs ?? 5000;
  }

  async getInfo(): Promise<PalworldServerInfo> {
    const body = await this.request<Record<string, unknown>>('GET', 'info');
    return {
      name: str(body.servername),
      description: str(body.description),
      version: str(body.version),
      worldGuid: str(body.worldguid),
    };
  }

  async getMetrics(): Promise<PalworldMetrics> {
    const body = await this.request<Record<string, unknown>>('GET', 'metrics');
    return {
      fps: num(body.serverfps) ?? 0,
      frameTimeMs: num(body.serverframetime) ?? 0,
      currentPlayers: num(body.currentplayernum) ?? 0,
      maxPlayers: num(body.maxplayernum) ?? 0,
      uptimeSeconds: num(body.uptime) ?? 0,
      inGameDays: num(body.days),
      baseCampCount: num(body.basecampnum),
    };
  }

  async getPlayers(): Promise<PalworldPlayer[]> {
    const body = await this.request<{ players?: unknown }>('GET', 'players');
    if (!Array.isArray(body.players)) throw new PalworldError('invalid_response', 'Unexpected player list format');
    return body.players.map((raw: Record<string, unknown>) => {
      const x = num(raw.location_x);
      const y = num(raw.location_y);
      return {
        name: str(raw.name),
        accountName: str(raw.accountName),
        playerId: str(raw.playerId),
        userId: str(raw.userId),
        ip: str(raw.ip) || null,
        ping: num(raw.ping),
        level: num(raw.level),
        location: x !== null && y !== null ? { x, y } : null,
        buildingCount: num(raw.building_count),
      };
    });
  }

  async getSettings(): Promise<PalworldSettings> {
    const body = await this.request<Record<string, unknown>>('GET', 'settings');
    const settings: PalworldSettings = {};
    for (const [key, value] of Object.entries(body)) {
      if (['string', 'number', 'boolean'].includes(typeof value)) settings[key] = value as string | number | boolean;
    }
    return settings;
  }

  announce(message: string) {
    return this.request<void>('POST', 'announce', { message });
  }

  kick(userId: string, message = '') {
    return this.request<void>('POST', 'kick', { userid: userId, message });
  }

  ban(userId: string, message = '') {
    return this.request<void>('POST', 'ban', { userid: userId, message });
  }

  unban(userId: string) {
    return this.request<void>('POST', 'unban', { userid: userId });
  }

  save() {
    return this.request<void>('POST', 'save');
  }

  shutdown(waitSeconds: number, message: string) {
    return this.request<void>('POST', 'shutdown', { waittime: waitSeconds, message });
  }

  forceStop() {
    return this.request<void>('POST', 'stop');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new PalworldError('unreachable', timedOut ? 'The server did not respond in time' : 'Could not reach the server');
    }

    if (response.status === 401 || response.status === 403) {
      throw new PalworldError('unauthorized', 'The server rejected the admin credentials');
    }
    if (!response.ok) {
      throw new PalworldError('api_error', `The server returned HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Action endpoints answer with plain text such as "OK".
      if (method === 'POST') return undefined as T;
      throw new PalworldError('invalid_response', 'The server returned a response the panel could not read');
    }
  }
}
