import type { DB } from '../../database/db.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import type { PalworldService } from '../palworld/index.js';
import { PalworldError } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';
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
  ) {}

  /** The reason is stored for staff and shown to the player as the kick message. */
  async kick(actor: AuditActor, userId: string, reason: string): Promise<ModerationRecord> {
    await this.palworld.kick(userId, reason);
    this.players.markOffline(userId);
    return this.store(actor, userId, 'kick', reason);
  }

  async ban(actor: AuditActor, userId: string, reason: string): Promise<ModerationRecord> {
    await this.palworld.ban(userId, reason);
    this.players.markOffline(userId);
    return this.store(actor, userId, 'ban', reason);
  }

  async unban(actor: AuditActor, userId: string, reason: string): Promise<ModerationRecord> {
    await this.palworld.unban(userId);
    return this.store(actor, userId, 'unban', reason);
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
