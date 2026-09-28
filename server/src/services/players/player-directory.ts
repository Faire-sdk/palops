import type { DB } from '../../database/db.js';
import type { PalworldPlayer, PalworldService } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';

export interface KnownPlayer {
  id: number;
  serverId: number;
  userId: string;
  playerId: string | null;
  name: string;
  /** The platform account name (e.g. the Steam profile name). */
  accountName: string | null;
  level: number | null;
  guild: string | null;
  guildId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  online: boolean;
}

interface PlayerRow {
  id: number;
  server_id: number;
  user_id: string;
  player_id: string | null;
  name: string;
  account_name: string | null;
  level: number | null;
  guild: string | null;
  guild_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const ONLINE_CACHE_MS = 5000;

/** An address a player has connected from. Staff with players.ip only. */
export interface PlayerAddress {
  ip: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Another player seen on one of the same addresses. */
export interface LinkedPlayer {
  userId: string;
  name: string | null;
  ip: string;
  lastSeenAt: string;
}

type RefreshListener = (players: PalworldPlayer[]) => void;

/**
 * Remembers every player seen online, so the panel and the public website can
 * show people who aren't on right now. Fed from the online player list.
 */
export class PlayerDirectory {
  private online = new Set<string>();
  private cache: { at: number; players: PalworldPlayer[] } | undefined;
  private presenceListeners: Array<(change: { joined: string[]; left: string[] }) => void> = [];
  private names = new Map<string, string>();
  /** False until the first online list, so starting the panel doesn't announce everyone as joining. */
  private presenceReady = false;
  private listeners: RefreshListener[] = [];

  constructor(
    private readonly db: DB,
    private readonly palworld: PalworldService,
    private readonly servers: ServerRegistry,
  ) {}

  /** Fetches who is online now (briefly cached) and records them. */
  async refreshOnline(): Promise<PalworldPlayer[]> {
    if (this.cache && Date.now() - this.cache.at < ONLINE_CACHE_MS) return this.cache.players;
    const players = await this.palworld.getPlayers();
    const server = this.servers.getPrimary();
    if (server) this.record(server.id, players);
    this.cache = { at: Date.now(), players };
    for (const listener of this.listeners) listener(players);
    return players;
  }

  /** Runs when players join or leave between two online lists, with their names. */
  onPresence(listener: (change: { joined: string[]; left: string[] }) => void): void {
    this.presenceListeners.push(listener);
  }

  /** The most recent online list, if it was fetched in the last minute or so. */
  liveOf(userId: string): PalworldPlayer | undefined {
    return this.online.has(userId) ? this.cache?.players.find((p) => p.userId === userId) : undefined;
  }

  /** Runs after every fresh read of the online list (not cached ones). */
  onRefresh(listener: RefreshListener): void {
    this.listeners.push(listener);
  }

  /** Called when the server is unreachable, so nobody shows as online. */
  markAllOffline(): void {
    this.online = new Set();
    this.cache = undefined;
    const server = this.servers.getPrimary();
    if (server) this.syncSessions(server.id, [], new Date().toISOString());
  }

  /** A player just left because of a kick or ban: stop showing them online. */
  markOffline(userId: string): void {
    this.online.delete(userId);
    this.cache = undefined;
  }

