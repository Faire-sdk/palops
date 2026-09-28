import type { DB } from '../../database/db.js';
import type { SecretBox } from '../../utils/crypto.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import type { PalworldPlayer } from '../palworld/index.js';
import type { ModerationService } from '../players/moderation.js';
import type { PlayerDirectory } from '../players/player-directory.js';
import type { ServerRegistry } from '../servers/server-registry.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { PalBanClient, PalBanError, type PalBanEvent, type PalBanKeyStatus, type PalBanPlayer } from './palban-client.js';

/** Settings as shown to a client: never includes the key. */
export interface PalBanSettings {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  /** Ban in the game whatever is banned on the PalBan banlist. Off unless an owner turns it on. */
  autoBan: boolean;
  /** Tell PalBan about joins, leaves and bans made here. */
  sendEvents: boolean;
  /** Look each player up on the network when they join. */
  checkJoins: boolean;
  serverName: string | null;
  updatedAt: string;
}

export interface PalBanSettingsInput {
  enabled: boolean;
  baseUrl: string;
  /** Omit to keep the stored key. */
  key?: string;
  autoBan: boolean;
  sendEvents: boolean;
  checkJoins: boolean;
}

export interface PalBanStatus {
  enabled: boolean;
  serverName: string | null;
  lastSyncAt: string | null;
  error: string | null;
  bans: { total: number; active: number };
  /** Active on PalBan, not banned in the game. */
  notInGame: number;
  /** Events waiting to be sent to PalBan. */
  queued: number;
}

/** One ban on the server's PalBan banlist, next to what the game says. */
export interface PalBanBanView {
  id: string;
  gameId: string;
  playerName: string | null;
  discordId: string | null;
  reason: string | null;
  category: string | null;
  status: string;
  active: boolean;
  banDate: string | null;
  expiresAt: string | null;
  unbanDate: string | null;
  /** Whether the player is banned in the game (as far as PalOps knows). */
  inGame: boolean;
  /** PalOps banned them from this ban; it is lifted again if the ban is. */
  applied: boolean;
}

export interface PalBanFlag {
  userId: string;
  name: string;
  activeReports: number;
  serversReporting: number;
  localBanned: boolean;
}

interface SettingsRow {
  enabled: number;
  base_url: string;
  key_encrypted: string | null;
  palban_server_id: string | null;
  palban_server_name: string | null;
  auto_ban: number;
  send_events: number;
  check_joins: number;
  sync_cursor: string | null;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
}

interface BanRow {
  ban_id: string;
  game_id: string;
  player_name: string | null;
  discord_id: string | null;
  reason: string | null;
  category: string | null;
  status: string;
  ban_date: string | null;
  expires_at: string | null;
  unban_date: string | null;
  applied_at: string | null;
}

const PALBAN_ACTOR: AuditActor = { userId: null, username: 'PalBan Network' };
const ACTIVE = 'ACTIVE';
const FULL_SYNC_MS = 24 * 3600 * 1000;
const SYNC_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const LOOKUP_TTL_MS = 6 * 3600 * 1000;
const MAX_QUEUE = 1000;
/** The API allows 120 reads a minute per key; joins queue behind this so a busy restart can't use them all. */
const MAX_LOOKUPS_PER_TICK = 20;

const toSettings = (row: SettingsRow): PalBanSettings => ({
  enabled: row.enabled === 1,
  baseUrl: row.base_url,
  hasKey: row.key_encrypted !== null,
  autoBan: row.auto_ban === 1,
  sendEvents: row.send_events === 1,
  checkJoins: row.check_joins === 1,
  serverName: row.palban_server_name,
  updatedAt: row.updated_at,
});

/** PalBan Game IDs and platform ids are the same thing written the same way; compare them without regard to case. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Only http(s) addresses, without embedded credentials. Returns the cleaned address or null. */
export function cleanBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * The optional PalBan Network integration. Off until an owner turns it on in
 * Settings; while it's off nothing here runs. When on it mirrors the server's
 * PalBan banlist (so the panel can show what is not banned in the game yet and
 * ban it with one click, or automatically if the owner allows), looks players
 * up on the network, and tells PalBan about joins, leaves and bans.
 *
 * PalBan's own rule holds here too: a report from another server is a lead for
 * the team, never a ban. Only bans on this server's own PalBan banlist can be
 * applied, and only by the team's choice.
 */
