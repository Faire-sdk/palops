import type { FastifyInstance } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { ADAPTER_KINDS } from '../../services/servers/server-registry.js';
import { parse } from '../../utils/validation.js';

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const connectionSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    adapter: z.enum(ADAPTER_KINDS),
    host: z.string().trim().max(253),
    port: z.coerce.number().int().min(1).max(65535),
    username: z.string().trim().min(1).max(64).default('admin'),
    password: z.string().max(256).optional(),
  })
  .refine((c) => c.adapter === 'mock' || isIP(c.host) !== 0 || HOSTNAME.test(c.host), {
    message: 'Enter a valid hostname or IP address',
    path: ['host'],
  });

export default async function serverRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { palworld } = services;

  app.get('/status', { preHandler: requirePermission(services, 'server.view') }, async (request) => {
    const { fresh } = parse(z.object({ fresh: z.enum(['1', 'true']).optional() }), request.query);
    return palworld.getStatus({ fresh: !!fresh });
  });

  app.post('/announce', { preHandler: requirePermission(services, 'server.broadcast') }, async (request) => {
    const { message } = parse(z.object({ message: z.string().trim().min(1).max(200) }), request.body);
    await palworld.announce(message);
    services.audit.record(actorOf(request), { category: 'server', action: 'broadcast', details: { message } });
    return { ok: true };
  });

  app.get('/connection', { preHandler: requirePermission(services, 'server.connection') }, async () => ({
    connection: services.servers.getPrimary() ?? null,
  }));

  app.put('/connection', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(connectionSchema, request.body);
    const before = services.servers.getPrimary();
    const password = input.password === '' ? undefined : input.password;
    const connection = services.servers.savePrimary({ ...input, password });
    palworld.invalidate();
    const { hasPassword: _a, updatedAt: _b, id: _c, ...after } = connection;
    services.audit.record(actorOf(request), {
      category: 'server',
      action: 'connection_updated',
      target: connection.name,
      // Never log the password itself, only whether it changed.
      details: {
        before: before ? { name: before.name, adapter: before.adapter, host: before.host, port: before.port, username: before.username } : null,
        after,
        passwordChanged: password !== undefined,
      },
    });
    return { connection };
  });

  app.post('/connection/test', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(connectionSchema, request.body);
    const saved = services.servers.getPrimary();
    const password = input.password || (saved ? services.servers.getPassword(saved.id) : '');
    return palworld.test({ ...input, password });
  });
}
