import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf, authenticate, clearSessionCookie, SESSION_COOKIE, setPlayerCookie, setSessionCookie } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { getDummyHash, passwordProblem, verifyPassword } from '../../services/authentication/passwords.js';
import { permissionsFor } from '../../services/authentication/permissions.js';
import type { DiscordAccount, User } from '../../services/authentication/users.js';
import { DiscordOAuthError } from '../../services/discord/oauth.js';
import { OAUTH_STATE_TTL_MS, type OAuthIntent } from '../../services/discord/oauth-states.js';
import { safeEqual } from '../../utils/crypto.js';
import { badRequest, forbidden, HttpError, tooManyRequests, unauthorized } from '../../utils/errors.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { parse } from '../../utils/validation.js';

const OAUTH_COOKIE = 'palops_oauth_state';
/** Where the admin panel and the public site's account page live in the web app. */
const PANEL = '/panel';
const SITE_ACCOUNT = '/account';
const OAUTH_COOKIE_PATH = '/api/v1/auth/discord';

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export default async function authRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { config } = services;
  const WINDOW = 15 * 60 * 1000;
  const perIp = new RateLimiter(30, WINDOW);
  const failuresPerUser = new RateLimiter(5, WINDOW);

  const session = (user: User) => ({ user, permissions: permissionsFor(user.role) });

  const startSession = (request: FastifyRequest, reply: FastifyReply, user: User, method: 'password' | 'discord') => {
    const { token } = services.sessions.create(user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, services, token);
    services.users.touchLogin(user.id);
    services.audit.record(
      { userId: user.id, username: user.username, ip: request.ip },
      { category: 'auth', action: 'login', details: { method } },
    );
  };

  const requirePasswordLogin = () => {
    if (!config.passwordLogin) throw forbidden('Password sign-in is disabled on this panel');
  };

  app.get('/options', async () => ({
    setupRequired: services.setup.required,
    providers: { discord: services.discordOAuth !== null, password: config.passwordLogin },
  }));

  // ---- Username/password (optional) ----

  app.post('/setup', async (request, reply) => {
    requirePasswordLogin();
    if (!perIp.consume(`setup:${request.ip}`)) throw tooManyRequests();
    const body = parse(credentials.extend({ setupToken: z.string().min(1).max(256) }), request.body);
    checkSetupToken(body.setupToken);

    const user = await services.users.create({ username: body.username, password: body.password, role: 'owner' });
    services.setup.complete();
    services.audit.record(
      { userId: user.id, username: user.username, ip: request.ip },
      { category: 'auth', action: 'setup_completed', target: user.username },
    );
    startSession(request, reply, user, 'password');
    return session(user);
  });

  app.post('/login', async (request, reply) => {
    requirePasswordLogin();
    if (!perIp.consume(`login:${request.ip}`)) throw tooManyRequests();
    const { username, password } = parse(credentials, request.body);
    const userKey = username.toLowerCase();
    if (failuresPerUser.isBlocked(userKey)) throw tooManyRequests();

    const found = services.users.findForLogin(username);
    // Always run a hash comparison so response time doesn't reveal whether a username exists.
    const valid = await verifyPassword(password, found?.passwordHash ?? (await getDummyHash()));

    if (!found || !valid || found.disabled) {
      failuresPerUser.consume(userKey);
      services.audit.record(
        { userId: null, username: null, ip: request.ip },
        { category: 'auth', action: 'login_failed', target: username.slice(0, 64) },
      );
      throw unauthorized('Invalid username or password');
    }

    failuresPerUser.reset(userKey);
    const { passwordHash: _hash, ...user } = found;
    startSession(request, reply, user, 'password');
    return session(user);
  });

  app.post('/password', { preHandler: authenticate(services) }, async (request) => {
    requirePasswordLogin();
    const body = parse(
      z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().max(256) }),
      request.body,
    );
    const me = request.user!;
    if (failuresPerUser.isBlocked(`pw:${me.userId}`)) throw tooManyRequests();
    const hash = services.users.getPasswordHash(me.userId);
    if (!hash) throw badRequest('Your account has no password. Ask an owner for a password reset link to set one.', 'no_password');
    if (!(await verifyPassword(body.currentPassword, hash))) {
      failuresPerUser.consume(`pw:${me.userId}`);
      throw badRequest('Current password is incorrect', 'invalid_password');
    }
    await services.users.setPassword(me.userId, body.newPassword);
    // Sign out everywhere else; the current session stays valid.
    services.sessions.revokeAllForUser(me.userId, me.sessionId);
    services.audit.record(actorOf(request), { category: 'auth', action: 'password_changed' });
    return { ok: true };
  });

  app.post('/reset', async (request) => {
    requirePasswordLogin();
    if (!perIp.consume(`reset:${request.ip}`)) throw tooManyRequests();
    const body = parse(z.object({ token: z.string().min(1).max(256), newPassword: z.string().max(256) }), request.body);
    const problem = passwordProblem(body.newPassword);
    if (problem) throw badRequest(problem, 'weak_password');
    const userId = services.passwordResets.redeem(body.token);
    if (!userId) throw badRequest('This reset link is invalid or has expired', 'invalid_token');
    await services.users.setPassword(userId, body.newPassword);
    services.sessions.revokeAllForUser(userId);
    const user = services.users.get(userId);
    services.audit.record(
      { userId, username: user?.username ?? null, ip: request.ip },
      { category: 'auth', action: 'password_reset_completed' },
    );
    return { ok: true };
  });

  // ---- Session ----

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const user = services.sessions.validate(token);
      services.sessions.revokeToken(token);
      if (user) {
        services.audit.record({ userId: user.userId, username: user.username, ip: request.ip }, { category: 'auth', action: 'logout' });
      }
    }
    clearSessionCookie(reply, services);
    return { ok: true };
  });

  app.get('/me', { preHandler: authenticate(services) }, async (request) => {
    const user = services.users.get(request.user!.userId);
    if (!user) throw unauthorized();
    return session(user);
  });

  // ---- Discord OAuth2 (primary) ----

  function checkSetupToken(token: string) {
    const expected = services.setup.pendingToken;
    if (!expected) throw forbidden('Setup has already been completed');
    if (!safeEqual(token, expected)) throw forbidden('Invalid setup token');
  }

  /** Starts a Discord flow and returns the URL to send the browser to. */
  app.post('/discord/authorize', async (request, reply) => {
    const discord = services.discordOAuth;
    if (!discord) throw forbidden('Discord sign-in is not configured on this panel');
    if (!perIp.consume(`discord:${request.ip}`)) throw tooManyRequests();
    const body = parse(
      z.object({ intent: z.enum(['login', 'setup', 'link', 'player']), setupToken: z.string().min(1).max(256).optional() }),
      request.body,
    );

    let intent: OAuthIntent;
    if (body.intent === 'setup') {
      checkSetupToken(body.setupToken ?? '');
      intent = { kind: 'setup', setupToken: body.setupToken! };
    } else if (body.intent === 'link') {
      await authenticate(services).call(app, request, reply);
      intent = { kind: 'link', userId: request.user!.userId };
    } else if (body.intent === 'player') {
      intent = { kind: 'player' };
    } else {
      intent = { kind: 'login' };
    }

    const state = services.oauthStates.create(intent);
    // Binds the flow to this browser. Lax, because Discord's redirect back is a cross-site navigation.
    reply.setCookie(OAUTH_COOKIE, state, {
      path: OAUTH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: OAUTH_STATE_TTL_MS / 1000,
    });
    return { url: discord.authorizeUrl(state) };
  });

  app.get('/discord/callback', async (request, reply) => {
    const query = parse(
      z.object({ code: z.string().max(512).optional(), state: z.string().max(256).optional(), error: z.string().max(128).optional() }),
      request.query,
    );
    const cookieState = request.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });

    const fail = (code: string, where = PANEL, extra: Record<string, string> = {}) =>
      reply.redirect(`${where}${where.includes('?') ? '&' : '?'}${new URLSearchParams({ auth_error: code, ...extra })}`);

    const intent =
      query.state && cookieState && safeEqual(query.state, cookieState) ? services.oauthStates.consume(query.state) : undefined;
    if (!intent || !services.discordOAuth) return fail('invalid_state', query.state?.startsWith('p.') ? SITE_ACCOUNT : PANEL);
    const back = intent.kind === 'link' ? `${PANEL}/settings?tab=account` : intent.kind === 'player' ? SITE_ACCOUNT : PANEL;
    if (query.error || !query.code) return fail(query.error === 'access_denied' ? 'cancelled' : 'discord_error', back);

    let account: DiscordAccount;
    try {
      account = await services.discordOAuth.exchange(query.code);
    } catch (err) {
      request.log.warn({ err: err instanceof DiscordOAuthError ? err.message : err }, 'Discord OAuth exchange failed');
      return fail('discord_error', back);
    }

    try {
      switch (intent.kind) {
        case 'login': {
          const user = services.users.findByDiscordId(account.id);
          if (!user || user.disabled) {
            services.audit.record(
              { userId: null, username: null, ip: request.ip },
              { category: 'auth', action: 'login_failed', target: account.username ?? account.id, details: { method: 'discord', discordId: account.id } },
            );
            // The Discord id is shown so the person can send it to an owner to be added.
            return fail('not_authorized', PANEL, user ? {} : { discord_id: account.id });
          }
          const refreshed = services.users.setDiscord(user.id, account);
          startSession(request, reply, refreshed, 'discord');
          return reply.redirect(PANEL);
        }
        case 'setup': {
          const pending = services.setup.pendingToken;
          if (!pending || !safeEqual(intent.setupToken, pending)) return fail('setup_done');
          const user = await services.users.create({
            username: services.users.availableUsername(account.username ?? 'owner'),
            role: 'owner',
            discord: account,
          });
          services.setup.complete();
          services.audit.record(
            { userId: user.id, username: user.username, ip: request.ip },
            { category: 'auth', action: 'setup_completed', target: user.username, details: { method: 'discord' } },
          );
          startSession(request, reply, user, 'discord');
          return reply.redirect(PANEL);
        }
        case 'link': {
          const user = services.users.get(intent.userId);
          if (!user || user.disabled) return fail('invalid_state', back);
          services.users.setDiscord(user.id, account);
          services.audit.record(
            { userId: user.id, username: user.username, ip: request.ip },
            { category: 'auth', action: 'discord_linked', details: { discordId: account.id, discordUsername: account.username } },
          );
          return reply.redirect(`${back}&discord=linked`);
        }
        case 'player': {
          const player = services.siteAccounts.signIn(account);
          setPlayerCookie(reply, services, services.siteAccounts.createSession(player.id));
          return reply.redirect(SITE_ACCOUNT);
        }
      }
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 409) return fail('discord_in_use', back);
      throw err;
    }
  });

  app.post('/discord/unlink', { preHandler: authenticate(services) }, async (request) => {
    const user = services.users.get(request.user!.userId);
    if (!user?.discord) throw badRequest('No Discord account is linked');
    if (!user.hasPassword || !config.passwordLogin) {
      throw badRequest('Unlinking Discord would leave you no way to sign in', 'last_sign_in_method');
    }
    services.users.setDiscord(user.id, null);
    services.audit.record(actorOf(request), { category: 'auth', action: 'discord_unlinked', details: { discordId: user.discord.id } });
    return { user: services.users.get(user.id) };
  });
}
