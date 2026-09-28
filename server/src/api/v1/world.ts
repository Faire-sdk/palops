import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { parse } from '../../utils/validation.js';

/**
 * World data from the REST API's game-data snapshot. Positions and addresses
 * are staff-only (world.view); guild names and membership follow players.view.
 */
export default async function worldRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { world } = services;

  app.get('/status', { preHandler: requirePermission(services, 'players.view') }, async () => world.status());

  /** Reads a fresh snapshot now instead of waiting for the next poll. */
  app.post('/refresh', { preHandler: requirePermission(services, 'world.view') }, async () => world.refresh());

  app.get('/map', { preHandler: requirePermission(services, 'world.view') }, async () => ({ status: world.status(), map: world.map() }));

  app.get('/guilds', { preHandler: requirePermission(services, 'players.view') }, async () => ({ guilds: world.guilds() }));

  app.get('/guilds/:guildId', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const { guildId } = parse(z.object({ guildId: z.string().min(1).max(100) }), request.params);
    return world.guild(guildId);
  });

  app.get('/bases', { preHandler: requirePermission(services, 'world.view') }, async () => ({ status: world.status(), bases: world.bases() }));

  app.get('/signals', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const query = parse(
      z.object({
        includeDismissed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    return world.signals(query);
  });

  app.post('/signals/:id/dismiss', { preHandler: requirePermission(services, 'players.note') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return { signal: world.dismissSignal(actorOf(request), id) };
  });

  app.get('/performance', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const { hours } = parse(z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }), request.query);
    return world.performance(hours);
  });
}
