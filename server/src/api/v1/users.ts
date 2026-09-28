import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { ROLES } from '../../services/authentication/permissions.js';
import { notFound } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export default async function userRoutes(app: FastifyInstance, { services }: { services: Services }) {
  app.addHook('preHandler', requirePermission(services, 'users.manage'));

  app.get('/', async () => ({ users: services.users.list() }));

  app.post('/', async (request, reply) => {
    const body = parse(
      z.object({ username: z.string().trim(), password: z.string().max(256), role: z.enum(ROLES) }),
      request.body,
    );
    const user = await services.users.create(body.username, body.password, body.role);
    services.audit.record(actorOf(request), {
      category: 'users',
      action: 'user_created',
      target: user.username,
      details: { role: user.role },
    });
    reply.code(201);
    return { user };
  });

  app.patch('/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() }), request.body);
    const before = services.users.get(id);
    if (!before) throw notFound('User not found');
    const user = services.users.update(id, body);
    if (user.disabled) services.sessions.revokeAllForUser(id);
    services.audit.record(actorOf(request), {
      category: 'users',
      action: 'user_updated',
      target: user.username,
      details: {
        before: { role: before.role, disabled: before.disabled },
        after: { role: user.role, disabled: user.disabled },
      },
    });
    return { user };
  });

  app.post('/:id/password-reset', async (request) => {
    const { id } = parse(idParam, request.params);
    const user = services.users.get(id);
    if (!user) throw notFound('User not found');
    const reset = services.passwordResets.issue(id, request.user!.userId);
    services.audit.record(actorOf(request), { category: 'users', action: 'password_reset_issued', target: user.username });
    return reset;
  });
}
