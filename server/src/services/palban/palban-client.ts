export type PalBanErrorCode = 'not_configured' | 'unreachable' | 'unauthorized' | 'missing_scope' | 'rate_limited' | 'not_found' | 'rejected' | 'api_error' | 'invalid_response';

export class PalBanError extends Error {
  constructor(
    public readonly code: PalBanErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PalBanConnection {
  baseUrl: string;
  key: string;
  timeoutMs?: number;
}

/** What GET /integrations/status says about the key. */
export interface PalBanKeyStatus {
  integrationName: string;
  serverId: string;
  serverName: string;
  scopes: string[];
}

/** One ban from this server's PalBan banlist. */
export interface PalBanBan {
  id: string;
  gameId: string;
  playerName: string | null;
  discordId: string | null;
  reason: string | null;
  category: string | null;
  /** ACTIVE, EXPIRED, REVOKED and so on: whatever PalBan says it is now. */
  status: string;
  banDate: string | null;
  expiresAt: string | null;
  unbanDate: string | null;
  updatedAt: string | null;
}

export interface PalBanBanPage {
  bans: PalBanBan[];
  nextCursor: string | null;
  syncCursor: string | null;
}

export interface PalBanReport {
  server: string;
  reason: string | null;
  status: string;
  banDate: string | null;
  expiresAt: string | null;
}

export interface PalBanDetection {
  provider: string | null;
  type: string | null;
  severity: string | null;
  confidence: number | null;
  message: string | null;
  detectedAt: string | null;
}

/** PalBan Network's view of one player. Reports from other servers are leads to review, never a verdict. */
export interface PalBanPlayer {
  gameId: string;
  playerName: string | null;
  linkedDiscordId: string | null;
  localBanStatus: 'BANNED' | 'PREVIOUSLY_BANNED' | 'NOT_BANNED';
  localBans: Array<{ id: string; reason: string | null; category: string | null; status: string; banDate: string | null; expiresAt: string | null }>;
  network: { serversReporting: number; reportCount: number; activeReportCount: number; reports: PalBanReport[] };
  detections: PalBanDetection[];
}

/** An event in PalBan Network's common format. */
export interface PalBanEvent {
  event_id: string;
  event_type: 'PLAYER_JOIN' | 'PLAYER_LEAVE' | 'BAN_CREATED' | 'BAN_REMOVED' | 'SERVER_START' | 'SERVER_STOP';
  occurred_at: string;
  player?: { game_id: string; name?: string };
  data?: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The parts of PalBan Network's integration API (/api/v1) PalOps uses. It
 * never asks PalBan to ban anyone: the API has no such call, and bans made in
 * the game stay decisions of the server's own team.
 */
export class PalBanClient {
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(private readonly connection: PalBanConnection) {
    this.timeoutMs = connection.timeoutMs ?? 10_000;
    this.baseUrl = connection.baseUrl.replace(/\/+$/, '');
  }

  async status(): Promise<PalBanKeyStatus> {
    const body = obj(await this.request('GET', '/api/v1/integrations/status'));
    const server = obj(body.server);
    const serverId = str(server.id);
    if (!serverId) throw new PalBanError('invalid_response', 'PalBan Network did not say which server this key belongs to');
    return {
      integrationName: str(obj(body.integration).name) ?? 'Integration',
      serverId,
      serverName: str(server.name) ?? serverId,
      scopes: arr(body.scopes).filter((s): s is string => typeof s === 'string'),
    };
  }

  /** A page of the server's bans, oldest change first. Pass the cursor from the last page to get only what changed. */
  async banlist(serverId: string, options: { cursor?: string | null; limit?: number } = {}): Promise<PalBanBanPage> {
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) });
    if (options.cursor) query.set('cursor', options.cursor);
    const body = obj(await this.request('GET', `/api/v1/servers/${encodeURIComponent(serverId)}/banlist?${query}`));
    return {
      bans: arr(body.bans).flatMap((b) => {
        const r = obj(b);
        const id = str(r.id);
        const gameId = str(r.game_id);
        const status = str(r.status);
        return id && gameId && status
          ? [
              {
                id,
                gameId,
                playerName: str(r.player_name),
                discordId: str(r.discord_id),
                reason: str(r.reason),
                category: str(r.category),
                status,
                banDate: str(r.ban_date),
                expiresAt: str(r.expires_at),
                unbanDate: str(r.unban_date),
                updatedAt: str(r.updated_at),
              },
            ]
          : [];
      }),
      nextCursor: str(body.next_cursor),
      syncCursor: str(body.sync_cursor),
    };
  }

