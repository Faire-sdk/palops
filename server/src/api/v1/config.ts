import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';

export default async function configRoutes(app: FastifyInstance, { services }: { services: Services }) {
  /**
   * The server's live settings, read through the REST API. Read-only: the API
   * can't change them, so editing PalWorldSettings.ini needs host access.
   */
  app.get('/', { preHandler: requirePermission(services, 'config.view') }, async () => ({
    settings: await services.palworld.getSettings(),
  }));
}
