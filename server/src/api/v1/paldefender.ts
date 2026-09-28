import type { FastifyInstance } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { MESSAGE_PERMISSIONS, type PalMessageType } from '../../services/paldefender/paldefender-client.js';
import { isValidPalDefenderHost, PALDEFENDER_DEFAULT_PORT } from '../../services/paldefender/paldefender-service.js';
import { badRequest } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

/** Platform ids and player UIDs; PalDefender accepts either. */
const userIdParams = z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id') });
const gameId = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/, 'Use the game’s ID, e.g. ExplosiveBullet');
const templateName = z.string().regex(/^[A-Za-z0-9_. -]{1,100}$/, 'Use a template file name from PalDefender’s Pals/Templates folder');
const level = z.number().int().min(1).max(100);
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const RELICS = ['CapturePower', 'HungerReduction', 'SwimSpeed', 'FoodDecayReduction', 'JumpPower', 'GliderSpeed', 'ClimbSpeed', 'StatusAilmentResist', 'StaminaReduction', 'SphereHoming', 'ExpBonus', 'RainbowPassiveRate', 'MoveSpeed'] as const;
const MESSAGE_TYPES = Object.keys(MESSAGE_PERMISSIONS) as [PalMessageType, ...PalMessageType[]];
const positive = z.number().int().min(1).max(10_000_000);

const summonBase = { x: coordinate, y: coordinate, z: coordinate, level: level.optional(), uncapturable: z.boolean().default(false), disableAi: z.boolean().default(false) };
const summonPalSchema = z
  .object({ palId: gameId.optional(), palTemplate: templateName.optional(), ...summonBase, disableDamageMeter: z.boolean().default(false), disableStatuses: z.array(gameId).max(20).default([]) })
  .refine((b) => !!b.palId !== !!b.palTemplate, { message: 'Give either a Pal ID or a template, not both', path: ['palId'] });
