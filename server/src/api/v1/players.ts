import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { hasPermission } from '../../services/authentication/permissions.js';
import { parse } from '../../utils/validation.js';

/** Platform ids look like steam_76561198000000000 or epic_0f3a...; keep them to a safe charset. */
const userIdParams = z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id') });
const reasonBody = z.object({ reason: z.string().trim().max(200).default('') });
const banBody = reasonBody.extend({ banIp: z.boolean().default(false) });

export default async function playerRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { players, moderation, world } = services;

  /** Players online right now. */
  app.get('/', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    // Addresses and positions are staff-only (world.view), like the map.
    const staff = hasPermission(request.user!.role, 'world.view');
    return {
      // The online list has no guilds; the world snapshot fills them in on the known player.
      players: (await players.refreshOnline()).map((p) => ({
        ...p,
        ip: staff ? p.ip : null,
        location: staff ? p.location : null,
        guild: p.guild ?? players.byUserId(p.userId)?.guild ?? null,
      })),
    };
  });

  /** Every player the panel has seen, with ban state. */
  app.get('/known', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const query = parse(
      z.object({
        search: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    const banned = new Set(moderation.activeBans().map((b) => b.playerUserId));
    const { players: list, total } = players.list(query);
    return { players: list.map((p) => ({ ...p, banned: banned.has(p.userId) })), total };
  });

  /** Players banned through the panel. The REST API can't list bans made elsewhere. */
  app.get('/bans', { preHandler: requirePermission(services, 'players.view') }, async (request) => ({
    bans: moderation.activeBans(),
    /** Banned addresses are staff-only, like every other address. */
    ipBans: hasPermission(request.user!.role, 'world.view') ? moderation.ipBans() : [],
  }));

  app.post('/ip-bans', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { ip, reason } = parse(z.object({ ip: z.string().trim().min(2).max(64) }).extend({ reason: reasonBody.shape.reason }), request.body);
    return moderation.banIp(actorOf(request), ip, reason);
  });

  app.delete('/ip-bans/:id', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return { ok: true, paldefender: await moderation.unbanIp(actorOf(request), id) };
  });

  app.get('/:userId', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const staff = hasPermission(request.user!.role, 'world.view');
    const live = players.liveOf(userId);
    return {
      userId,
      player: players.byUserId(userId) ?? null,
      banned: moderation.isBanned(userId),
      history: moderation.history(userId),
      pals: world.palsOf(userId),
      /** Addresses and live details are staff-only, like the map. */
      ips: staff
        ? players.ipsOf(userId).map((i) => ({ ...i, banned: moderation.isIpBanned(i.ip), sharedWith: players.playersOnIp(i.ip, userId) }))
        : [],
      live: staff && live ? { ip: live.ip, ping: live.ping, buildingCount: live.buildingCount, position: world.positionOf(userId) } : null,
      /** Cheat signals are staff-only, like the map. */
      signals: staff ? world.signals({ userId, includeDismissed: true, limit: 20, offset: 0 }).signals : [],
    };
  });

  app.post('/:userId/kick', { preHandler: requirePermission(services, 'players.kick') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { reason } = parse(reasonBody, request.body);
    return { record: await moderation.kick(actorOf(request), userId, reason) };
  });

  app.post('/:userId/ban', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { reason, banIp } = parse(banBody, request.body);
    return moderation.ban(actorOf(request), userId, reason, { banIp });
  });

  app.post('/:userId/unban', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { reason } = parse(reasonBody, request.body);
    return moderation.unban(actorOf(request), userId, reason);
  });

  app.post('/:userId/notes', { preHandler: requirePermission(services, 'players.note') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Write a note first').max(1000) }), request.body);
    return { record: moderation.note(actorOf(request), userId, text) };
  });
}
