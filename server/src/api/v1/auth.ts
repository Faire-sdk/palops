import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, authenticate, clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { getDummyHash, passwordProblem, verifyPassword } from '../../services/authentication/passwords.js';
import { permissionsFor } from '../../services/authentication/permissions.js';
import type { User } from '../../services/authentication/users.js';
import { safeEqual } from '../../utils/crypto.js';
import { badRequest, forbidden, tooManyRequests, unauthorized } from '../../utils/errors.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { parse } from '../../utils/validation.js';

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export default async function authRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const WINDOW = 15 * 60 * 1000;
  const perIp = new RateLimiter(30, WINDOW);
  const failuresPerUser = new RateLimiter(5, WINDOW);

  const session = (user: User) => ({ user, permissions: permissionsFor(user.role) });

  const startSession = (request: Parameters<typeof actorOf>[0], reply: Parameters<typeof setSessionCookie>[0], user: User) => {
    const { token } = services.sessions.create(user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, services, token);
    services.users.touchLogin(user.id);
  };

  app.get('/setup', async () => ({ setupRequired: services.setup.required }));

  app.post('/setup', async (request, reply) => {
    if (!perIp.consume(`setup:${request.ip}`)) throw tooManyRequests();
    const body = parse(credentials.extend({ setupToken: z.string().min(1).max(256) }), request.body);
    const expected = services.setup.pendingToken;
    if (!expected) throw forbidden('Setup has already been completed');
    if (!safeEqual(body.setupToken, expected)) throw forbidden('Invalid setup token');

    const user = await services.users.create(body.username, body.password, 'owner');
    services.setup.complete();
    services.audit.record(
      { userId: user.id, username: user.username, ip: request.ip },
      { category: 'auth', action: 'setup_completed', target: user.username },
    );
    startSession(request, reply, user);
    return session(user);
  });

  app.post('/login', async (request, reply) => {
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
    startSession(request, reply, user);
    services.audit.record({ userId: user.id, username: user.username, ip: request.ip }, { category: 'auth', action: 'login' });
    return session(user);
  });

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

  app.post('/password', { preHandler: authenticate(services) }, async (request) => {
    const body = parse(
      z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().max(256) }),
      request.body,
    );
    const me = request.user!;
    if (failuresPerUser.isBlocked(`pw:${me.userId}`)) throw tooManyRequests();
    const hash = services.users.getPasswordHash(me.userId);
    if (!hash || !(await verifyPassword(body.currentPassword, hash))) {
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
}
