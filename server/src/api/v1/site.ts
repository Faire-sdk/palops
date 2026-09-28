import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLAYER_COOKIE } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import type { SiteAccount } from '../../services/site/site-accounts.js';
import { badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { parse } from '../../utils/validation.js';

/** The signed-in player's own account on the public website. */
export default async function siteRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const linkAttempts = new RateLimiter(20, 15 * 60 * 1000);

  const currentAccount = (request: FastifyRequest): SiteAccount => {
    const token = request.cookies[PLAYER_COOKIE];
    const account = token ? services.siteAccounts.validateSession(token) : undefined;
    if (!account) throw unauthorized();
    return account;
  };

  const view = (account: SiteAccount) => {
    const player = account.playerId ? services.players.get(account.playerId) : undefined;
    return {
      account: { discord: account.discord, createdAt: account.createdAt },
      character: player
        ? {
            name: player.name,
            level: player.level,
            guild: player.guild,
            online: player.online,
            firstSeenAt: player.firstSeenAt,
            lastSeenAt: player.lastSeenAt,
            // Shown only to the account holder, to confirm the right character.
            platformId: player.userId,
            verified: account.playerVerified,
            linkedAt: account.linkedAt,
          }
        : null,
    };
  };

  app.get('/me', async (request) => view(currentAccount(request)));

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[PLAYER_COOKIE];
    if (token) services.siteAccounts.revokeSession(token);
    reply.clearCookie(PLAYER_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/link', async (request) => {
    const account = currentAccount(request);
    if (!linkAttempts.consume(`link:${account.id}`)) throw badRequest('Too many attempts, try again later', 'rate_limited');
    const { query } = parse(z.object({ query: z.string().trim().min(2).max(64) }), request.body);
    // Refresh so someone who just joined can be found.
    await services.players.refreshOnline().catch(() => undefined);
    const matches = services.players.find(query);
    if (matches.length === 0) {
      throw notFound('No character with that name or ID has been seen on the server yet. Join the server once, then try again.');
    }
    if (matches.length > 1) throw badRequest('Several characters have that name. Enter your platform ID (e.g. steam_7656...) instead.', 'ambiguous');
    const linked = services.siteAccounts.linkPlayer(account.id, matches[0]!.id);
    services.audit.record(
      { userId: null, username: `discord:${account.discord.username ?? account.discord.id}`, ip: request.ip },
      { category: 'players', action: 'character_linked', target: matches[0]!.name, details: { discordId: account.discord.id, platformId: matches[0]!.userId } },
    );
    return view(linked);
  });

  app.post('/unlink', async (request) => {
    const account = currentAccount(request);
    services.siteAccounts.unlinkPlayer(account.id);
    return view(services.siteAccounts.get(account.id)!);
  });
}