  async player(gameId: string): Promise<PalBanPlayer> {
    const b = obj(await this.request('GET', `/api/v1/players/${encodeURIComponent(gameId)}`));
    const network = obj(b.network);
    const status = str(b.local_ban_status);
    return {
      gameId: str(b.game_id) ?? gameId,
      playerName: str(b.player_name),
      linkedDiscordId: str(b.linked_discord_id),
      localBanStatus: status === 'BANNED' || status === 'PREVIOUSLY_BANNED' ? status : 'NOT_BANNED',
      localBans: arr(b.local_bans).map((x) => {
        const r = obj(x);
        return { id: str(r.id) ?? '', reason: str(r.reason), category: str(r.category), status: str(r.status) ?? 'UNKNOWN', banDate: str(r.ban_date), expiresAt: str(r.expires_at) };
      }),
      network: {
        serversReporting: num(network.servers_reporting),
        reportCount: num(network.report_count),
        activeReportCount: num(network.active_report_count),
        reports: arr(network.reports).map((x) => {
          const r = obj(x);
          return { server: str(r.server) ?? 'Unknown server', reason: str(r.reason), status: str(r.status) ?? 'UNKNOWN', banDate: str(r.ban_date), expiresAt: str(r.expires_at) };
        }),
      },
      detections: arr(b.recent_anticheat_detections).map((x) => {
        const r = obj(x);
        return {
          provider: str(r.provider),
          type: str(r.detection_type),
          severity: str(r.severity),
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          message: str(r.message),
          detectedAt: str(r.detected_at),
        };
      }),
    };
  }

  /** Up to 100 events; resending an event_id is harmless. */
  async sendEvents(events: PalBanEvent[]): Promise<{ accepted: number; duplicates: number; rejected: number }> {
    const b = obj(await this.request('POST', '/api/v1/integrations/events/batch', { events }));
    return { accepted: num(b.accepted), duplicates: num(b.duplicates), rejected: num(b.rejected) + num(b.failed) };
  }

  async heartbeat(): Promise<void> {
    await this.request('POST', '/api/v1/integrations/heartbeat', {});
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.connection.key}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        // The key must never be sent somewhere the owner didn't type in.
        redirect: 'error',
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new PalBanError('unreachable', timedOut ? 'PalBan Network did not respond in time' : 'Could not reach PalBan Network. Check the address.');
    }
    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const message = str(obj(parsed).error)?.slice(0, 200) ?? (typeof obj(parsed).error === 'object' ? str(obj(obj(parsed).error).message)?.slice(0, 200) : null);
      if (response.status === 401) throw new PalBanError('unauthorized', 'PalBan Network rejected the key. It may have been replaced or revoked.');
      if (response.status === 403) throw new PalBanError('missing_scope', message ?? 'The PalBan key is missing a permission this needs');
      if (response.status === 404) throw new PalBanError('not_found', message ?? 'PalBan Network could not find that');
      if (response.status === 429) throw new PalBanError('rate_limited', 'PalBan Network is rate limiting this key; PalOps will try again shortly');
      if (response.status === 400 || response.status === 413) throw new PalBanError('rejected', message ?? 'PalBan Network refused the request');
      throw new PalBanError('api_error', message ?? `PalBan Network returned HTTP ${response.status}`);
    }
    if (parsed === undefined && method === 'GET') throw new PalBanError('invalid_response', 'PalBan Network returned a response PalOps could not read');
    return parsed;
  }
}
