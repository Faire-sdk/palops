import { isIPv6 } from 'node:net';

export type PalDefenderErrorCode = 'not_configured' | 'unreachable' | 'unauthorized' | 'missing_permission' | 'not_found' | 'api_error' | 'invalid_response';

export class PalDefenderError extends Error {
  constructor(
    public readonly code: PalDefenderErrorCode,
    message: string,
    /** PalDefender's own error code, e.g. BAN_NOT_FOUND. */
    public readonly apiCode?: string,
  ) {
    super(message);
  }
}

export interface PalDefenderConnection {
  host: string;
  port: number;
  useTls: boolean;
  token: string;
  timeoutMs?: number;
}

export interface PalDefenderPlayer {
  name: string;
  ip: string | null;
  playerUid: string | null;
  userId: string | null;
  guildName: string | null;
  status: string | null;
}

/** One ban from PalDefender's own ban list (Banlist.json). */
export interface PalDefenderBan {
  kind: 'user' | 'ip';
  /** The platform id for user bans, the address for IP bans. */
  id: string;
  active: boolean;
  reason: string | null;
  bannedBy: string | null;
  /** How it was issued, e.g. rest, console, anticheat. */
  bannedVia: string | null;
  bannedAt: string | null;
  unbannedAt: string | null;
}

export interface BanResult {
  kicked: number;
  bannedIp: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** PalDefender stamps times as UTC seconds; accept milliseconds too. */
function toIso(stamp: unknown): string | null {
  const utc = obj(stamp).UTC;
  if (typeof utc !== 'number' || !Number.isFinite(utc) || utc <= 0) return null;
  return new Date(utc > 1e11 ? utc : utc * 1000).toISOString();
}

/**
 * Client for the PalDefender plugin's REST API (default 127.0.0.1:17993,
 * bearer token). PalDefender is an optional add-on: the panel never needs it.
 * See https://ultimeit.github.io/PalDefender/RESTAPI/
 */
export class PalDefenderClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly connection: PalDefenderConnection) {
    const host = isIPv6(connection.host) ? `[${connection.host}]` : connection.host;
    this.baseUrl = new URL(`${connection.useTls ? 'https' : 'http'}://${host}:${connection.port}/v1/pdapi/`).toString();
    this.timeoutMs = connection.timeoutMs ?? 6000;
  }

  async version(): Promise<string> {
    const body = await this.request('GET', 'version', undefined, 'REST.Version.Read');
    const v = obj(obj(body).Version);
    return str(v.VersionLong) ?? str(v.Version) ?? 'unknown';
  }

  async players(): Promise<PalDefenderPlayer[]> {
    const body = obj(await this.request('GET', 'players', undefined, 'REST.Players.Read'));
    if (!Array.isArray(body.Players)) throw new PalDefenderError('invalid_response', 'PalDefender returned a player list the panel could not read');
    return body.Players.map((raw) => {
      const p = obj(raw);
      return {
        name: str(p.Name) ?? '',
        ip: str(p.IP),
        playerUid: str(p.PlayerUID),
        userId: str(p.UserId),
        guildName: str(p.GuildName),
        status: str(p.Status),
      };
    });
  }

  async banlist(options: { activeOnly?: boolean } = {}): Promise<PalDefenderBan[]> {
    const query = options.activeOnly ? '?active=true' : '';
    const body = obj(obj(await this.request('GET', `banlist${query}`, undefined, 'REST.Banlist.Read')).Banlist);
    const entry = (kind: 'user' | 'ip', raw: unknown): PalDefenderBan | null => {
      const e = obj(raw);
      const id = str(kind === 'user' ? e.UserId : e.IP);
      if (!id) return null;
      const by = obj(e.BannedBy);
      const unbanned = obj(e.UnbannedBy);
      return {
        kind,
        id,
        active: e.Active !== false,
        reason: str(by.Reason),
        bannedBy: str(by.NameValue),
        bannedVia: str(by.Type),
        bannedAt: toIso(by.Timestamp),
        unbannedAt: toIso(unbanned.Timestamp),
      };
    };
    const users = (Array.isArray(body.UserEntries) ? body.UserEntries : []).map((e) => entry('user', e));
    const ips = (Array.isArray(body.IPEntries) ? body.IPEntries : []).map((e) => entry('ip', e));
    return [...users, ...ips].filter((e): e is PalDefenderBan => e !== null);
  }

  async ban(userId: string, options: { reason?: string; ip?: boolean } = {}): Promise<BanResult> {
    const body = obj(await this.request('POST', `ban/${encodeURIComponent(userId)}`, { Reason: options.reason ?? '', IP: !!options.ip }, 'REST.Punishments.Ban'));
    return { kicked: typeof body.Kicked === 'number' ? body.Kicked : 0, bannedIp: str(body.BannedIP) };
  }

  async unban(userId: string, reason = ''): Promise<void> {
    await this.request('POST', `unban/${encodeURIComponent(userId)}`, { Reason: reason }, 'REST.Punishments.Unban');
  }

  async banIp(ip: string, options: { reason?: string; userId?: string | null } = {}): Promise<{ kicked: number }> {
    const body = obj(
      await this.request('POST', `banip/${encodeURIComponent(ip)}`, { Reason: options.reason ?? '', ...(options.userId ? { UserId: options.userId } : {}) }, 'REST.Punishments.BanIP'),
    );
    return { kicked: typeof body.Kicked === 'number' ? body.Kicked : 0 };
  }

  async unbanIp(ip: string, reason = ''): Promise<void> {
    await this.request('POST', `unbanip/${encodeURIComponent(ip)}`, { Reason: reason }, 'REST.Punishments.UnbanIP');
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, permission: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new PalDefenderError('unreachable', timedOut ? 'PalDefender did not respond in time' : 'Could not reach PalDefender. Check the address, port and that its REST API is enabled.');
    }

    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const error = obj(obj(parsed).Error);
      const apiCode = str(error.Code) ?? undefined;
      const apiMessage = str(error.Message)?.slice(0, 200);
      if (response.status === 401) throw new PalDefenderError('unauthorized', 'PalDefender rejected the API token', apiCode);
      if (response.status === 403) throw new PalDefenderError('missing_permission', `The PalDefender token is missing the ${permission} permission`, apiCode);
      if (response.status === 404) throw new PalDefenderError('not_found', apiMessage ?? 'PalDefender could not find that', apiCode);
      throw new PalDefenderError('api_error', apiMessage ?? `PalDefender returned HTTP ${response.status}`, apiCode);
    }
    if (parsed === undefined && method === 'GET') throw new PalDefenderError('invalid_response', 'PalDefender returned a response the panel could not read');
    return parsed;
  }
}
