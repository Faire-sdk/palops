import type { DB } from '../../database/db.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import { PalworldError, type PalworldService, type WorldCharacter, type WorldPalBox, type WorldPoint, type WorldSnapshot } from '../palworld/index.js';
import type { KnownPlayer, PlayerDirectory } from '../players/player-directory.js';
import type { ServerRegistry } from '../servers/server-registry.js';
import { notFound } from '../../utils/errors.js';
import { distance, toMap, type MapPoint } from './map-coords.js';

/**
 * ok: fresh data. disabled: the server wasn't started with -enable-gamedata-api.
 * unavailable: the last attempt failed (server offline, timeout, ...).
 */
export type WorldState = 'ok' | 'disabled' | 'unavailable' | 'unconfigured' | 'pending';

export interface WorldStatus {
  state: WorldState;
  message: string | null;
  takenAt: string | null;
  fps: number | null;
  counts: { players: number; ownedPals: number; basePals: number; wildPals: number; npcs: number; palBoxes: number } | null;
}

export interface Guild {
  guildId: string;
  name: string;
  members: number;
  online: number;
  bases: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WorkerPal {
  instanceId: string;
  name: string;
  className: string | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
}

export interface Base {
  id: number;
  guildId: string;
  guildName: string | null;
  location: MapPoint;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Worker pals at this base in the latest snapshot; null when there's no fresh snapshot. */
  workers: WorkerPal[] | null;
}

export interface PlayerPal {
  instanceId: string;
  name: string | null;
  className: string | null;
  level: number | null;
  unitType: string;
  lastSeenAt: string;
  /** Out in the world in the latest snapshot. */
  active: boolean;
}

export type SignalKind = 'movement' | 'level' | 'shared_ip' | 'base_intrusion';

export interface PlayerSignal {
  id: number;
  userId: string;
  playerName: string | null;
  kind: SignalKind;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  dismissedAt: string | null;
  dismissedBy: string | null;
}

export interface WorldMap {
  takenAt: string;
  players: Array<{ userId: string; name: string; level: number | null; guildId: string | null; guildName: string | null; at: MapPoint }>;
  pals: Array<{ kind: 'OtomoPal' | 'BaseCampPal' | 'WildPal'; name: string; className: string | null; level: number | null; guildName: string | null; owner: string | null; at: MapPoint }>;
  npcs: Array<{ className: string | null; at: MapPoint }>;
  bases: Array<{ id: number; guildId: string; guildName: string | null; workers: number; at: MapPoint }>;
  /** More wild pals existed than are included. */
  truncated: boolean;
}

export interface Hotspot {
  cell: string;
  center: MapPoint;
  samples: number;
  avgActors: number;
  avgPlayers: number;
  /** Average server FPS in the snapshots where this area was among the busiest. */
  avgFps: number | null;
  /** avgFps minus the period's average; negative means the server ran slower. */
  fpsVsAverage: number | null;
}

export interface Performance {
  hours: number;
  avgFps: number | null;
  timeline: Array<{ at: string; fps: number | null; actors: number; players: number }>;
  hotspots: Hotspot[];
}

/** Hotspot grid: 500 m squares. */
const CELL_SIZE = 50000;
const TOP_CELLS = 8;
/** 500 m in under a snapshot interval at more than 40 m/s is faster than any mount. */
const MOVEMENT_MIN_DISTANCE = 50000;
const MOVEMENT_MIN_SPEED = 4000;
const MOVEMENT_MAX_GAP_MS = 3 * 60 * 1000;
const LEVEL_JUMP = 5;
const LEVEL_WINDOW_MS = 15 * 60 * 1000;
const DEDUPE_MS: Record<SignalKind, number> = { movement: 10 * 60 * 1000, level: 60 * 60 * 1000, shared_ip: 24 * 60 * 60 * 1000, base_intrusion: 30 * 60 * 1000 };
/** A player from another guild this close to a Pal Box (60 m) is inside the base. */
const INTRUSION_RANGE = 6000;
const MAX_WILD_PALS = 3000;
/** When the endpoint is switched off, only re-check every 5 minutes. */
const DISABLED_RETRY_MS = 5 * 60 * 1000;
/** A base worker belongs to the nearest Pal Box of its guild within this range. */
const BASE_RANGE = 10000;

interface Tracked {
  location: WorldPoint;
  at: number;
  levelBaseline: { level: number; at: number } | null;
}

interface Latest {
  takenAt: Date;
  snapshot: WorldSnapshot;
  workersByBase: Map<number, WorkerPal[]>;
  baseIds: Map<string, number>;
}

/**
 * Polls the world snapshot and turns it into what the panel shows: guilds,
 * bases, whose pals are whose, a live map, cheat signals and lag hotspots.
 * Only the latest snapshot is kept in memory; the database keeps what's worth
 * remembering between snapshots.
 */
export class WorldService {
  private latest: Latest | undefined;
  private state: WorldState = 'pending';
  private message: string | null = null;
  private lastAttempt = 0;
  /** A slow server can take longer than the poll interval to answer; don't stack requests. */
  private polling = false;
  private tracked = new Map<string, Tracked>();

