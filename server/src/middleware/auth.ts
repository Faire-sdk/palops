import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Services } from '../services/index.js';
import type { AuditActor } from '../services/audit/audit-log.js';
import { hasPermission, type Permission } from '../services/authentication/permissions.js';
import type { SessionUser } from '../services/authentication/sessions.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export const SESSION_COOKIE = 'palops_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function setSessionCookie(reply: FastifyReply, services: Services, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: services.config.cookieSecure,
    maxAge: Math.floor(services.config.sessionMaxMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, services: Services) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: services.config.cookieSecure });
}

/** Resolves the session cookie into request.user, or rejects with 401. */
export function authenticate(services: Services): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? services.sessions.validate(token) : undefined;
    if (!user) throw unauthorized();
    request.user = user;
  };
}

/** Authenticates and then requires the given permission. Always enforced server-side. */
export function requirePermission(services: Services, permission: Permission): preHandlerAsyncHookHandler {
  const auth = authenticate(services);
  return async function (this: unknown, request, reply) {
    await auth.call(this as never, request, reply);
    if (!hasPermission(request.user!.role, permission)) throw forbidden();
  };
}

export function actorOf(request: FastifyRequest): AuditActor {
  return { userId: request.user?.userId ?? null, username: request.user?.username ?? null, ip: request.ip };
}
