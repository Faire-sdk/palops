import type { FastifyInstance } from 'fastify';
import { forbidden } from '../utils/errors.js';

export const CSRF_HEADER = 'x-palops-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Discord calls this itself, so it can't send our CSRF header. It's authenticated by Discord's request signature instead. */
const DISCORD_INTERACTIONS_PATH = '/api/v1/discord/interactions';

/**
 * CSRF defence in depth on top of SameSite=Strict cookies: state-changing API
 * calls must carry a custom header (which a cross-site form cannot send and a
 * cross-site fetch cannot send without a CORS preflight we never approve),
 * and any Origin header present must match the host.
 */
export function registerSecurity(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || SAFE_METHODS.has(request.method)) return;
    if (request.method === 'POST' && request.url.split('?')[0] === DISCORD_INTERACTIONS_PATH) return;
    if (request.headers[CSRF_HEADER] !== '1') throw forbidden('Missing CSRF header');
    const origin = request.headers.origin;
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw forbidden('Invalid origin');
      }
      // request.host honours X-Forwarded-Host only when TRUST_PROXY is enabled.
      const host = request.host;
      if (originHost !== host) throw forbidden('Cross-origin request rejected');
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
}