  constructor(
    private readonly db: DB,
    private readonly palworld: PalworldService,
    private readonly players: PlayerDirectory,
    private readonly servers: ServerRegistry,
    private readonly audit: AuditLog,
  ) {}

  /** Called on a timer. Backs off while the endpoint is switched off on the server. */
  async poll(): Promise<void> {
    if (this.polling) return;
    if (this.state === 'disabled' && Date.now() - this.lastAttempt < DISABLED_RETRY_MS) return;
    this.polling = true;
    try {
      await this.refresh();
    } finally {
      this.polling = false;
    }
  }

  async refresh(): Promise<WorldStatus> {
    this.lastAttempt = Date.now();
    if (!this.servers.getPrimary()) {
      this.state = 'unconfigured';
      this.message = null;
      return this.status();
    }
    try {
      this.ingest(await this.palworld.getWorld());
      this.state = 'ok';
      this.message = null;
    } catch (err) {
      const code = err instanceof PalworldError ? err.code : 'internal';
      this.state = code === 'unsupported' ? 'disabled' : code === 'not_configured' ? 'unconfigured' : 'unavailable';
      this.message = err instanceof PalworldError ? err.message : 'Unexpected error while reading world data';
      if (this.state !== 'unavailable') this.latest = undefined;
    }
    return this.status();
  }

  status(): WorldStatus {
    const snap = this.latest?.snapshot;
    const count = (type: WorldCharacter['unitType']) => snap?.characters.filter((c) => c.unitType === type).length ?? 0;
    return {
      state: this.state,
      message: this.message,
      takenAt: this.latest?.takenAt.toISOString() ?? null,
      fps: snap?.fps ?? null,
      counts: snap
        ? {
            players: count('Player'),
            ownedPals: count('OtomoPal'),
            basePals: count('BaseCampPal'),
            wildPals: count('WildPal'),
            npcs: count('NPC'),
            palBoxes: snap.palBoxes.length,
          }
        : null,
    };
  }

