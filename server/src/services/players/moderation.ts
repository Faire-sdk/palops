import { BlockList, isIP } from 'node:net';
import type { DB } from '../../database/db.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import type { Mirror, PalDefenderService } from '../paldefender/paldefender-service.js';
import type { PalworldService } from '../palworld/index.js';
import { PalworldError, type PalworldPlayer } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';
import { badRequest, notFound } from '../../utils/errors.js';
import type { PlayerDirectory } from './player-directory.js';

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

export interface IpBan {
  id: number;
  /** A single address, or a CIDR range such as 203.0.113.0/24. */
  ip: string;
  reason: string | null;
  /** The player whose ban this came from, if any. */
  playerUserId: string | null;
  playerName: string | null;
  actorUsername: string | null;
  createdAt: string;
}

interface IpBanRow {
  id: number;
  ip: string;
  reason: string | null;
  player_user_id: string | null;
  player_name: string | null;
  actor_username: string | null;
  created_at: string;
}

/** Shown to players kicked for connecting from a banned address. */
const IP_BAN_MESSAGE = 'You are banned from this server';
/** Someone retrying from a banned address is kicked every time, but their history gets one entry per window. */
const ENFORCE_RECORD_MS = 10 * 60 * 1000;
const SYSTEM_ACTOR: AuditActor = { userId: null, username: 'PalOps' };

/** Parses "1.2.3.4", "2001:db8::1" or a CIDR range; returns the normalised form or null. */
export function parseIpRule(value: string): string | null {
  const [address = '', prefix, extra] = value.trim().split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return null;
  if (prefix === undefined) return address.toLowerCase();
  if (!/^\d{1,3}$/.test(prefix)) return null;
  const bits = Number(prefix);
  if (bits > (family === 4 ? 32 : 128) || bits < (family === 4 ? 8 : 16)) return null;
  return `${address.toLowerCase()}/${bits}`;
}

