import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';

export default async function playerRoutes(app: FastifyInstance, { services }: { services: Services }) {
  /** Players currently online. Known/offline players and moderation arrive with player management. */
  app.get('/', { preHandler: requirePermission(services, 'players.view') }, async () => ({
    players: await services.players.refreshOnline(),
  }));
}
