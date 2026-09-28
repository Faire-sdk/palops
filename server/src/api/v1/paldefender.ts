import type { FastifyInstance } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { isValidPalDefenderHost, PALDEFENDER_DEFAULT_PORT } from '../../services/paldefender/paldefender-service.js';
import { badRequest } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

const connection = z.object({
  host: z.string().trim().min(1).max(253).refine(isValidPalDefenderHost, 'Enter a valid hostname or IP address'),
  port: z.coerce.number().int().min(1).max(65535).default(PALDEFENDER_DEFAULT_PORT),
  useTls: z.boolean().default(false),
  token: z.string().trim().max(256).optional(),
});
const settingsSchema = connection.extend({ enabled: z.boolean() });

/**
 * The optional PalDefender integration. Settings are owner-only, like the
 * server connection. Everything else answers "not set up" until it's enabled.
 */
export default async function paldefenderRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { paldefender } = services;

  app.get('/settings', { preHandler: requirePermission(services, 'server.connection') }, async () => ({ settings: paldefender.settings(), status: paldefender.status() }));

  app.put('/settings', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(settingsSchema, request.body);
    const before = paldefender.settings();
    const token = input.token === '' ? undefined : input.token;
    if (input.enabled && !token && !before?.hasToken) throw badRequest('Enter the API token to switch the integration on', 'token_required');
    const settings = paldefender.save({ ...input, token });
    services.audit.record(actorOf(request), {
      category: 'server',
      action: 'paldefender_updated',
      details: {
        before: before ? { enabled: before.enabled, host: before.host, port: before.port, useTls: before.useTls } : null,
        after: { enabled: settings.enabled, host: settings.host, port: settings.port, useTls: settings.useTls },
        // Never log the token itself, only whether it changed.
        tokenChanged: token !== undefined,
      },
    });
    return { settings, status: paldefender.status() };
  });

  /** Tries the reads the panel relies on, so a missing token permission is easy to spot. */
  app.post('/test', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(connection, request.body);
    return paldefender.test({ ...input, token: input.token || undefined });
  });

  /** Whether the integration is on, so the UI knows whether to show PalDefender sections. */
  app.get('/status', { preHandler: requirePermission(services, 'players.view') }, async () => paldefender.status());

  /** PalDefender's own ban list: includes bans made in-game, by the anti-cheat and by other tools. */
  app.get('/banlist', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const { includeInactive } = parse(z.object({ includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }), request.query);
    return { bans: await paldefender.banlist(includeInactive) };
  });

  app.post('/unban', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId, reason } = parse(z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id'), reason: z.string().trim().max(200).default('') }), request.body);
    await paldefender.unbanUser(userId, reason);
    services.audit.record(actorOf(request), { category: 'players', action: 'paldefender_unban', target: userId, details: reason ? { reason } : undefined });
    return { ok: true };
  });

  app.post('/unbanip', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { ip, reason } = parse(z.object({ ip: z.string().trim().refine((v) => isIP(v) !== 0, 'Enter a valid IP address'), reason: z.string().trim().max(200).default('') }), request.body);
    await paldefender.unbanAddress(ip, reason);
    services.audit.record(actorOf(request), { category: 'players', action: 'paldefender_ip_unban', target: ip, details: reason ? { reason } : undefined });
    return { ok: true };
  });
}