  record(serverId: number, players: PalworldPlayer[]): void {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO players (server_id, user_id, player_id, name, account_name, level, guild, first_seen_at, last_seen_at)
       VALUES (@serverId, @userId, @playerId, @name, @accountName, @level, @guild, @now, @now)
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         player_id = COALESCE(excluded.player_id, player_id),
         name = excluded.name,
         account_name = excluded.account_name,
         level = COALESCE(excluded.level, level),
         guild = COALESCE(excluded.guild, guild),
         last_seen_at = excluded.last_seen_at`,
    );
    const address = this.addressRecorder(serverId, now);
    this.db.transaction(() => {
      for (const p of players) {
        if (!p.userId || !p.name) continue;
        upsert.run({
          serverId,
          userId: p.userId,
          playerId: p.playerId || null,
          name: p.name,
          accountName: p.accountName || null,
          level: p.level,
          guild: p.guild,
          now,
        });
        if (p.ip) address(p.userId, p.ip);
      }
    })();
    this.syncSessions(serverId, players.filter((p) => p.userId).map((p) => p.userId), now);
    const before = this.online;
    this.online = new Set(players.map((p) => p.userId));
    if (this.presenceReady) {
      const joined = players.filter((p) => !before.has(p.userId)).map((p) => p.name);
      const left = [...before].filter((id) => !this.online.has(id)).map((id) => this.names.get(id) ?? id);
      if (joined.length || left.length) for (const listener of this.presenceListeners) listener({ joined, left });
    }
    this.presenceReady = true;
    this.names = new Map(players.map((p) => [p.userId, p.name]));
  }

  /** Remembers addresses learned elsewhere (PalDefender knows offline players' too). */
  recordAddresses(serverId: number, entries: Array<{ userId: string; ip: string | null }>): void {
    const address = this.addressRecorder(serverId, new Date().toISOString());
    this.db.transaction(() => {
      for (const e of entries) if (e.userId && e.ip) address(e.userId, e.ip);
    })();
  }

  /** Guild and level from the world snapshot, which the online list doesn't include. */
  applyWorld(
    serverId: number,
    players: Array<{ userId: string; level: number | null; guildId: string | null; guildName: string | null; ip: string | null }>,
  ): void {
    const update = this.db.prepare(
      `UPDATE players SET level = COALESCE(@level, level), guild_id = COALESCE(@guildId, guild_id), guild = COALESCE(@guildName, guild)
       WHERE server_id = @serverId AND user_id = @userId`,
    );
    const address = this.addressRecorder(serverId, new Date().toISOString());
    for (const { ip, ...p } of players) {
      update.run({ serverId, ...p });
      if (ip) address(p.userId, ip);
    }
  }

  /** Addresses this player has connected from, most recent first. */
  addressesOf(userId: string): PlayerAddress[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare('SELECT ip, first_seen_at, last_seen_at FROM player_ips WHERE server_id = ? AND user_id = ? ORDER BY last_seen_at DESC LIMIT 20')
      .all(server.id, userId) as Array<{ ip: string; first_seen_at: string; last_seen_at: string }>;
    return rows.map((r) => ({ ip: r.ip, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at }));
  }

  /** Other players seen on any of this player's addresses: possible alts, or housemates. */
  linkedTo(userId: string): LinkedPlayer[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare(
        `SELECT o.user_id, p.name, o.ip, o.last_seen_at FROM player_ips mine
         JOIN player_ips o ON o.server_id = mine.server_id AND o.ip = mine.ip AND o.user_id <> mine.user_id
         LEFT JOIN players p ON p.server_id = o.server_id AND p.user_id = o.user_id
         WHERE mine.server_id = ? AND mine.user_id = ?
         ORDER BY o.last_seen_at DESC LIMIT 20`,
      )
      .all(server.id, userId) as Array<{ user_id: string; name: string | null; ip: string; last_seen_at: string }>;
    return rows.map((r) => ({ userId: r.user_id, name: r.name, ip: r.ip, lastSeenAt: r.last_seen_at }));
  }

  /** The last address this player connected from, if known. */
  lastAddress(userId: string): string | null {
    return this.addressesOf(userId)[0]?.ip ?? null;
  }

  private addressRecorder(serverId: number, now: string) {
    const upsert = this.db.prepare(
      `INSERT INTO player_ips (server_id, user_id, ip, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (server_id, user_id, ip) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    );
    // Some servers report IPv4 addresses as IPv4-in-IPv6; keep one string per address.
    return (userId: string, ip: string) => {
      const plain = ip.trim().toLowerCase().replace(/^::ffff:/, '');
      if (plain) upsert.run(serverId, userId, plain, now, now);
    };
  }

