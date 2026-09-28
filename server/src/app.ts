import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import v1 from './api/v1/index.js';
import { registerSecurity } from './middleware/security.js';
import type { Services } from './services/index.js';
import { PalDefenderError } from './services/paldefender/paldefender-client.js';
import { PalworldError } from './services/palworld/index.js';
import { HttpError } from './utils/errors.js';

const PALWORLD_STATUS: Record<string, number> = { not_configured: 409, unreachable: 503 };
const PALDEFENDER_STATUS: Record<string, number> = { not_configured: 409, unreachable: 503, not_found: 404, rejected: 422 };

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const { config } = services;
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
  });

  await app.register(cookie);
  registerSecurity(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof PalworldError) {
      return reply
        .code(PALWORLD_STATUS[error.code] ?? 502)
        .send({ error: { code: `palworld_${error.code}`, message: error.message } });
    }
    if (error instanceof PalDefenderError) {
      return reply.code(PALDEFENDER_STATUS[error.code] ?? 502).send({ error: { code: `paldefender_${error.code}`, message: error.message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.get('/api/health', async () => {
    services.db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  await app.register(v1, { services, prefix: '/api/v1' });

  const webDist = resolve(config.webDistPath);
  const serveWeb = existsSync(resolve(webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, { root: webDist });
  }

  app.setNotFoundHandler((request, reply) => {
    const isFile = /\.[a-z0-9]+$/i.test(request.url.split('?')[0]!);
    if (!serveWeb || isFile || request.url.startsWith('/api/') || request.method !== 'GET') {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    // Let the single-page app handle client-side routes.
    return reply.sendFile('index.html');
  });

  return app;
}
