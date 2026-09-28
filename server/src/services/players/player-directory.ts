import type { DB } from '../../database/db.js';
import type { PalworldPlayer, PalworldService } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';

export interface KnownPlayer {
  id: number;
  serverId: number;
  userId: string;
  playerId: string | null;
  name: string;
  level: number | null;
  guild: string | null;
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
  level: number | null;
  guild: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

const ONLINE_CACHE_MS = 5000;

/**
 * Remembers every player seen online, so the panel and the public website can
 * show people who aren't on right now. Fed from the online player list.
 */
export class PlayerDirectory {
  private online = new Set<string>();
  private cache: { at: number; players: PalworldPlayer[] } | undefined;

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
    return players;
  }

  /** Called when the server is unreachable, so nobody shows as online. */
  markAllOffline(): void {
    this.online = new Set();
    this.cache = undefined;
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
      }
    })();
    this.online = new Set(players.map((p) => p.userId));
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

  /** Every player seen on the primary server, most recently seen first. */
  list(query: { search?: string; limit: number; offset: number }): { players: KnownPlayer[]; total: number } {
    const server = this.servers.getPrimary();
    if (!server) return { players: [], total: 0 };
    const search = query.search?.trim();
    const filter = search ? String.raw`AND (name LIKE @like ESCAPE '\' OR user_id LIKE @like ESCAPE '\' OR guild LIKE @like ESCAPE '\')` : '';
    const params = search ? { serverId: server.id, like: `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` } : { serverId: server.id };
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM players WHERE server_id = @serverId ${filter}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM players WHERE server_id = @serverId ${filter} ORDER BY last_seen_at DESC, id DESC LIMIT @limit OFFSET @offset`)
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
      level: row.level,
      guild: row.guild,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      online: this.online.has(row.user_id),
    };
  }
}