function ruleMatcher(rules: string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const rule of rules) {
    const [address, prefix] = rule.split('/') as [string, string | undefined];
    const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
  }
  return (ip) => {
    // IPv4 clients can show up as IPv4-mapped IPv6 addresses.
    const plain = ip.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
    const family = isIP(plain);
    return family !== 0 && list.check(plain, family === 6 ? 'ipv6' : 'ipv4');
  };
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
    players.onRefresh((online) => {
      this.enforceIpBans(online).catch(() => undefined);
    });
  }

  private lastEnforced = new Map<string, number>();
  private banListeners: Array<(event: { userId: string; name: string | null; reason: string; actor: AuditActor }) => void> = [];
  private unbanListeners: Array<(event: { userId: string; name: string | null; actor: AuditActor }) => void> = [];

  /** Runs after a player is banned by staff or the Discord bot. */
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
   * Bans the account. With banAddress, the player's last known address is banned too, so a new
   * account can't get back in from it (a private or loopback address is skipped: it could be everybody).
   * With PalDefender switched on, the ban is mirrored there too.
   */
  async ban(
    actor: AuditActor,
    userId: string,
    reason: string,
    options: { banAddress?: boolean } = {},
  ): Promise<{ record: ModerationRecord; ipBan: IpBan | null; ipSkipped: string | null; paldefender: Mirror | null }> {
    const ip = options.banAddress ? this.players.lastAddress(userId) : null;
    if (options.banAddress && !ip) throw badRequest('PalOps hasn’t seen an address for this player yet', 'no_address');
    await this.palworld.ban(userId, reason);
    this.players.markOffline(userId);
    const record = this.store(actor, userId, 'ban', reason);
    let ipBan: IpBan | null = null;
    let ipSkipped: string | null = null;
    if (ip) {
      if (isSharedRangeIp(ip)) ipSkipped = `${ip} is a private or loopback address shared by many players, so it wasn't banned.`;
      else ipBan = (await this.banIp(actor, ip, reason, userId)).ipBan;
    }
    // PalDefender resolves the address itself, so only ask it to ban one when the panel did.
    const paldefender = await this.paldefender.mirrorBanPlayer(userId, reason, !!ipBan);
    for (const listener of this.banListeners) listener({ userId, name: record.playerName, reason, actor });
    return { record, ipBan, ipSkipped, paldefender };
  }

  /** Also lifts the address bans that came with this player's ban. */
  async unban(actor: AuditActor, userId: string, reason: string): Promise<{ record: ModerationRecord; paldefender: Mirror | null }> {
    await this.palworld.unban(userId);
    const lifted = this.ipBans().filter((b) => b.playerUserId === userId);
    for (const ban of lifted) this.liftIpBan(actor, ban.id);
    const results = [await this.paldefender.mirrorUnbanPlayer(userId, reason), ...(await Promise.all(lifted.map((b) => this.paldefender.mirrorUnbanAddress(b.ip, reason))))];
    const record = this.store(actor, userId, 'unban', reason);
    for (const listener of this.unbanListeners) listener({ userId, name: record.playerName, actor });
    return { record, paldefender: combine(results) };
  }

  // ---- Address bans ----

  /** Bans an address or range, and kicks anyone online from it now. */
  async banIp(actor: AuditActor, value: string, reason: string, playerUserId: string | null = null): Promise<{ ipBan: IpBan; paldefender: Mirror | null }> {
    const ip = parseIpRule(value);
    if (!ip) throw badRequest('Enter an IP address, or a range like 203.0.113.0/24', 'invalid_ip');
    const serverId = this.serverId();
    const existing = this.ipBans().find((b) => b.ip === ip);
    if (existing) return { ipBan: existing, paldefender: null };
    const playerName = playerUserId ? (this.players.byUserId(playerUserId)?.name ?? null) : null;
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO ip_bans (server_id, ip, reason, player_user_id, player_name, actor_user_id, actor_username)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(serverId, ip, reason || null, playerUserId, playerName, actor.userId, actor.username);
    this.audit.record(actor, {
      category: 'players',
      action: 'ip_ban',
      target: ip,
      details: { ...(reason ? { reason } : {}), ...(playerUserId ? { player: playerName ? `${playerName} (${playerUserId})` : playerUserId } : {}) },
    });
    try {
      await this.enforceIpBans(await this.palworld.getPlayers());
    } catch {
      // Server offline: the ban applies as soon as the online list can be read again.
    }
    const ipBan = toIpBan(this.db.prepare('SELECT * FROM ip_bans WHERE id = ?').get(lastInsertRowid) as IpBanRow);
    // A single address can be mirrored to PalDefender; it has no range bans.
    const paldefender = ip.includes('/') ? null : await this.paldefender.mirrorBanAddress(ip, reason, playerUserId);
    return { ipBan, paldefender };
  }

  /** Lifts an address ban and mirrors that to PalDefender. */
  async unbanIp(actor: AuditActor, id: number): Promise<Mirror | null> {
    const ip = this.liftIpBan(actor, id);
    return ip.includes('/') ? null : this.paldefender.mirrorUnbanAddress(ip);
  }

  liftIpBan(actor: AuditActor, id: number): string {
    const server = this.servers.getPrimary();
    const row = server && (this.db.prepare('SELECT * FROM ip_bans WHERE id = ? AND server_id = ? AND lifted_at IS NULL').get(id, server.id) as IpBanRow | undefined);
    if (!row) throw notFound('Address ban not found');
    this.db.prepare('UPDATE ip_bans SET lifted_at = ?, lifted_by = ? WHERE id = ?').run(new Date().toISOString(), actor.username, id);
    this.audit.record(actor, { category: 'players', action: 'ip_unban', target: row.ip });
    return row.ip;
  }

  ipBans(): IpBan[] {
    const serverId = this.servers.getPrimary()?.id;
    if (serverId === undefined) return [];
    const rows = this.db.prepare('SELECT * FROM ip_bans WHERE server_id = ? AND lifted_at IS NULL ORDER BY id DESC').all(serverId) as IpBanRow[];
    return rows.map(toIpBan);
  }

  /** The active address bans that cover this address. */
  ipBansMatching(ip: string): IpBan[] {
    return this.ipBans().filter((b) => ruleMatcher([b.ip])(ip));
  }

  /**
   * Kicks online players who connect from a banned address. The REST API has
   * no address bans, so the panel checks each fresh online list itself.
   */
  async enforceIpBans(online: PalworldPlayer[]): Promise<string[]> {
    const bans = this.ipBans();
    if (bans.length === 0) return [];
    const banned = ruleMatcher(bans.map((b) => b.ip));
    const kicked: string[] = [];
    for (const player of online) {
      if (!player.userId || !player.ip || !banned(player.ip)) continue;
      try {
        await this.palworld.kick(player.userId, IP_BAN_MESSAGE);
      } catch {
        continue;
      }
      this.players.markOffline(player.userId);
      kicked.push(player.userId);
      const last = this.lastEnforced.get(player.userId) ?? 0;
      if (Date.now() - last >= ENFORCE_RECORD_MS) {
        this.lastEnforced.set(player.userId, Date.now());
        this.store(SYSTEM_ACTOR, player.userId, 'kick', 'Connected from a banned address');
      }
    }
    return kicked;
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

function toIpBan(row: IpBanRow): IpBan {
  return {
    id: row.id,
    ip: row.ip,
    reason: row.reason,
    playerUserId: row.player_user_id,
    playerName: row.player_name,
    actorUsername: row.actor_username,
    createdAt: row.created_at,
  };
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