  /** Records a snapshot. Public so tests can feed crafted snapshots. */
  ingest(snapshot: WorldSnapshot, takenAt = new Date()): void {
    const server = this.servers.getPrimary();
    if (!server) return;
    const serverId = server.id;
    const now = takenAt.toISOString();
    const playerChars = snapshot.characters.filter((c) => c.unitType === 'Player' && c.userId);
    const ownerByInstance = new Map(playerChars.map((p) => [p.instanceId, p]));

    const baseIds = new Map<string, number>();
    this.db.transaction(() => {
      const upsertGuild = this.db.prepare(
        `INSERT INTO guilds (server_id, guild_id, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (server_id, guild_id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
      );
      const guilds = new Map<string, string>();
      for (const c of [...snapshot.characters, ...snapshot.palBoxes]) {
        if (c.guildId && c.guildName) guilds.set(c.guildId, c.guildName);
      }
      for (const [id, name] of guilds) upsertGuild.run(serverId, id, name, now, now);

      const upsertBase = this.db.prepare(
        `INSERT INTO bases (server_id, guild_id, cell, x, y, z, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (server_id, guild_id, cell) DO UPDATE SET x = excluded.x, y = excluded.y, z = excluded.z, last_seen_at = excluded.last_seen_at
         RETURNING id`,
      );
      for (const box of snapshot.palBoxes) {
        if (!box.guildId) continue;
        const { x, y, z } = box.location;
        const key = baseKey(box.guildId, box.location);
        const row = upsertBase.get(serverId, box.guildId, key.split('|')[1], x, y, z, now, now) as { id: number };
        baseIds.set(key, row.id);
      }

      this.players.applyWorld(
        serverId,
        playerChars.map((p) => ({ userId: p.userId!, level: p.level, guildId: p.guildId, guildName: p.guildName })),
      );

      const upsertPal = this.db.prepare(
        `INSERT INTO world_pals (server_id, instance_id, owner_user_id, class_name, nickname, level, unit_type, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (server_id, instance_id) DO UPDATE SET owner_user_id = excluded.owner_user_id, class_name = excluded.class_name,
           nickname = excluded.nickname, level = excluded.level, unit_type = excluded.unit_type, last_seen_at = excluded.last_seen_at`,
      );
      for (const pal of snapshot.characters) {
        const owner = pal.trainerInstanceId ? ownerByInstance.get(pal.trainerInstanceId) : undefined;
        if (!owner || pal.unitType === 'Player' || !pal.instanceId) continue;
        upsertPal.run(serverId, pal.instanceId, owner.userId, pal.className, pal.name || null, pal.level, pal.unitType, now);
      }

      this.detectSignals(serverId, playerChars, snapshot.palBoxes, takenAt);
      this.recordPerformance(serverId, snapshot, now);
    })();

    this.latest = { takenAt, snapshot, baseIds, workersByBase: assignWorkers(snapshot, baseIds) };
    this.players.recordIps(
      serverId,
      playerChars.map((p) => ({ userId: p.userId!, name: p.name, ip: p.ip })),
    );
  }

  /** Where a player is in the latest snapshot, in map coordinates. */
  positionOf(userId: string): MapPoint | null {
    const p = this.state === 'ok' ? this.latest?.snapshot.characters.find((c) => c.unitType === 'Player' && c.userId === userId) : undefined;
    return p ? toMap(p.location) : null;
  }

  // ---- Guilds and bases ----

  guilds(): Guild[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare(
        `SELECT g.guild_id, g.name, g.first_seen_at, g.last_seen_at,
           (SELECT COUNT(*) FROM bases b WHERE b.server_id = g.server_id AND b.guild_id = g.guild_id) AS bases
         FROM guilds g WHERE g.server_id = ? ORDER BY g.last_seen_at DESC, g.name`,
      )
      .all(server.id) as Array<{ guild_id: string; name: string; first_seen_at: string; last_seen_at: string; bases: number }>;
    const members = groupBy(this.players.inGuilds(), (p) => p.guildId!);
    return rows.map((r) => ({
      guildId: r.guild_id,
      name: r.name,
      members: members.get(r.guild_id)?.length ?? 0,
      online: members.get(r.guild_id)?.filter((p) => p.online).length ?? 0,
      bases: r.bases,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  guild(guildId: string): { guild: Guild; members: KnownPlayer[]; bases: Base[] } {
    const guild = this.guilds().find((g) => g.guildId === guildId);
    if (!guild) throw notFound('Guild not found');
    return {
      guild,
      members: this.players.inGuilds().filter((p) => p.guildId === guildId),
      bases: this.bases().filter((b) => b.guildId === guildId),
    };
  }

  bases(): Base[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const rows = this.db
      .prepare(
        `SELECT b.*, g.name AS guild_name FROM bases b
         LEFT JOIN guilds g ON g.server_id = b.server_id AND g.guild_id = b.guild_id
         WHERE b.server_id = ? ORDER BY g.name, b.id`,
      )
      .all(server.id) as Array<{ id: number; guild_id: string; guild_name: string | null; x: number; y: number; first_seen_at: string; last_seen_at: string }>;
    const fresh = this.state === 'ok' ? this.latest : undefined;
    return rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      guildName: r.guild_name,
      location: toMap(r),
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      workers: fresh ? (fresh.workersByBase.get(r.id) ?? []) : null,
    }));
  }

  // ---- Players ----

  palsOf(userId: string): PlayerPal[] {
    const server = this.servers.getPrimary();
    if (!server) return [];
    const active = new Set(this.latest?.snapshot.characters.map((c) => c.instanceId));
    const rows = this.db
      .prepare('SELECT * FROM world_pals WHERE server_id = ? AND owner_user_id = ? ORDER BY last_seen_at DESC LIMIT 50')
      .all(server.id, userId) as Array<{ instance_id: string; nickname: string | null; class_name: string | null; level: number | null; unit_type: string; last_seen_at: string }>;
    return rows.map((r) => ({
      instanceId: r.instance_id,
      name: r.nickname,
      className: r.class_name,
      level: r.level,
      unitType: r.unit_type,
      lastSeenAt: r.last_seen_at,
      active: this.state === 'ok' && active.has(r.instance_id),
    }));
  }

  map(): WorldMap | null {
    if (!this.latest) return null;
    const { snapshot, takenAt, workersByBase, baseIds } = this.latest;
    const names = new Map(snapshot.characters.filter((c) => c.unitType === 'Player').map((p) => [p.instanceId, p.name]));
    const wild = snapshot.characters.filter((c) => c.unitType === 'WildPal');
    const pals = snapshot.characters.filter(
      (c): c is WorldCharacter & { unitType: 'OtomoPal' | 'BaseCampPal' | 'WildPal' } => c.unitType === 'OtomoPal' || c.unitType === 'BaseCampPal',
    );
    return {
      takenAt: takenAt.toISOString(),
      players: snapshot.characters
        .filter((c) => c.unitType === 'Player' && c.userId)
        .map((p) => ({ userId: p.userId!, name: p.name, level: p.level, guildId: p.guildId, guildName: p.guildName, at: toMap(p.location) })),
      pals: [...pals, ...(wild.slice(0, MAX_WILD_PALS) as typeof pals)].map((p) => ({
        kind: p.unitType,
        name: p.name,
        className: p.className,
        level: p.level,
        guildName: p.guildName,
        owner: p.trainerInstanceId ? (names.get(p.trainerInstanceId) ?? null) : null,
        at: toMap(p.location),
      })),
      npcs: snapshot.characters.filter((c) => c.unitType === 'NPC').map((n) => ({ className: n.className, at: toMap(n.location) })),
      bases: snapshot.palBoxes
        .filter((b) => b.guildId)
        .map((b) => {
          const id = baseIds.get(baseKey(b.guildId!, b.location))!;
          return { id, guildId: b.guildId!, guildName: b.guildName, workers: workersByBase.get(id)?.length ?? 0, at: toMap(b.location) };
        }),
      truncated: wild.length > MAX_WILD_PALS,
    };
  }

  // ---- Signals ----

  signals(query: { includeDismissed?: boolean; userId?: string; limit: number; offset: number }): { signals: PlayerSignal[]; total: number } {
    const server = this.servers.getPrimary();
    if (!server) return { signals: [], total: 0 };
    const where = ['server_id = @serverId'];
    if (!query.includeDismissed) where.push('dismissed_at IS NULL');
    if (query.userId) where.push('user_id = @userId');
    const params = { serverId: server.id, userId: query.userId };
    const clause = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM player_signals WHERE ${clause}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM player_signals WHERE ${clause} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: query.limit, offset: query.offset }) as SignalRow[];
    return { signals: rows.map(toSignal), total };
  }

  dismissSignal(actor: AuditActor, id: number): PlayerSignal {
    const server = this.servers.getPrimary();
    const row = server && (this.db.prepare('SELECT * FROM player_signals WHERE id = ? AND server_id = ?').get(id, server.id) as SignalRow | undefined);
    if (!row) throw notFound('Signal not found');
    if (!row.dismissed_at) {
      this.db
        .prepare('UPDATE player_signals SET dismissed_at = ?, dismissed_by = ? WHERE id = ?')
        .run(new Date().toISOString(), actor.username, id);
      this.audit.record(actor, {
        category: 'players',
        action: 'signal_dismissed',
        target: row.player_name ? `${row.player_name} (${row.user_id})` : row.user_id,
        details: { kind: row.kind, summary: row.summary },
      });
    }
    return toSignal(this.db.prepare('SELECT * FROM player_signals WHERE id = ?').get(id) as SignalRow);
  }

  private detectSignals(serverId: number, players: WorldCharacter[], palBoxes: WorldPalBox[], takenAt: Date): void {
    const at = takenAt.getTime();
    const raise = (userId: string, name: string, kind: SignalKind, summary: string, dedupeKey: string, details: Record<string, unknown>) => {
      const since = new Date(at - DEDUPE_MS[kind]).toISOString();
      const existing = this.db
        .prepare('SELECT 1 FROM player_signals WHERE server_id = ? AND dedupe_key = ? AND created_at >= ? LIMIT 1')
        .get(serverId, dedupeKey, since);
      if (existing) return;
      this.db
        .prepare(
          'INSERT INTO player_signals (server_id, user_id, player_name, kind, summary, dedupe_key, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(serverId, userId, name, kind, summary, dedupeKey, JSON.stringify(details), takenAt.toISOString());
    };

    for (const p of players) {
      const userId = p.userId!;
      const prev = this.tracked.get(userId);
      let baseline = prev?.levelBaseline ?? null;
      if (prev && at - prev.at <= MOVEMENT_MAX_GAP_MS && at > prev.at) {
        const moved = distance(prev.location, p.location);
        const speed = moved / ((at - prev.at) / 1000);
        if (moved >= MOVEMENT_MIN_DISTANCE && speed >= MOVEMENT_MIN_SPEED) {
          const seconds = Math.round((at - prev.at) / 1000);
          raise(userId, p.name, 'movement', `Moved ${(moved / 100000).toFixed(1)} km in ${seconds} s. Fast travel and respawning also do this.`, `movement:${userId}`, {
            from: toMap(prev.location),
            to: toMap(p.location),
            meters: Math.round(moved / 100),
            seconds,
          });
        }
      }
      if (p.level !== null) {
        if (baseline && at - baseline.at <= LEVEL_WINDOW_MS && p.level - baseline.level >= LEVEL_JUMP) {
          const minutes = Math.max(1, Math.round((at - baseline.at) / 60000));
          raise(userId, p.name, 'level', `Went from level ${baseline.level} to ${p.level} in ${minutes} min.`, `level:${userId}`, {
            from: baseline.level,
            to: p.level,
            minutes,
          });
          baseline = { level: p.level, at };
        } else if (!baseline || at - baseline.at > LEVEL_WINDOW_MS || p.level < baseline.level) {
          baseline = { level: p.level, at };
        }
      }
      this.tracked.set(userId, { location: p.location, at, levelBaseline: baseline });
    }

    for (const p of players) {
      for (const box of palBoxes) {
        if (!box.guildId || box.guildId === p.guildId) continue;
        const d = distance(p.location, box.location);
        if (d > INTRUSION_RANGE) continue;
        const owner = box.guildName ?? 'an unknown guild';
        raise(
          p.userId!,
          p.name,
          'base_intrusion',
          `Inside ${owner}'s base, ${Math.round(d / 100)} m from its Pal Box, and not a member of that guild. Visiting friends and allies also do this.`,
          `base_intrusion:${p.userId}:${baseKey(box.guildId, box.location)}`,
          { guildId: box.guildId, guildName: box.guildName, base: toMap(box.location), player: toMap(p.location), meters: Math.round(d / 100) },
        );
      }
    }

    const byIp = groupBy(
      players.filter((p) => p.ip),
      (p) => p.ip!,
    );
    for (const [ip, group] of byIp) {
      const unique = [...new Map(group.map((p) => [p.userId!, p])).values()].sort((a, b) => a.userId!.localeCompare(b.userId!));
      if (unique.length < 2) continue;
      const names = unique.map((p) => p.name);
      const key = `shared_ip:${unique.map((p) => p.userId).join(',')}`;
      for (const p of unique) {
        const others = names.filter((n) => n !== p.name).join(', ');
        raise(p.userId!, p.name, 'shared_ip', `Playing from the same address as ${others}. Housemates and shared networks also do this.`, `${key}:${p.userId}`, {
          ip,
          players: unique.map((u) => ({ userId: u.userId, name: u.name })),
        });
      }
    }
  }

  // ---- Performance ----

  private recordPerformance(serverId: number, snapshot: WorldSnapshot, now: string): void {
    const cells = new Map<string, { actors: number; players: number }>();
    for (const c of snapshot.characters) {
      const key = `${Math.floor(c.location.x / CELL_SIZE)}:${Math.floor(c.location.y / CELL_SIZE)}`;
      const cell = cells.get(key) ?? { actors: 0, players: 0 };
      cell.actors++;
      if (c.unitType === 'Player') cell.players++;
      cells.set(key, cell);
    }
    const top = [...cells.entries()]
      .sort((a, b) => b[1].actors - a[1].actors)
      .slice(0, TOP_CELLS)
      .map(([cell, v]) => ({ cell, ...v }));
    this.db
      .prepare('INSERT INTO world_perf (server_id, taken_at, fps, actors, players, cells) VALUES (?, ?, ?, ?, ?, ?)')
      .run(serverId, now, snapshot.fps, snapshot.characters.length, snapshot.characters.filter((c) => c.unitType === 'Player').length, JSON.stringify(top));
  }

  performance(hours: number): Performance {
    const server = this.servers.getPrimary();
    if (!server) return { hours, avgFps: null, timeline: [], hotspots: [] };
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const rows = this.db
      .prepare('SELECT taken_at, fps, actors, players, cells FROM world_perf WHERE server_id = ? AND taken_at >= ? ORDER BY taken_at')
      .all(server.id, since) as Array<{ taken_at: string; fps: number | null; actors: number; players: number; cells: string }>;

    const fpsValues = rows.map((r) => r.fps).filter((f): f is number => f !== null);
    const avgFps = fpsValues.length ? mean(fpsValues) : null;

    const cells = new Map<string, { samples: number; actors: number; players: number; fps: number[] }>();
    for (const r of rows) {
      for (const c of JSON.parse(r.cells) as Array<{ cell: string; actors: number; players: number }>) {
        const agg = cells.get(c.cell) ?? { samples: 0, actors: 0, players: 0, fps: [] };
        agg.samples++;
        agg.actors += c.actors;
        agg.players += c.players;
        if (r.fps !== null) agg.fps.push(r.fps);
        cells.set(c.cell, agg);
      }
    }
    const hotspots = [...cells.entries()]
      .map(([cell, a]): Hotspot => {
        const [i = 0, j = 0] = cell.split(':').map(Number);
        return {
          cell,
          center: toMap({ x: (i + 0.5) * CELL_SIZE, y: (j + 0.5) * CELL_SIZE }),
          samples: a.samples,
          avgActors: round1(a.actors / a.samples),
          avgPlayers: round1(a.players / a.samples),
          avgFps: a.fps.length ? round1(mean(a.fps)) : null,
          fpsVsAverage: a.fps.length && avgFps !== null ? round1(mean(a.fps) - avgFps) : null,
        };
      })
      // Busiest areas first; the FPS columns show whether the server slows down when they're busy.
      .sort((a, b) => b.avgActors - a.avgActors || (a.avgFps ?? Infinity) - (b.avgFps ?? Infinity))
      .slice(0, 10);

    return { hours, avgFps: avgFps === null ? null : round1(avgFps), timeline: downsample(rows), hotspots };
  }

  /** Drops old performance samples and pals not seen for a month. */
  prune(): void {
    const day = 24 * 3600 * 1000;
    this.db.prepare('DELETE FROM world_perf WHERE taken_at < ?').run(new Date(Date.now() - 7 * day).toISOString());
    this.db.prepare('DELETE FROM world_pals WHERE last_seen_at < ?').run(new Date(Date.now() - 30 * day).toISOString());
  }
}

interface SignalRow {
  id: number;
  user_id: string;
  player_name: string | null;
  kind: SignalKind;
  summary: string;
  details: string | null;
  created_at: string;
  dismissed_at: string | null;
  dismissed_by: string | null;
}

function toSignal(r: SignalRow): PlayerSignal {
  return {
    id: r.id,
    userId: r.user_id,
    playerName: r.player_name,
    kind: r.kind,
    summary: r.summary,
    details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
    createdAt: r.created_at,
    dismissedAt: r.dismissed_at,
    dismissedBy: r.dismissed_by,
  };
}

function baseKey(guildId: string, p: WorldPoint): string {
  return `${guildId}|${Math.round(p.x / 500)}:${Math.round(p.y / 500)}`;
}

/** Puts each base worker at the nearest Pal Box of its guild. */
function assignWorkers(snapshot: WorldSnapshot, baseIds: Map<string, number>): Map<number, WorkerPal[]> {
  const result = new Map<number, WorkerPal[]>();
  const boxes = snapshot.palBoxes
    .filter((b) => b.guildId)
    .map((b) => ({ ...b, id: baseIds.get(baseKey(b.guildId!, b.location))! }));
  for (const box of boxes) result.set(box.id, []);
  for (const pal of snapshot.characters) {
    if (pal.unitType !== 'BaseCampPal') continue;
    let best: { id: number; d: number } | undefined;
    for (const box of boxes) {
      if (pal.guildId && box.guildId !== pal.guildId) continue;
      const d = distance(pal.location, box.location);
      if (d <= BASE_RANGE && (!best || d < best.d)) best = { id: box.id, d };
    }
    if (best) {
      result.get(best.id)!.push({ instanceId: pal.instanceId, name: pal.name, className: pal.className, level: pal.level, hp: pal.hp, maxHp: pal.maxHp });
    }
  }
  return result;
}

function downsample(rows: Array<{ taken_at: string; fps: number | null; actors: number; players: number }>, max = 120) {
  const size = Math.max(1, Math.ceil(rows.length / max));
  const out: Performance['timeline'] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const fps = chunk.map((r) => r.fps).filter((f): f is number => f !== null);
    out.push({
      at: chunk[0]!.taken_at,
      fps: fps.length ? round1(mean(fps)) : null,
      actors: Math.round(mean(chunk.map((r) => r.actors))),
      players: Math.round(mean(chunk.map((r) => r.players))),
    });
  }
  return out;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round1 = (n: number) => Math.round(n * 10) / 10;