export class PalBanService {
  private cached: { key: string; client: PalBanClient } | undefined;
  private lookups = new Map<string, { at: number; player: PalBanPlayer }>();
  private pendingLookups = new Set<string>();
  private queue: PalBanEvent[] = [];
  private online: Set<string> | null = null;
  private names = new Map<string, string>();
  private lastHeartbeat = 0;
  private lastSyncTry = 0;
  private flagged = new Map<string, number>();
  private flagListeners: Array<(flag: PalBanFlag) => void> = [];
  private busy = false;

  constructor(
    private readonly db: DB,
    private readonly secrets: SecretBox,
    private readonly moderation: ModerationService,
    private readonly players: PlayerDirectory,
    private readonly servers: ServerRegistry,
    private readonly audit: AuditLog,
  ) {
    players.onRefresh((online) => this.onRefresh(online));
    moderation.onBan((e) => {
      if (e.actor.username !== PALBAN_ACTOR.username) this.queueEvent('BAN_CREATED', e.userId, e.name, { reason: e.reason });
    });
    moderation.onUnban((e) => {
      if (e.actor.username !== PALBAN_ACTOR.username) this.queueEvent('BAN_REMOVED', e.userId, e.name, {});
    });
  }

  /** Runs when a player who joins has active bans on this server's PalBan list or on other servers. */
  onFlag(listener: (flag: PalBanFlag) => void): void {
    this.flagListeners.push(listener);
  }

  // ---- Settings ----

  private row(): SettingsRow | undefined {
    return this.db.prepare('SELECT * FROM palban WHERE id = 1').get() as SettingsRow | undefined;
  }

  settings(): PalBanSettings | null {
    const row = this.row();
    return row ? toSettings(row) : null;
  }

  enabled(): boolean {
    return this.settings()?.enabled === true;
  }

