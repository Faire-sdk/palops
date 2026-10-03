import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { hasPermission } from '../../services/authentication/permissions.js';
import type { StoredDiscordProfile } from '../../services/discord/profiles.js';
import { parse } from '../../utils/validation.js';

interface Row {
  id: number;
  discord_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  player_verified: number;
  verified_by: string | null;
  verified_at: string | null;
  verification_requested_at: string | null;
  linked_at: string | null;
  created_at: string;
  last_login_at: string | null;
  p_user_id: string | null;
  p_name: string | null;
  p_level: number | null;
}

/**
 * The Discord profile as staff may see it. Email and server list are personal, so
 * they're only for accounts.private (admins and owners).
 */
export function visibleProfile(profile: StoredDiscordProfile | null, showPrivate: boolean) {
  if (!profile) return null;
  return {
    connections: profile.connections,
    communityMember: profile.communityMember,
    email: showPrivate ? profile.email : null,
    emailVerified: showPrivate ? profile.emailVerified : null,
    guilds: showPrivate ? profile.guilds : null,
    updatedAt: profile.updatedAt,
  };
}

/** Website users: everyone who signed in on the public site with Discord, and the character they linked. */
export default async function accountRoutes(app: FastifyInstance, { services }: { services: Services }) {
  app.get('/', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const { filter, q } = parse(
      z.object({ filter: z.enum(['all', 'linked', 'verified', 'unlinked']).default('linked'), q: z.string().trim().max(64).default('') }),
      request.query,
    );
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter === 'linked') where.push('a.player_id IS NOT NULL');
    if (filter === 'verified') where.push('a.player_id IS NOT NULL AND a.player_verified = 1');
    if (filter === 'unlinked') where.push('a.player_id IS NULL');
    if (q) {
      where.push(`(a.discord_username LIKE ? ESCAPE '\\' OR a.discord_id = ? OR p.name LIKE ? ESCAPE '\\')`);
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, q, like);
    }
    const rows = services.db
      .prepare(
        `SELECT a.*, p.user_id AS p_user_id, p.name AS p_name, p.level AS p_level
         FROM site_accounts a LEFT JOIN players p ON p.id = a.player_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY COALESCE(a.last_login_at, a.created_at) DESC LIMIT 500`,
      )
      .all(...params) as Row[];
    const showPrivate = hasPermission(request.user!.role, 'accounts.private');
    return {
      accounts: rows.map((r) => ({
        id: r.id,
        discord: { id: r.discord_id, username: r.discord_username, avatar: r.discord_avatar },
        player: r.p_user_id ? { userId: r.p_user_id, name: r.p_name, level: r.p_level } : null,
        verified: r.player_verified === 1,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
        requestedAt: r.verification_requested_at,
        linkedAt: r.linked_at,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        profile: visibleProfile(services.discordProfiles.get(r.discord_id), showPrivate),
      })),
      /** The bot's Discord server, so the page can say which server "member" refers to. */
      communityServerId: services.discordBot.settings().guildId,
    };
  });
}
