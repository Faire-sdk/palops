import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLAYER_COOKIE } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import type { SiteAccount } from '../../services/site/site-accounts.js';
import { PalDefenderError } from '../../services/paldefender/paldefender-client.js';
import { badRequest, conflict, notFound, tooManyRequests, unauthorized } from '../../utils/errors.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { parse } from '../../utils/validation.js';

/** The signed-in player's own account on the public website. */
export default async function siteRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const linkAttempts = new RateLimiter(20, 15 * 60 * 1000);
  const codeRequests = new RateLimiter(5, 15 * 60 * 1000);
  const codeGuesses = new RateLimiter(12, 15 * 60 * 1000);

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
            /** For the public profile page. */
            profileId: player.id,
            playtimeSeconds: services.players.playtime(player.userId).seconds,
            sessions: services.players.playtime(player.userId).sessions,
            verified: account.playerVerified,
            verifiedBy: account.verifiedBy === 'code' ? 'in-game code' : account.verifiedBy ? 'staff' : null,
            verifiedAt: account.verifiedAt,
            linkedAt: account.linkedAt,
            /** How the link can be proven, so the page shows the right options. */
            verification: {
              requestedAt: account.verificationRequestedAt,
              inGameCode: services.paldefender.enabled(),
              codePending: services.siteAccounts.lastCodeSentAt(account.id) !== null,
            },
          }
        : null,
      privacy: { showDiscord: account.showDiscord },
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

  /**
   * Sends a one-time code to the character in the game, through PalDefender. Only
   * someone who can see that character's messages can read it, which proves the
   * link is theirs. Needs the PalDefender integration and the player online.
   */
  app.post('/verify/code', async (request) => {
    const account = currentAccount(request);
    if (!account.playerId) throw badRequest('Link your character first', 'not_linked');
    if (account.playerVerified) throw badRequest('Your character is already verified', 'already_verified');
    if (!services.paldefender.enabled()) throw conflict('In-game codes aren’t available on this server. Ask staff to verify you instead.');
    if (!codeRequests.consume(`code:${account.id}`)) throw tooManyRequests('Too many codes requested, try again later');
    const sentAt = services.siteAccounts.lastCodeSentAt(account.id);
    if (sentAt && Date.now() - sentAt < 60_000) throw tooManyRequests('A code was just sent. Check your in-game chat, or wait a minute for another.');
    await services.players.refreshOnline().catch(() => undefined);
    const player = services.players.get(account.playerId);
    if (!player?.online) throw conflict('Join the server with that character, then ask for a code again. The code is sent in the game.');
    const { code } = services.siteAccounts.createCode(account.id);
    try {
      await services.paldefender.client().sendPlayerMessage('PlayerChat', `PalOps link code: ${code} (valid for 10 minutes). Enter it on the website. If you didn’t ask for this, ignore it.`, [player.userId]);
    } catch (err) {
      services.siteAccounts.discardCode(account.id);
      if (err instanceof PalDefenderError) throw conflict('The code couldn’t be delivered in the game. Try again, or ask staff to verify you.');
      throw err;
    }
    return { sent: true, expiresInMinutes: 10 };
  });

  app.post('/verify/confirm', async (request) => {
    const account = currentAccount(request);
    if (!codeGuesses.consume(`guess:${account.id}`)) throw tooManyRequests('Too many attempts, try again later');
    const { code } = parse(z.object({ code: z.string().trim().min(4).max(16) }), request.body);
    const result = services.siteAccounts.checkCode(account.id, code);
    if (result === 'none') throw badRequest('No code has been sent. Ask for one first.', 'no_code');
    if (result === 'expired') throw badRequest('That code has expired. Ask for a new one.', 'code_expired');
    if (result === 'locked') throw tooManyRequests('Too many wrong codes. Ask for a new one.');
    if (result === 'wrong') throw badRequest('That code isn’t right.', 'wrong_code');
    const verified = services.siteAccounts.verify(account.id, 'code');
    const player = services.players.get(verified.playerId!);
    services.audit.record(
      { userId: null, username: `discord:${account.discord.username ?? account.discord.id}`, ip: request.ip },
      { category: 'players', action: 'character_verified', target: player?.name, details: { method: 'in-game code', discordId: account.discord.id, platformId: player?.userId } },
    );
    return view(verified);
  });

  /** For servers without in-game codes, or players who can't get online: staff confirm it themselves. */
  app.post('/verify/request', async (request) => {
    const account = currentAccount(request);
    const updated = services.siteAccounts.requestVerification(account.id);
    return view(updated);
  });

  app.post('/privacy', async (request) => {
    const account = currentAccount(request);
    const { showDiscord } = parse(z.object({ showDiscord: z.boolean() }), request.body);
    services.siteAccounts.setShowDiscord(account.id, showDiscord);
    return view(services.siteAccounts.get(account.id)!);
  });

  app.post('/unlink', async (request) => {
    const account = currentAccount(request);
    services.siteAccounts.unlinkPlayer(account.id);
    return view(services.siteAccounts.get(account.id)!);
  });
}