  // ---- Visits and playtime ----

  /** Opens a visit for everyone newly online and closes the visits of everyone who has gone. Works from the database, so it survives restarts. */
  private syncSessions(serverId: number, onlineIds: string[], now: string): void {
    const open = new Set(
      (this.db.prepare('SELECT user_id FROM player_sessions WHERE server_id = ? AND ended_at IS NULL').all(serverId) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const now_ = new Set(onlineIds);
    const start = this.db.prepare('INSERT INTO player_sessions (server_id, user_id, started_at) VALUES (?, ?, ?)');
    // The last time they were seen online is the best guess for when they left, never earlier than they arrived.
    const end = this.db.prepare(
      `UPDATE player_sessions SET ended_at = MAX(started_at, COALESCE((SELECT last_seen_at FROM players WHERE server_id = @serverId AND user_id = @userId), @now))
       WHERE server_id = @serverId AND user_id = @userId AND ended_at IS NULL`,
    );
    this.db.transaction(() => {
      for (const id of now_) if (!open.has(id)) start.run(serverId, id, now);
      for (const id of open) if (!now_.has(id)) end.run({ serverId, userId: id, now });
    })();
  }

  /** Total time on the server, how many visits, and the latest visits. Open visits count up to now. */
  playtime(userId: string): { seconds: number; sessions: number; longestSeconds: number; averageSeconds: number; recent: Array<{ startedAt: string; endedAt: string | null; seconds: number }> } {
    const server = this.servers.getPrimary();
    if (!server) return { seconds: 0, sessions: 0, longestSeconds: 0, averageSeconds: 0, recent: [] };
    const now = Date.now();
    const rows = this.db
      .prepare('SELECT started_at, ended_at FROM player_sessions WHERE server_id = ? AND user_id = ? ORDER BY id DESC')
      .all(server.id, userId) as Array<{ started_at: string; ended_at: string | null }>;
    const spans = rows.map((r) => ({ startedAt: r.started_at, endedAt: r.ended_at, seconds: Math.max(0, Math.round(((r.ended_at ? Date.parse(r.ended_at) : now) - Date.parse(r.started_at)) / 1000)) }));
    const seconds = spans.reduce((sum, s) => sum + s.seconds, 0);
    return {
      seconds,
      sessions: spans.length,
      longestSeconds: spans.reduce((m, s) => Math.max(m, s.seconds), 0),
      averageSeconds: spans.length ? Math.round(seconds / spans.length) : 0,
      recent: spans.slice(0, 20),
    };
  }

  /** Playtime in seconds for several players at once, for lists. */
  playtimeOf(userIds: string[]): Map<string, number> {
    const server = this.servers.getPrimary();
    const result = new Map<string, number>();
    if (!server || userIds.length === 0) return result;
    const rows = this.db
      .prepare(
        `SELECT user_id, SUM(CAST(strftime('%s', COALESCE(ended_at, @now)) AS INTEGER) - CAST(strftime('%s', started_at) AS INTEGER)) AS seconds
         FROM player_sessions WHERE server_id = @serverId AND user_id IN (${userIds.map((_, i) => `@u${i}`).join(', ')}) GROUP BY user_id`,
      )
      .all({ serverId: server.id, now: new Date().toISOString(), ...Object.fromEntries(userIds.map((u, i) => [`u${i}`, u])) }) as Array<{ user_id: string; seconds: number }>;
    for (const r of rows) result.set(r.user_id, Math.max(0, r.seconds));
    return result;
  }

  /** Visits older than a year are dropped. */
  pruneSessions(): void {
    this.db.prepare('DELETE FROM player_sessions WHERE started_at < ?').run(new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString());
  }

  /** Known players on the primary server who belong to a guild. */
  inGuilds(): KnownPlayer[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare('SELECT * FROM players WHERE server_id = ? AND guild_id IS NOT NULL ORDER BY name COLLATE NOCASE')
      .all(server.id) as PlayerRow[];
    return rows.map((r) => this.toPlayer(r));
  }

  get(id: number): KnownPlayer | undefined {
    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
    return row && this.toPlayer(row);
  }

  /** Finds a player on the primary server by exact platform id or character name (case-insensitive). */
  find(query: string): KnownPlayer[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare('SELECT * FROM players WHERE server_id = ? AND (user_id = ? OR name = ? COLLATE NOCASE) LIMIT 5')
      .all(server.id, query, query) as PlayerRow[];
    return rows.map((r) => this.toPlayer(r));
  }

  /**
   * Every player seen on the primary server. Newest activity first unless sorted otherwise;
   * `only` narrows to a set of platform IDs (e.g. who is online or banned), and `linked` to players with a website account.
   */
  list(query: {
    search?: string;
    limit: number;
    offset: number;
    sort?: 'recent' | 'name' | 'playtime' | 'level';
    only?: string[];
    linked?: 'any' | 'verified' | 'unverified';
  }): { players: KnownPlayer[]; total: number } {
    const server = this.servers.getPrimary();
    if (!server) return { players: [], total: 0 };
    const search = query.search?.trim();
    const where = ['p.server_id = @serverId'];
    const params: Record<string, unknown> = { serverId: server.id, now: new Date().toISOString() };
    if (search) {
      where.push(String.raw`(p.name LIKE @like ESCAPE '\' OR p.user_id LIKE @like ESCAPE '\' OR p.guild LIKE @like ESCAPE '\')`);
      params.like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    if (query.only) {
      if (query.only.length === 0) where.push('0');
      else {
        where.push(`p.user_id IN (${query.only.map((_, i) => `@o${i}`).join(', ')})`);
        query.only.forEach((id, i) => (params[`o${i}`] = id));
      }
    }
    if (query.linked === 'verified') where.push('EXISTS (SELECT 1 FROM site_accounts a WHERE a.player_id = p.id AND a.player_verified = 1)');
    if (query.linked === 'unverified') where.push('EXISTS (SELECT 1 FROM site_accounts a WHERE a.player_id = p.id AND a.player_verified = 0)');
    if (query.linked === 'any') where.push('EXISTS (SELECT 1 FROM site_accounts a WHERE a.player_id = p.id)');
    const playtime = `COALESCE((SELECT SUM(CAST(strftime('%s', COALESCE(s.ended_at, @now)) AS INTEGER) - CAST(strftime('%s', s.started_at) AS INTEGER)) FROM player_sessions s WHERE s.server_id = p.server_id AND s.user_id = p.user_id), 0)`;
    const order = { recent: 'p.last_seen_at DESC, p.id DESC', name: 'p.name COLLATE NOCASE', playtime: `${playtime} DESC, p.id DESC`, level: 'p.level DESC, p.name COLLATE NOCASE' }[query.sort ?? 'recent'];
    const clause = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM players p WHERE ${clause}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT p.* FROM players p WHERE ${clause} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: query.limit, offset: query.offset }) as PlayerRow[];
    return { players: rows.map((r) => this.toPlayer(r)), total };
  }

  /** The known player with this platform id on the primary server. */
  byUserId(userId: string): KnownPlayer | undefined {
    const server = this.servers.getPrimary();
    if (!server) return undefined;
    const row = this.db.prepare('SELECT * FROM players WHERE server_id = ? AND user_id = ?').get(server.id, userId) as PlayerRow | undefined;
    return row && this.toPlayer(row);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  }

  private toPlayer(row: PlayerRow): KnownPlayer {
    return {
      id: row.id,
      serverId: row.server_id,
      userId: row.user_id,
      playerId: row.player_id,
      name: row.name,
      accountName: row.account_name,
      level: row.level,
      guild: row.guild,
      guildId: row.guild_id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      online: this.online.has(row.user_id),
    };
  }
}