  save(input: PalBanSettingsInput): PalBanSettings {
    const baseUrl = cleanBaseUrl(input.baseUrl);
    if (!baseUrl) throw badRequest('Enter the PalBan Network address, e.g. https://palban.net', 'invalid_url');
    const key = input.key !== undefined ? this.secrets.encrypt(input.key) : null;
    const before = this.row();
    const changedConnection = !before || before.base_url !== baseUrl || key !== null;
    this.db
      .prepare(
        `INSERT INTO palban (id, enabled, base_url, key_encrypted, auto_ban, send_events, check_joins)
         VALUES (1, @enabled, @baseUrl, @key, @autoBan, @sendEvents, @checkJoins)
         ON CONFLICT (id) DO UPDATE SET enabled = @enabled, base_url = @baseUrl, key_encrypted = COALESCE(@key, key_encrypted),
           auto_ban = @autoBan, send_events = @sendEvents, check_joins = @checkJoins,
           ${changedConnection ? 'palban_server_id = NULL, palban_server_name = NULL, sync_cursor = NULL, last_full_sync_at = NULL, last_sync_at = NULL,' : ''}
           last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run({ enabled: input.enabled ? 1 : 0, baseUrl, key, autoBan: input.autoBan ? 1 : 0, sendEvents: input.sendEvents ? 1 : 0, checkJoins: input.checkJoins ? 1 : 0 });
    if (changedConnection) {
      // Another key may be another server's banlist.
      const serverId = this.servers.getPrimary()?.id;
      if (serverId !== undefined) this.db.prepare('DELETE FROM palban_bans WHERE server_id = ?').run(serverId);
      this.lookups.clear();
    }
    this.cached = undefined;
    return this.settings()!;
  }

  private storedKey(): string {
    const row = this.row();
    return row?.key_encrypted ? this.secrets.decrypt(row.key_encrypted) : '';
  }

  /** Throws PalBanError('not_configured') unless the integration is switched on and complete. */
  private client(): PalBanClient {
    const row = this.row();
    const key = row ? this.storedKey() : '';
    if (!row || row.enabled !== 1 || !row.base_url || !key) throw new PalBanError('not_configured', 'The PalBan Network integration is not set up');
    const cacheKey = row.updated_at;
    if (this.cached?.key !== cacheKey) this.cached = { key: cacheKey, client: new PalBanClient({ baseUrl: row.base_url, key }) };
    return this.cached.client;
  }

  /** Checks a key without saving it: which server it belongs to and what it may do. */
  async test(input: { baseUrl: string; key?: string }): Promise<PalBanKeyStatus & { missingScopes: string[] }> {
    const baseUrl = cleanBaseUrl(input.baseUrl);
    if (!baseUrl) throw badRequest('Enter the PalBan Network address, e.g. https://palban.net', 'invalid_url');
    const key = input.key || this.storedKey();
    if (!key) throw new PalBanError('not_configured', 'Enter the integration key first');
    const status = await new PalBanClient({ baseUrl, key }).status();
    const needed = ['READ_SERVER', 'READ_PLAYERS', 'READ_BANLIST', 'WRITE_EVENTS'];
    return { ...status, missingScopes: needed.filter((s) => !status.scopes.includes(s)) };
  }

  status(): PalBanStatus {
    const row = this.row();
    const serverId = this.servers.getPrimary()?.id;
    const counts = serverId === undefined ? { total: 0, active: 0 } : (this.db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status = '${ACTIVE}'), 0) AS active FROM palban_bans WHERE server_id = ?`).get(serverId) as { total: number; active: number });
    return {
      enabled: row?.enabled === 1,
      serverName: row?.palban_server_name ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      error: row?.last_error ?? null,
      bans: counts,
      notInGame: row?.enabled === 1 ? this.bans().filter((b) => b.active && !b.inGame).length : 0,
      queued: this.queue.length,
    };
  }

  // ---- Banlist ----

  /** The server's PalBan bans, with whether each is banned in the game. */
  bans(): PalBanBanView[] {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return [];
    const rows = this.db.prepare('SELECT * FROM palban_bans WHERE server_id = ? ORDER BY (status = ?) DESC, ban_date DESC').all(serverId, ACTIVE) as BanRow[];
    return rows.map((r) => ({
      id: r.ban_id,
      gameId: r.game_id,
      playerName: r.player_name,
      discordId: r.discord_id,
      reason: r.reason,
      category: r.category,
      status: r.status,
      active: r.status === ACTIVE,
      banDate: r.ban_date,
      expiresAt: r.expires_at,
      unbanDate: r.unban_date,
      inGame: this.moderation.isBanned(r.game_id),
      applied: r.applied_at !== null,
    }));
  }

  /** Banned in the game from PalOps, but not on the PalBan banlist: what a team might want to add there. */
  onlyHere(): Array<{ userId: string; name: string | null; reason: string | null; bannedAt: string }> {
    const active = new Set(this.bans().filter((b) => b.active).map((b) => b.gameId.toLowerCase()));
    return this.moderation
      .activeBans()
      .filter((b) => !active.has(b.playerUserId.toLowerCase()))
      .map((b) => ({ userId: b.playerUserId, name: b.playerName, reason: b.reason, bannedAt: b.createdAt }));
  }

  /** Reads the server's banlist from PalBan: everything the first time and once a day, then only what changed. */
  async sync(actor: AuditActor | null = null): Promise<{ changed: number }> {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) throw new PalBanError('not_configured', 'No Palworld server is configured');
    const client = this.client();
    const before = this.row()!;
    try {
      let palbanServerId = before.palban_server_id;
      if (!palbanServerId) {
        const status = await client.status();
        palbanServerId = status.serverId;
        this.db.prepare('UPDATE palban SET palban_server_id = ?, palban_server_name = ? WHERE id = 1').run(status.serverId, status.serverName);
      }
      const full = !before.sync_cursor || !before.last_full_sync_at || Date.now() - Date.parse(before.last_full_sync_at) > FULL_SYNC_MS;
      let cursor: string | null = full ? null : before.sync_cursor;
      let lastCursor: string | null = cursor;
      const seen = new Set<string>();
      let changed = 0;
      const upsert = this.db.prepare(
        `INSERT INTO palban_bans (server_id, ban_id, game_id, player_name, discord_id, reason, category, status, ban_date, expires_at, unban_date, updated_at)
         VALUES (@serverId, @id, @gameId, @playerName, @discordId, @reason, @category, @status, @banDate, @expiresAt, @unbanDate, @updatedAt)
         ON CONFLICT (server_id, ban_id) DO UPDATE SET game_id = @gameId, player_name = @playerName, discord_id = @discordId, reason = @reason, category = @category,
           status = @status, ban_date = @banDate, expires_at = @expiresAt, unban_date = @unbanDate, updated_at = @updatedAt`,
      );
      for (let page = 0; page < 200; page++) {
        const result = await client.banlist(palbanServerId, { cursor });
        this.db.transaction(() => {
          for (const b of result.bans) {
            seen.add(b.id);
            const existing = this.db.prepare('SELECT updated_at FROM palban_bans WHERE server_id = ? AND ban_id = ?').get(serverId, b.id) as { updated_at: string | null } | undefined;
            if (!existing || existing.updated_at !== b.updatedAt) changed++;
            upsert.run({ serverId, ...b });
          }
        })();
        lastCursor = result.syncCursor ?? lastCursor;
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      // A ban deleted on PalBan isn't listed any more; only a full read can tell.
      if (full) {
        for (const row of this.db.prepare('SELECT ban_id FROM palban_bans WHERE server_id = ?').all(serverId) as Array<{ ban_id: string }>) {
          if (!seen.has(row.ban_id)) {
            this.db.prepare('DELETE FROM palban_bans WHERE server_id = ? AND ban_id = ?').run(serverId, row.ban_id);
            changed++;
          }
        }
      }
      this.db
        .prepare(`UPDATE palban SET sync_cursor = ?, last_sync_at = ?, last_full_sync_at = CASE WHEN ? THEN ? ELSE last_full_sync_at END, last_error = NULL WHERE id = 1`)
        .run(lastCursor, new Date().toISOString(), full ? 1 : 0, new Date().toISOString());
      if (changed > 0 || actor) this.audit.record(actor ?? PALBAN_ACTOR, { category: 'server', action: 'palban_sync', details: { changed, full } });
      await this.afterSync();
      return { changed };
    } catch (err) {
      const message = err instanceof PalBanError ? err.message : 'PalBan Network sync failed';
      this.db.prepare('UPDATE palban SET last_error = ? WHERE id = 1').run(message);
      throw err;
    }
  }

  /** Applies the ban list to the game if auto-ban is on, and lifts what PalOps applied once PalBan lifts it. */
  private async afterSync(): Promise<void> {
    const settings = this.settings();
    if (!settings) return;
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return;
    if (settings.autoBan) {
      for (const ban of this.bans().filter((b) => b.active && !b.inGame)) {
        await this.apply(PALBAN_ACTOR, ban.id).catch(() => undefined);
      }
    }
    // Lift only what PalOps itself applied from a ban that is no longer active; a ban a person made stays.
    for (const ban of this.bans().filter((b) => !b.active && b.applied)) {
      if (this.moderation.isBanned(ban.gameId)) {
        await this.moderation.unban(PALBAN_ACTOR, ban.gameId, 'Lifted on PalBan Network').catch(() => undefined);
      }
      this.db.prepare('UPDATE palban_bans SET applied_at = NULL WHERE server_id = ? AND ban_id = ?').run(serverId, ban.id);
    }
  }

  /** Bans the player in the game from an active PalBan ban. */
  async apply(actor: AuditActor, banId: string): Promise<void> {
    const serverId = this.servers.getPrimary()?.id;
    const row = serverId === undefined ? undefined : (this.db.prepare('SELECT * FROM palban_bans WHERE server_id = ? AND ban_id = ?').get(serverId, banId) as BanRow | undefined);
    if (!row) throw notFound('That ban is not on the PalBan list');
    if (row.status !== ACTIVE) throw badRequest('That ban is no longer active on PalBan Network', 'not_active');
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(row.game_id)) throw badRequest('That Game ID is not a platform id the game accepts', 'invalid_game_id');
    if (this.moderation.isBanned(row.game_id)) return;
    await this.moderation.ban(actor, row.game_id, `PalBan Network${row.reason ? `: ${row.reason}` : ''}`.slice(0, 200));
    this.db.prepare('UPDATE palban_bans SET applied_at = ? WHERE server_id = ? AND ban_id = ?').run(new Date().toISOString(), serverId, banId);
  }

  // ---- Player lookup ----

  /** What the network knows about a player, kept for ten minutes so opening a profile doesn't call PalBan every time. */
  async lookup(userId: string, options: { fresh?: boolean } = {}): Promise<PalBanPlayer> {
    const key = userId.toLowerCase();
    const hit = this.lookups.get(key);
    if (hit && !options.fresh && Date.now() - hit.at < 10 * 60 * 1000) return hit.player;
    const player = await this.client().player(userId);
    this.lookups.set(key, { at: Date.now(), player });
    if (this.lookups.size > 500) this.lookups.delete(this.lookups.keys().next().value!);
    return player;
  }

  private onRefresh(online: PalworldPlayer[]): void {
    const settings = this.settings();
    if (!settings?.enabled) return;
    const now = new Set(online.map((p) => p.userId).filter(Boolean));
    const before = this.online;
    this.online = now;
    // The first list after starting isn't a crowd of people joining.
    if (before && settings.sendEvents) {
      for (const p of online) if (p.userId && !before.has(p.userId)) this.queueEvent('PLAYER_JOIN', p.userId, p.name, {});
      for (const id of before) if (!now.has(id)) this.queueEvent('PLAYER_LEAVE', id, this.names.get(id) ?? null, {});
    }
    this.names = new Map(online.filter((p) => p.userId).map((p) => [p.userId, p.name]));
    if (settings.checkJoins) void this.checkJoins(online);
  }

  private async checkJoins(online: PalworldPlayer[]): Promise<void> {
    let used = 0;
    for (const p of online) {
      if (!p.userId || used >= MAX_LOOKUPS_PER_TICK) continue;
      const key = p.userId.toLowerCase();
      const seenAt = this.flagged.get(key);
      const hit = this.lookups.get(key);
      if (this.pendingLookups.has(key) || (hit && Date.now() - hit.at < LOOKUP_TTL_MS) || (seenAt && Date.now() - seenAt < LOOKUP_TTL_MS)) continue;
      this.pendingLookups.add(key);
      used++;
      try {
        const player = await this.lookup(p.userId, { fresh: true });
        const flagged = player.localBanStatus === 'BANNED' || player.network.activeReportCount > 0;
        if (flagged) {
          this.flagged.set(key, Date.now());
          this.audit.record(PALBAN_ACTOR, {
            category: 'players',
            action: 'palban_flag',
            target: `${p.name} (${p.userId})`,
            details: { activeReports: player.network.activeReportCount, servers: player.network.serversReporting, bannedHere: player.localBanStatus === 'BANNED' },
          });
          for (const listener of this.flagListeners) listener({ userId: p.userId, name: p.name, activeReports: player.network.activeReportCount, serversReporting: player.network.serversReporting, localBanned: player.localBanStatus === 'BANNED' });
        }
      } catch (err) {
        // Rate limited or unreachable: the next refresh tries again, it isn't worth a log line each time.
        if (err instanceof PalBanError && err.code === 'unauthorized') break;
      } finally {
        this.pendingLookups.delete(key);
      }
    }
  }

  // ---- Events out ----

  private queueEvent(type: PalBanEvent['event_type'], userId: string, name: string | null, data: Record<string, unknown>): void {
    const settings = this.settings();
    if (!settings?.enabled || !settings.sendEvents) return;
    const at = new Date();
    this.queue.push({
      event_id: `palops-${type.toLowerCase()}-${userId}-${at.getTime()}`,
      event_type: type,
      occurred_at: at.toISOString(),
      player: { game_id: userId, ...(name ? { name } : {}) },
      // Never an address: PalBan doesn't want one from us, and players didn't agree to send it.
      data,
    });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }

  /** Sends what is queued, up to 100 at a time. What fails stays queued for the next try. */
  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, 100);
      // Events PalBan rejects would be rejected again, so they leave the queue with the accepted ones.
      await this.client().sendEvents(batch);
      this.queue.splice(0, batch.length);
    }
  }

  /** Called every minute by the panel: heartbeat, banlist sync and event delivery, each on its own schedule. */
  async tick(): Promise<void> {
    if (this.busy || !this.enabled() || !this.servers.getPrimary()) return;
    this.busy = true;
    try {
      const now = Date.now();
      if (now - this.lastSyncTry >= SYNC_MS) {
        this.lastSyncTry = now;
        await this.sync().catch(() => undefined);
      }
      if (this.settings()?.sendEvents) {
        if (now - this.lastHeartbeat >= HEARTBEAT_MS) {
          this.lastHeartbeat = now;
          await this.client().heartbeat().catch(() => undefined);
        }
        await this.flush().catch((err) => {
          const message = err instanceof PalBanError ? err.message : 'Could not send events to PalBan Network';
          this.db.prepare('UPDATE palban SET last_error = ? WHERE id = 1').run(message);
        });
      }
    } finally {
      this.busy = false;
    }
  }
}
