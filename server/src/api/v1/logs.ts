import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { AUDIT_CATEGORIES } from '../../services/audit/audit-log.js';
import { parse } from '../../utils/validation.js';

export default async function logRoutes(app: FastifyInstance, { services }: { services: Services }) {
  app.get('/audit', { preHandler: requirePermission(services, 'audit.view') }, async (request) => {
    const query = parse(
      z.object({
        category: z.enum(AUDIT_CATEGORIES).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    return services.audit.list(query);
  });
}
