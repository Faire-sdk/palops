import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { ROLES } from '../../services/authentication/permissions.js';
import { DISCORD_ID_PATTERN } from '../../services/authentication/users.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const discordId = z.string().trim().regex(DISCORD_ID_PATTERN, 'Enter a Discord user ID (17-20 digits)');

export default async function userRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { config } = services;
  app.addHook('preHandler', requirePermission(services, 'users.manage'));

  app.get('/', async () => ({ users: services.users.list() }));

  app.post('/', async (request, reply) => {
    const body = parse(
      z.object({
        username: z.string().trim(),
        role: z.enum(ROLES),
        discordId: discordId.optional(),
        password: z.string().max(256).optional(),
      }),
      request.body,
    );
    if (body.password !== undefined && !config.passwordLogin) {
      throw badRequest('Password sign-in is disabled, so add the user by Discord ID instead');
    }
    const user = await services.users.create({
      username: body.username,
      role: body.role,
      password: body.password,
      // Name and avatar are filled in the first time they sign in with Discord.
      discord: body.discordId ? { id: body.discordId, username: null, avatar: null } : undefined,
    });
    services.audit.record(actorOf(request), {
      category: 'users',
      action: 'user_created',
      target: user.username,
      details: { role: user.role, discordId: user.discord?.id ?? null, password: user.hasPassword },
    });
    reply.code(201);
    return { user };
  });

  app.patch('/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(
      z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional(), discordId: discordId.nullable().optional() }),
      request.body,
    );
    const before = services.users.get(id);
    if (!before) throw notFound('User not found');

    if (body.discordId !== undefined && body.discordId !== before.discord?.id) {
      if (body.discordId === null && !(before.hasPassword && config.passwordLogin)) {
        throw badRequest('Removing Discord would leave this user no way to sign in', 'last_sign_in_method');
      }
      services.users.setDiscord(id, body.discordId ? { id: body.discordId, username: null, avatar: null } : null);
      // A different Discord account now controls this user; end existing sessions.
      services.sessions.revokeAllForUser(id);
    }
    const user = services.users.update(id, { role: body.role, disabled: body.disabled });
    if (user.disabled) services.sessions.revokeAllForUser(id);
    services.audit.record(actorOf(request), {
      category: 'users',
      action: 'user_updated',
      target: user.username,
      details: {
        before: { role: before.role, disabled: before.disabled, discordId: before.discord?.id ?? null },
        after: { role: user.role, disabled: user.disabled, discordId: user.discord?.id ?? null },
      },
    });
    return { user };
  });

  app.delete('/:id', async (request) => {
    const { id } = parse(idParam, request.params);
    if (id === request.user!.userId) throw badRequest('You can’t delete your own account', 'self_delete');
    const user = services.users.delete(id);
    services.audit.record(actorOf(request), {
      category: 'users',
      action: 'user_deleted',
      target: user.username,
      details: { role: user.role, discordId: user.discord?.id ?? null },
    });
    return { ok: true };
  });

  app.post('/:id/password-reset', async (request) => {
    if (!config.passwordLogin) throw badRequest('Password sign-in is disabled on this panel');
    const { id } = parse(idParam, request.params);
    const user = services.users.get(id);
    if (!user) throw notFound('User not found');
    const reset = services.passwordResets.issue(id, request.user!.userId);
    services.audit.record(actorOf(request), { category: 'users', action: 'password_reset_issued', target: user.username });
    return reset;
  });
}
