import { isIP } from 'node:net';
import type { DB } from '../../database/db.js';
import type { SecretBox } from '../../utils/crypto.js';
import type { PlayerDirectory } from '../players/player-directory.js';
import type { ServerRegistry } from '../servers/server-registry.js';
import { PalDefenderClient, PalDefenderError, type BanResult, type PalDefenderBan, type PalDefenderConnection } from './paldefender-client.js';

export const PALDEFENDER_DEFAULT_PORT = 17993;

/** Settings as shown to a client: never includes the token. */
export interface PalDefenderSettings {
  enabled: boolean;
  host: string;
  port: number;
  useTls: boolean;
  hasToken: boolean;
  updatedAt: string;
}

export interface PalDefenderSettingsInput {
  enabled: boolean;
  host: string;
  port: number;
  useTls: boolean;
  /** Omit to keep the stored token. */
  token?: string;
}

export interface PalDefenderStatus {
  enabled: boolean;
  /** PalDefender's version, once it has answered. */
  version: string | null;
  lastSyncAt: string | null;
  /** Why the last attempt failed, or null when it worked. */
  error: string | null;
}

/** What happened when the panel mirrored an action to PalDefender. */
export interface Mirror {
  ok: boolean;
  message: string | null;
}

export interface CheckResult {
  name: string;
  permission: string;
  ok: boolean;
  message: string | null;
}

interface Row {
  enabled: number;
  host: string;
  port: number;
  use_tls: number;
  token_encrypted: string | null;
  updated_at: string;
}

const toSettings = (row: Row): PalDefenderSettings => ({
  enabled: row.enabled === 1,
  host: row.host,
  port: row.port,
  useTls: row.use_tls === 1,
  hasToken: row.token_encrypted !== null,
  updatedAt: row.updated_at,
});

/**
 * The optional PalDefender integration. Off until an owner turns it on in
 * Settings; while it's off nothing here runs and the panel behaves exactly as
 * it does without PalDefender. When on, it adds native IP bans, PalDefender's
 * ban list, and player addresses, on top of what the official REST API gives.
 */
