import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { hasPermission } from '../../services/authentication/permissions.js';
import { toMap } from '../../services/world/map-coords.js';
import { parse } from '../../utils/validation.js';

/** Platform ids look like steam_76561198000000000 or epic_0f3a...; keep them to a safe charset. */
const userIdParams = z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id') });
const reasonBody = z.object({ reason: z.string().trim().max(200).default('') });

export default async function playerRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { players, moderation, world } = services;

  /** Players online right now. Addresses only for staff with players.ip. */
  app.get('/', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const showIp = hasPermission(request.user!.role, 'players.ip');
    return {
      // The online list has no guilds; the world snapshot fills them in on the known player.
      players: (await players.refreshOnline()).map((p) => ({
        ...p,
        ip: showIp ? p.ip : null,
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
    /** Address bans the panel enforces. Only for staff who can see addresses. */
    ipBans: hasPermission(request.user!.role, 'players.ip') ? moderation.ipBans() : [],
  }));

  app.post('/ip-bans', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { ip, reason } = parse(z.object({ ip: z.string().trim().min(1, 'Enter an address').max(64), reason: z.string().trim().max(200).default('') }), request.body);
    return { ipBan: await moderation.banIp(actorOf(request), ip, reason) };
  });

  app.delete('/ip-bans/:id', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    moderation.liftIpBan(actorOf(request), id);
    return { ok: true };
  });

  app.get('/:userId', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const staff = hasPermission(request.user!.role, 'world.view');
    const showIp = hasPermission(request.user!.role, 'players.ip');
    const player = players.byUserId(userId) ?? null;
    const addresses = showIp ? players.addressesOf(userId) : [];
    // Live details (ping, position, buildings) only exist while the player is online.
    const live = player?.online ? ((await players.refreshOnline().catch(() => [])).find((p) => p.userId === userId) ?? null) : null;
    return {
      userId,
      player,
      live: live && {
        ping: live.ping,
        buildingCount: live.buildingCount,
        /** Positions are staff-only, like the map. */
        location: staff && live.location ? toMap(live.location) : null,
        ip: showIp ? live.ip : null,
      },
      banned: moderation.isBanned(userId),
      /** Addresses and players sharing them are only for staff with players.ip. */
      addresses: addresses.map((a) => ({ ...a, banned: moderation.ipBansMatching(a.ip).length > 0 })),
      linkedPlayers: showIp ? players.linkedTo(userId) : [],
      history: moderation.history(userId),
      pals: world.palsOf(userId),
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
    const { reason, banAddress } = parse(reasonBody.extend({ banAddress: z.boolean().default(false) }), request.body);
    return moderation.ban(actorOf(request), userId, reason, { banAddress });
  });

  app.post('/:userId/unban', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { reason } = parse(reasonBody, request.body);
    return { record: await moderation.unban(actorOf(request), userId, reason) };
  });

  app.post('/:userId/notes', { preHandler: requirePermission(services, 'players.note') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Write a note first').max(1000) }), request.body);
    return { record: moderation.note(actorOf(request), userId, text) };
  });
}