const technology = z.union([
  z.literal('All'),
  gameId,
  z.array(gameId).min(1).max(100).refine((a) => !a.includes('All'), 'Use "All" on its own, not in a list'),
]);

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

  // ---- A player's data. PalDefender only reads players who are online. ----

  const read = <T>(fn: (id: string) => Promise<T>) => async (request: { params: unknown }) => {
    const { userId } = parse(userIdParams, request.params);
    return fn(userId);
  };
  const staff = { preHandler: requirePermission(services, 'world.view') };

  app.get('/players/:userId/pals', staff, read((id) => paldefender.client().pals(id)));
  app.get('/players/:userId/items', staff, read((id) => paldefender.client().items(id)));
  app.get('/players/:userId/techs', staff, read((id) => paldefender.client().techs(id)));
  app.get('/players/:userId/progression', staff, read((id) => paldefender.client().progression(id)));

  app.get('/guilds', staff, async () => ({ guilds: await paldefender.client().guilds() }));
  app.get('/guilds/:guildId', staff, async (request) => {
    const { guildId } = parse(z.object({ guildId: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/) }), request.params);
    return { guild: await paldefender.client().guild(guildId) };
  });

  // ---- Changes to the game world (admins and owners) ----

  const manage = { preHandler: requirePermission(services, 'paldefender.manage') };
  const record = (request: Parameters<typeof actorOf>[0], category: 'players' | 'server', action: string, target: string | undefined, details: Record<string, unknown>) =>
    services.audit.record(actorOf(request), { category, action, target, details });

  app.post('/players/:userId/give/items', manage, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { items } = parse(z.object({ items: z.array(z.object({ itemId: gameId, count: z.number().int().min(1).max(1_000_000) })).min(1).max(50) }), request.body);
    const granted = await paldefender.client().giveItems(userId, items);
    record(request, 'players', 'paldefender_give_items', userId, { items });
    return { granted };
  });

  app.post('/players/:userId/give/pals', manage, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { pals } = parse(z.object({ pals: z.array(z.object({ palId: gameId, level })).min(1).max(20) }), request.body);
    const granted = await paldefender.client().givePals(userId, pals);
    record(request, 'players', 'paldefender_give_pals', userId, { pals });
    return { granted };
  });

  app.post('/players/:userId/give/eggs', manage, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { eggs } = parse(
      z.object({
        eggs: z
          .array(z.object({ eggId: gameId, palId: gameId.optional(), palTemplate: templateName.optional(), level: level.optional() }).refine((e) => !!e.palId !== !!e.palTemplate, 'Give either a Pal ID or a template, not both'))
          .min(1)
          .max(20),
      }),
      request.body,
    );
    const granted = await paldefender.client().givePalEggs(userId, eggs);
    record(request, 'players', 'paldefender_give_eggs', userId, { eggs });
    return { granted };
  });

  app.post('/players/:userId/give/templates', manage, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { templates } = parse(z.object({ templates: z.array(templateName).min(1).max(20) }), request.body);
    const granted = await paldefender.client().givePalTemplates(userId, templates);
    record(request, 'players', 'paldefender_give_templates', userId, { templates });
    return { granted };
  });

  app.post('/players/:userId/give/progression', manage, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const grant = parse(
      z
        .object({ exp: positive.optional(), technologyPoints: positive.optional(), ancientTechnologyPoints: positive.optional(), relics: z.partialRecord(z.enum(RELICS), z.number().int().min(1).max(1000)).optional() })
        .refine((g) => !!g.exp || !!g.technologyPoints || !!g.ancientTechnologyPoints || Object.keys(g.relics ?? {}).length > 0, 'Enter at least one amount to give'),
      request.body,
    );
    const result = await paldefender.client().giveProgression(userId, grant);
    record(request, 'players', 'paldefender_give_progression', userId, { ...grant });
    return result;
  });

  app.post('/players/:userId/tech/:action', manage, async (request) => {
    const { userId, action } = parse(userIdParams.extend({ action: z.enum(['learn', 'forget']) }), request.params);
    const { technology: tech } = parse(z.object({ technology: technology }), request.body);
    const result = action === 'learn' ? await paldefender.client().learnTech(userId, tech) : await paldefender.client().forgetTech(userId, tech);
    record(request, 'players', `paldefender_${action}_tech`, userId, { technology: tech });
    return result;
  });

  app.post('/summon/pal', manage, async (request) => {
    const body = parse(summonPalSchema, request.body);
    const summoned = await paldefender.client().summonPal({ palId: body.palId, palTemplate: body.palTemplate }, body);
    record(request, 'server', 'paldefender_summon_pal', body.palTemplate ?? body.palId, { at: { x: body.x, y: body.y, z: body.z }, level: body.level });
    return { summoned };
  });

  app.post('/summon/npc', manage, async (request) => {
    const { npcId, ...body } = parse(z.object({ npcId: gameId, ...summonBase }), request.body);
    const summoned = await paldefender.client().summonNpc(npcId, body);
    record(request, 'server', 'paldefender_summon_npc', npcId, { at: { x: body.x, y: body.y, z: body.z }, level: body.level });
    return { summoned };
  });

  /** Irreversible except from PalDefender's own archive, so the caller has to say it's confirmed. */
  app.post('/bases/:baseId/delete', manage, async (request) => {
    const { baseId } = parse(z.object({ baseId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid base id') }), request.params);
    parse(z.object({ confirm: z.literal(true, { error: 'Confirm the deletion' }) }), request.body);
    const result = await paldefender.client().deleteBase(baseId);
    record(request, 'server', 'paldefender_base_deleted', baseId, { summary: result.summary, deleted: result.deleted, archive: result.archive });
    return result;
  });

  app.post('/reload-config', manage, async (request) => {
    await paldefender.client().reloadConfig();
    record(request, 'server', 'paldefender_config_reloaded', undefined, {});
    return { ok: true };
  });

  // ---- Messages ----

  const text = z.string().trim().min(1).max(300);

  /** An on-screen alert for everyone. */
  app.post('/alert', { preHandler: requirePermission(services, 'server.broadcast') }, async (request) => {
    const { message } = parse(z.object({ message: text }), request.body);
    await paldefender.client().alert(message);
    record(request, 'server', 'paldefender_alert', undefined, { message });
    return { ok: true };
  });

  /** A chat message from the server to everyone. */
  app.post('/broadcast', { preHandler: requirePermission(services, 'server.broadcast') }, async (request) => {
    const { message } = parse(z.object({ message: text }), request.body);
    await paldefender.client().broadcast(message);
    record(request, 'server', 'paldefender_broadcast', undefined, { message });
    return { ok: true };
  });

  /** A message to specific players: chat, or a log line at one of three levels. */
  app.post('/message', { preHandler: requirePermission(services, 'players.kick') }, async (request) => {
    const { sendType, message, userIds } = parse(
      z.object({ sendType: z.enum(MESSAGE_TYPES), message: text, userIds: z.array(userIdParams.shape.userId).min(1).max(32) }),
      request.body,
    );
    const sent = await paldefender.client().sendPlayerMessage(sendType, message, userIds);
    record(request, 'players', 'paldefender_message', userIds.join(', '), { sendType, message });
    return { sent };
  });
}