export class PalDefenderService {
  private cached: { key: string; client: PalDefenderClient } | undefined;
  private version: string | null = null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: DB,
    private readonly secrets: SecretBox,
    private readonly players: PlayerDirectory,
    private readonly servers: ServerRegistry,
  ) {}

  settings(): PalDefenderSettings | null {
    const row = this.db.prepare('SELECT * FROM paldefender WHERE id = 1').get() as Row | undefined;
    return row ? toSettings(row) : null;
  }

  enabled(): boolean {
    return this.settings()?.enabled === true;
  }

  save(input: PalDefenderSettingsInput): PalDefenderSettings {
    const token = input.token !== undefined ? this.secrets.encrypt(input.token) : null;
    this.db
      .prepare(
        `INSERT INTO paldefender (id, enabled, host, port, use_tls, token_encrypted) VALUES (1, @enabled, @host, @port, @tls, @token)
         ON CONFLICT (id) DO UPDATE SET enabled = @enabled, host = @host, port = @port, use_tls = @tls,
           token_encrypted = COALESCE(@token, token_encrypted), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run({ enabled: input.enabled ? 1 : 0, host: input.host, port: input.port, tls: input.useTls ? 1 : 0, token });
    this.cached = undefined;
    this.version = null;
    this.lastError = null;
    return this.settings()!;
  }

  private storedToken(): string {
    const row = this.db.prepare('SELECT token_encrypted FROM paldefender WHERE id = 1').get() as { token_encrypted: string | null } | undefined;
    return row?.token_encrypted ? this.secrets.decrypt(row.token_encrypted) : '';
  }

  /** Throws PalDefenderError('not_configured') unless the integration is switched on and complete. */
  client(): PalDefenderClient {
    const s = this.settings();
    const token = s ? this.storedToken() : '';
    if (!s?.enabled || !s.host || !token) throw new PalDefenderError('not_configured', 'The PalDefender integration is not set up');
    const key = `${s.updatedAt}`;
    if (this.cached?.key !== key) this.cached = { key, client: new PalDefenderClient({ host: s.host, port: s.port, useTls: s.useTls, token }) };
    return this.cached.client;
  }

  status(): PalDefenderStatus {
    return { enabled: this.enabled(), version: this.version, lastSyncAt: this.lastSyncAt, error: this.lastError };
  }

  /**
   * Tries each read the panel relies on, so an owner sees which token
   * permission is missing. Writes (bans) can't be tried without acting, so the
   * setup guide lists their permissions.
   */
  async test(input: Omit<PalDefenderSettingsInput, 'enabled'>): Promise<{ version: string | null; checks: CheckResult[] }> {
    const token = input.token || this.storedToken();
    if (!token) throw new PalDefenderError('not_configured', 'Enter the API token first');
    const connection: PalDefenderConnection = { host: input.host, port: input.port, useTls: input.useTls, token };
    const client = new PalDefenderClient(connection);
    const run = async (name: string, permission: string, fn: () => Promise<unknown>): Promise<CheckResult> => {
      try {
        await fn();
        return { name, permission, ok: true, message: null };
      } catch (err) {
        return { name, permission, ok: false, message: err instanceof Error ? err.message : 'Failed' };
      }
    };
    let version: string | null = null;
    const checks = [
      await run('Version', 'REST.Version.Read', async () => (version = await client.version())),
      await run('Player list', 'REST.Players.Read', () => client.players()),
      await run('Ban list', 'REST.Banlist.Read', () => client.banlist({ activeOnly: true })),
      await run('Guild list', 'REST.Guilds.Read', () => client.guilds()),
    ];
    return { version, checks };
  }

  /** Records the addresses PalDefender knows, including offline players. */
  async syncPlayers(): Promise<number> {
    const server = this.servers.getPrimary();
    if (!server || !this.enabled()) return 0;
    try {
      const client = this.client();
      if (!this.version) this.version = await client.version();
      const list = await client.players();
      this.players.recordAddresses(
        server.id,
        list.map((p) => ({ userId: p.userId ?? '', ip: p.ip })),
      );
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      return list.length;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'PalDefender sync failed';
      throw err;
    }
  }

  async banlist(includeInactive: boolean): Promise<PalDefenderBan[]> {
    const bans = await this.client().banlist({ activeOnly: !includeInactive });
    return bans.sort((a, b) => (b.bannedAt ?? '').localeCompare(a.bannedAt ?? ''));
  }

  /** Removes a ban from PalDefender's list only, reporting any failure. */
  unbanUser(userId: string, reason: string): Promise<void> {
    return this.client().unban(userId, reason);
  }

  unbanAddress(ip: string, reason: string): Promise<void> {
    return this.client().unbanIp(ip, reason);
  }

  // ---- Mirroring panel actions to PalDefender ----
  // The official REST API stays the source of truth. These add PalDefender's
  // own bans on top, and a failure here is reported, never allowed to undo or
  // block the action that already worked.

  /** Null when the integration is off, so callers can leave it out of their answer. */
  private async mirror(fn: (client: PalDefenderClient) => Promise<unknown>, ignoreNotFound = false): Promise<Mirror | null> {
    if (!this.enabled()) return null;
    try {
      await fn(this.client());
      return { ok: true, message: null };
    } catch (err) {
      if (ignoreNotFound && err instanceof PalDefenderError && err.code === 'not_found') return { ok: true, message: null };
      return { ok: false, message: `PalDefender: ${err instanceof Error ? err.message : 'the request failed'}` };
    }
  }

  mirrorBanPlayer(userId: string, reason: string, withIp: boolean): Promise<Mirror | null> {
    return this.mirror((c): Promise<BanResult> => c.ban(userId, { reason, ip: withIp }));
  }

  mirrorUnbanPlayer(userId: string, reason: string): Promise<Mirror | null> {
    return this.mirror((c) => c.unban(userId, reason), true);
  }

  mirrorBanAddress(ip: string, reason: string, userId?: string | null): Promise<Mirror | null> {
    return this.mirror((c) => c.banIp(ip, { reason, userId }));
  }

  /** A chat message from the server to everyone, through PalDefender. */
  mirrorBroadcast(message: string): Promise<Mirror | null> {
    return this.mirror((c) => c.broadcast(message));
  }

  mirrorUnbanAddress(ip: string, reason = ''): Promise<Mirror | null> {
    return this.mirror((c) => c.unbanIp(ip, reason), true);
  }
}

export const isValidPalDefenderHost = (host: string) => isIP(host) !== 0 || /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host);
