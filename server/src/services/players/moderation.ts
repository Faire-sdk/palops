import type { DB } from '../../database/db.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import type { Mirror, PalDefenderService } from '../paldefender/paldefender-service.js';
import type { PalworldService } from '../palworld/index.js';
import { PalworldError } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { isIP } from 'node:net';
import { normalizeIp, type PlayerDirectory, type SeenPlayer } from './player-directory.js';

export const MODERATION_ACTIONS = ['kick', 'ban', 'unban', 'note'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface ModerationRecord {
  id: number;
  playerUserId: string;
  playerName: string | null;
  action: ModerationAction;
  reason: string | null;
  actorUsername: string | null;
  createdAt: string;
}

export interface IpBan {
  id: number;
  ip: string;
  reason: string | null;
  /** The player whose ban this address was added with, if any. */
  sourceUserId: string | null;
  sourceName: string | null;
  actorUsername: string | null;
  createdAt: string;
  /** Other accounts seen on this address. */
  accounts: Array<{ userId: string; name: string }>;
}

interface IpBanRow {
  id: number;
  ip: string;
  reason: string | null;
  source_user_id: string | null;
  source_name: string | null;
  actor_username: string | null;
  created_at: string;
}

/** Enforcing an IP ban is the panel acting on its own, not a staff member. */
const SYSTEM_ACTOR: AuditActor = { userId: null, username: 'PalOps (IP ban)' };

/**
 * Loopback and private ranges: behind a proxy, a tunnel or the same network,
 * every player can look like one of these, so banning one would ban everybody.
 */
export function isSharedRangeIp(ip: string): boolean {
  if (isIP(ip) === 6) return ip === '::1' || ip === '::' || /^(fc|fd|fe80)/.test(ip);
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

interface ModerationRow {
  id: number;
  player_user_id: string;
  player_name: string | null;
  action: ModerationAction;
  reason: string | null;
  actor_username: string | null;
  created_at: string;
}

/**
 * Kicks, bans and staff notes. Every action goes to the server through the
 * REST API and is kept here, because the API itself has no ban list or history.
 */
export class ModerationService {
  constructor(
    private readonly db: DB,
    private readonly palworld: PalworldService,
    private readonly players: PlayerDirectory,
    private readonly servers: ServerRegistry,
    private readonly audit: AuditLog,
    private readonly paldefender: PalDefenderService,
  ) {
    players.onSeen((seen) => this.enforceIpBans(seen));
  }

  /** Accounts currently being banned for their address, so two polls don't race. */
  private enforcing = new Set<string>();
  private banListeners: Array<(event: { userId: string; name: string | null; reason: string; actor: AuditActor }) => void> = [];
  private unbanListeners: Array<(event: { userId: string; name: string | null; actor: AuditActor }) => void> = [];

  /** Runs after a player is banned, by anyone or anything (staff, the Discord bot, address enforcement). */
  onBan(listener: (event: { userId: string; name: string | null; reason: string; actor: AuditActor }) => void): void {
    this.banListeners.push(listener);
  }

  onUnban(listener: (event: { userId: string; name: string | null; actor: AuditActor }) => void): void {
    this.unbanListeners.push(listener);
  }

  /** The reason is stored for staff and shown to the player as the kick message. */
  async kick(actor: AuditActor, userId: string, reason: string): Promise<ModerationRecord> {
    await this.palworld.kick(userId, reason);
    this.players.markOffline(userId);
    return this.store(actor, userId, 'kick', reason);
  }

  /**
   * Bans the account. With banIp, also bans the address they last connected
   * from (unless it's a shared range), so a new account from there is banned too.
   * With PalDefender switched on, the ban is mirrored there too (`paldefender`).
   */
  async ban(
    actor: AuditActor,
    userId: string,
    reason: string,
    options: { banIp?: boolean } = {},
  ): Promise<{ record: ModerationRecord; ipBan: IpBan | null; ipSkipped: string | null; paldefender: Mirror | null }> {
    await this.palworld.ban(userId, reason);
    this.players.markOffline(userId);
    const record = this.store(actor, userId, 'ban', reason);
    let ipBan: IpBan | null = null;
    let ipSkipped: string | null = null;
    if (options.banIp) {
      const latest = this.players.ipsOf(userId)[0];
      if (!latest) ipSkipped = 'PalOps has no address on record for this player yet.';
      else if (isSharedRangeIp(latest.ip)) ipSkipped = `${latest.ip} is a private or loopback address shared by many players, so it wasn't banned.`;
      else ipBan = this.addIpBan(actor, latest.ip, reason, userId);
    }
    // PalDefender resolves the address itself, so only ask it to ban one when the panel did.
    const paldefender = await this.paldefender.mirrorBanPlayer(userId, reason, !!ipBan);
    for (const listener of this.banListeners) listener({ userId, name: record.playerName, reason, actor });
    return { record, ipBan, ipSkipped, paldefender };
  }

  /** Unbanning a player also lifts the addresses banned along with them, or they'd be banned again on their next join. */
  async unban(actor: AuditActor, userId: string, reason: string): Promise<{ record: ModerationRecord; paldefender: Mirror | null }> {
    await this.palworld.unban(userId);
    const serverId = this.servers.getPrimary()?.id;
    const lifted: string[] = [];
    if (serverId !== undefined) {
      const rows = this.db.prepare('DELETE FROM ip_bans WHERE server_id = ? AND source_user_id = ? RETURNING ip').all(serverId, userId) as Array<{ ip: string }>;
      for (const { ip } of rows) {
        lifted.push(ip);
        this.audit.record(actor, { category: 'players', action: 'ip_unban', target: ip, details: { withPlayer: userId } });
      }
    }
    const results = [await this.paldefender.mirrorUnbanPlayer(userId, reason), ...(await Promise.all(lifted.map((ip) => this.paldefender.mirrorUnbanAddress(ip, reason))))];
    const record = this.store(actor, userId, 'unban', reason);
    for (const listener of this.unbanListeners) listener({ userId, name: record.playerName, actor });
    return { record, paldefender: combine(results) };
  }

  // ---- IP bans ----

  ipBans(): IpBan[] {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return [];
    const rows = this.db.prepare('SELECT * FROM ip_bans WHERE server_id = ? ORDER BY id DESC').all(serverId) as IpBanRow[];
    return rows.map((r) => this.toIpBan(r));
  }

  isIpBanned(ip: string): boolean {
    const serverId = this.servers.getPrimary()?.id;
    return serverId !== undefined && !!this.db.prepare('SELECT 1 FROM ip_bans WHERE server_id = ? AND ip = ?').get(serverId, normalizeIp(ip));
  }

  /** Bans an address by hand. Accounts seen on it later are banned when they connect. */
  async banIp(actor: AuditActor, rawIp: string, reason: string): Promise<{ ipBan: IpBan; paldefender: Mirror | null }> {
    const ip = normalizeIp(rawIp);
    if (!ip || !isIP(ip)) throw badRequest('Enter a valid IPv4 or IPv6 address', 'invalid_ip');
    if (isSharedRangeIp(ip)) throw badRequest('That is a private or loopback address. Banning it could block every player behind the same network or proxy.', 'shared_ip_range');
    const ban = this.addIpBan(actor, ip, reason, null);
    // Anyone on it right now goes too, without waiting for the next check.
    this.enforceIpBans(
      this.players
        .playersOnIp(ip)
        .filter((p) => this.players.liveOf(p.userId))
        .map((p) => ({ userId: p.userId, name: p.name, ip })),
    );
    return { ipBan: ban, paldefender: await this.paldefender.mirrorBanAddress(ip, reason) };
  }

  async unbanIp(actor: AuditActor, id: number): Promise<Mirror | null> {
    const serverId = this.servers.getPrimary()?.id;
    const row = serverId !== undefined ? (this.db.prepare('SELECT * FROM ip_bans WHERE id = ? AND server_id = ?').get(id, serverId) as IpBanRow | undefined) : undefined;
    if (!row) throw notFound('IP ban not found');
    this.db.prepare('DELETE FROM ip_bans WHERE id = ?').run(id);
    this.audit.record(actor, { category: 'players', action: 'ip_unban', target: row.ip });
    return this.paldefender.mirrorUnbanAddress(row.ip);
  }

  private addIpBan(actor: AuditActor, ip: string, reason: string, sourceUserId: string | null): IpBan {
    const serverId = this.serverId();
    const sourceName = sourceUserId ? (this.players.byUserId(sourceUserId)?.name ?? null) : null;
    this.db
      .prepare(
        `INSERT INTO ip_bans (server_id, ip, reason, source_user_id, source_name, actor_username) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (server_id, ip) DO UPDATE SET reason = excluded.reason, actor_username = excluded.actor_username`,
      )
      .run(serverId, ip, reason || null, sourceUserId, sourceName, actor.username);
    this.audit.record(actor, { category: 'players', action: 'ip_ban', target: ip, details: { reason: reason || undefined, player: sourceName ?? sourceUserId ?? undefined } });
    return this.toIpBan(this.db.prepare('SELECT * FROM ip_bans WHERE server_id = ? AND ip = ?').get(serverId, ip) as IpBanRow);
  }

  /**
   * The game can't ban an address, so a banned address is enforced here: any
   * account seen connecting from one is banned (and kicked) at the next check,
   * which runs with every world snapshot and player list refresh.
   */
  private enforceIpBans(seen: SeenPlayer[]): void {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return;
    const banned = new Map((this.db.prepare('SELECT ip, reason FROM ip_bans WHERE server_id = ?').all(serverId) as Array<{ ip: string; reason: string | null }>).map((b) => [b.ip, b.reason]));
    if (banned.size === 0) return;
    for (const p of seen) {
      if (!banned.has(p.ip) || this.enforcing.has(p.userId)) continue;
      const reason = `Banned address${banned.get(p.ip) ? `: ${banned.get(p.ip)}` : ''}`.slice(0, 200);
      this.enforcing.add(p.userId);
      void (async () => {
        try {
          await this.palworld.ban(p.userId, reason);
          this.players.markOffline(p.userId);
          if (!this.isBanned(p.userId)) {
            const record = this.store(SYSTEM_ACTOR, p.userId, 'ban', `${reason} (${p.ip})`);
            for (const listener of this.banListeners) listener({ userId: p.userId, name: record.playerName, reason, actor: SYSTEM_ACTOR });
          }
        } catch {
          // Server unreachable or the call failed; the next snapshot tries again.
        } finally {
          this.enforcing.delete(p.userId);
        }
      })();
    }
  }

  private toIpBan(r: IpBanRow): IpBan {
    return {
      id: r.id,
      ip: r.ip,
      reason: r.reason,
      sourceUserId: r.source_user_id,
      sourceName: r.source_name,
      actorUsername: r.actor_username,
      createdAt: r.created_at,
      accounts: this.players.playersOnIp(r.ip).map((p) => ({ userId: p.userId, name: p.name })),
    };
  }

  note(actor: AuditActor, userId: string, text: string): ModerationRecord {
    return this.store(actor, userId, 'note', text);
  }

  history(userId: string): ModerationRecord[] {
    const serverId = this.serverId();
    const rows = this.db
      .prepare('SELECT * FROM moderation_actions WHERE server_id = ? AND player_user_id = ? ORDER BY id DESC LIMIT 200')
      .all(serverId, userId) as ModerationRow[];
    return rows.map(toRecord);
  }

  /** Players whose latest ban or unban through the panel is a ban. */
  activeBans(): ModerationRecord[] {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return [];
    const rows = this.db
      .prepare(
        `SELECT m.* FROM moderation_actions m
         WHERE m.server_id = @serverId AND m.action = 'ban'
           AND m.id = (SELECT MAX(id) FROM moderation_actions
                       WHERE server_id = m.server_id AND player_user_id = m.player_user_id AND action IN ('ban', 'unban'))
         ORDER BY m.id DESC`,
      )
      .all({ serverId }) as ModerationRow[];
    return rows.map(toRecord);
  }

  isBanned(userId: string): boolean {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return false;
    const row = this.db
      .prepare(
        `SELECT action FROM moderation_actions WHERE server_id = ? AND player_user_id = ? AND action IN ('ban', 'unban')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(serverId, userId) as { action: ModerationAction } | undefined;
    return row?.action === 'ban';
  }

  private store(actor: AuditActor, userId: string, action: ModerationAction, reason: string): ModerationRecord {
    const serverId = this.serverId();
    const playerName = this.players.byUserId(userId)?.name ?? null;
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO moderation_actions (server_id, player_user_id, player_name, action, reason, actor_user_id, actor_username)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(serverId, userId, playerName, action, reason || null, actor.userId, actor.username);
    this.audit.record(actor, {
      category: 'players',
      action: action === 'note' ? 'note_added' : action,
      target: playerName ? `${playerName} (${userId})` : userId,
      details: reason ? { reason } : undefined,
    });
    const row = this.db.prepare('SELECT * FROM moderation_actions WHERE id = ?').get(lastInsertRowid) as ModerationRow;
    return toRecord(row);
  }

  private serverId(): number {
    const server = this.servers.getPrimary();
    if (!server) throw new PalworldError('not_configured', 'No Palworld server is configured');
    return server.id;
  }
}

/** One result for several mirrored calls: ok only if all were, with the first failure's message. */
function combine(results: Array<Mirror | null>): Mirror | null {
  const present = results.filter((r): r is Mirror => r !== null);
  if (present.length === 0) return null;
  return present.find((r) => !r.ok) ?? { ok: true, message: null };
}

function toRecord(row: ModerationRow): ModerationRecord {
  return {
    id: row.id,
    playerUserId: row.player_user_id,
    playerName: row.player_name,
    action: row.action,
    reason: row.reason,
    actorUsername: row.actor_username,
    createdAt: row.created_at,
  };
}
