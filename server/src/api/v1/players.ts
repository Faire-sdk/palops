import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { hasPermission } from '../../services/authentication/permissions.js';
import { notFound } from '../../utils/errors.js';
import { toMap } from '../../services/world/map-coords.js';
import { toCsv } from '../../utils/csv.js';
import { parse } from '../../utils/validation.js';

/** Platform ids look like steam_76561198000000000 or epic_0f3a...; keep them to a safe charset. */
const userIdParams = z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id') });
const reasonBody = z.object({ reason: z.string().trim().max(200).default('') });

function sendCsv(reply: FastifyReply, name: string, body: string) {
  const day = new Date().toISOString().slice(0, 10);
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="palops-${name}-${day}.csv"`)
    .header('Cache-Control', 'no-store')
    .send(body);
}

export default async function playerRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { players, moderation, world } = services;

  /** Players online right now. Addresses only for staff with players.ip, positions for staff with world.view. */
  app.get('/', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const showIp = hasPermission(request.user!.role, 'players.ip');
    const staff = hasPermission(request.user!.role, 'world.view');
    const online = await players.refreshOnline();
    const activity = players.activityOf(online.map((p) => p.userId));
    return {
      // The online list has no guilds; the world snapshot fills them in on the known player.
      players: online.map((p) => {
        const link = services.siteAccounts.byPlayerUserId(p.userId, false);
        return {
          ...p,
          ip: showIp ? p.ip : null,
          location: staff ? p.location : null,
          guild: p.guild ?? players.byUserId(p.userId)?.guild ?? null,
          playtimeSeconds: activity.get(p.userId)?.seconds ?? 0,
          sessions: activity.get(p.userId)?.sessions ?? 0,
          link: link ? (link.playerVerified ? 'verified' : 'claimed') : null,
        };
      }),
    };
  });

  /** Every player the panel has seen, with ban state, playtime and whether they've linked a website account. */
  app.get('/known', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const query = parse(
      z.object({
        search: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort: z.enum(['recent', 'name', 'playtime', 'level']).default('recent'),
        filter: z.enum(['all', 'online', 'banned', 'linked', 'verified', 'unverified']).default('all'),
      }),
      request.query,
    );
    const banned = new Set(moderation.activeBans().map((b) => b.playerUserId));
    let only: string[] | undefined;
    if (query.filter === 'banned') only = [...banned];
    if (query.filter === 'online') only = (await players.refreshOnline().catch(() => [])).map((p) => p.userId);
    const { players: list, total } = players.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      only,
      linked: query.filter === 'linked' ? 'any' : query.filter === 'verified' ? 'verified' : query.filter === 'unverified' ? 'unverified' : undefined,
    });
    const activity = players.activityOf(list.map((p) => p.userId));
    return {
      players: list.map((p) => {
        const link = services.siteAccounts.byPlayerUserId(p.userId, false);
        return { ...p, banned: banned.has(p.userId), playtimeSeconds: activity.get(p.userId)?.seconds ?? 0, sessions: activity.get(p.userId)?.sessions ?? 0, link: link ? (link.playerVerified ? 'verified' : 'claimed') : null };
      }),
      total,
    };
  });

  /** Server-wide playtime and activity numbers from the recorded visits. */
  app.get('/metrics', { preHandler: requirePermission(services, 'players.view') }, async () => players.metrics());

  /** Every player the panel has seen, as a spreadsheet. Addresses only for staff with players.ip. */
  app.get('/export.csv', { preHandler: requirePermission(services, 'players.view') }, async (request, reply) => {
    const showIp = hasPermission(request.user!.role, 'players.ip');
    const { players: list } = players.list({ limit: 100000, offset: 0, sort: 'name' });
    const banned = new Set(moderation.activeBans().map((b) => b.playerUserId));
    const activity = players.activityOf(list.map((p) => p.userId));
    const rows = list.map((p) => {
      const link = services.siteAccounts.byPlayerUserId(p.userId, false);
      const a = activity.get(p.userId);
      return { p, a, link, ip: showIp ? players.lastAddress(p.userId) : null };
    });
    services.audit.record(actorOf(request), { category: 'players', action: 'export', target: 'players', details: { rows: rows.length, addresses: showIp } });
    return sendCsv(reply, 'players', toCsv(rows, [
      { header: 'Platform ID', value: (r) => r.p.userId },
      { header: 'Name', value: (r) => r.p.name },
      { header: 'Account name', value: (r) => r.p.accountName },
      { header: 'Level', value: (r) => r.p.level },
      { header: 'Guild', value: (r) => r.p.guild },
      { header: 'Online', value: (r) => r.p.online },
      { header: 'Banned', value: (r) => banned.has(r.p.userId) },
      { header: 'First seen', value: (r) => r.p.firstSeenAt },
      { header: 'Last seen', value: (r) => r.p.lastSeenAt },
      { header: 'Playtime (seconds)', value: (r) => r.a?.seconds ?? 0 },
      { header: 'Sessions', value: (r) => r.a?.sessions ?? 0 },
      { header: 'Average session (seconds)', value: (r) => (r.a?.sessions ? Math.round(r.a.seconds / r.a.sessions) : 0) },
      { header: 'Discord link', value: (r) => (r.link ? (r.link.playerVerified ? 'verified' : 'claimed') : '') },
      ...(showIp ? [{ header: 'Last IP address', value: (r: (typeof rows)[number]) => r.ip }] : []),
    ]));
  });

  /** Players banned through the panel, plus address bans for staff with players.ip, as a spreadsheet. */
  app.get('/bans/export.csv', { preHandler: requirePermission(services, 'players.view') }, async (request, reply) => {
    const showIp = hasPermission(request.user!.role, 'players.ip');
    const rows = [
      ...moderation.activeBans().map((b) => ({ kind: 'player', target: b.playerUserId, name: b.playerName, reason: b.reason, by: b.actorUsername, at: b.createdAt })),
      ...(showIp ? moderation.ipBans().map((b) => ({ kind: 'address', target: b.ip, name: b.playerName, reason: b.reason, by: b.actorUsername, at: b.createdAt })) : []),
    ];
    services.audit.record(actorOf(request), { category: 'players', action: 'export', target: 'bans', details: { rows: rows.length, addresses: showIp } });
    return sendCsv(reply, 'bans', toCsv(rows, [
      { header: 'Type', value: (r) => r.kind },
      { header: 'Platform ID or address', value: (r) => r.target },
      { header: 'Player name', value: (r) => r.name },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'Banned by', value: (r) => r.by },
      { header: 'Banned at', value: (r) => r.at },
    ]));
  });

  /** Players banned through the panel. The REST API can't list bans made elsewhere. */
  app.get('/bans', { preHandler: requirePermission(services, 'players.view') }, async (request) => ({
    bans: moderation.activeBans(),
    /** Address bans the panel enforces. Only for staff who can see addresses. */
    ipBans: hasPermission(request.user!.role, 'players.ip') ? moderation.ipBans() : [],
  }));

  app.post('/ip-bans', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { ip, reason } = parse(z.object({ ip: z.string().trim().min(1, 'Enter an address').max(64), reason: z.string().trim().max(200).default('') }), request.body);
    return await moderation.banIp(actorOf(request), ip, reason);
  });

  app.delete('/ip-bans/:id', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return { ok: true, paldefender: await moderation.unbanIp(actorOf(request), id) };
  });

  /** Character links waiting for staff to confirm. */
  app.get('/link-requests', { preHandler: requirePermission(services, 'players.ban') }, async () => ({
    requests: services.siteAccounts.pendingRequests().map((r) => ({
      accountId: r.account.id,
      discord: r.account.discord,
      player: r.player,
      requestedAt: r.account.verificationRequestedAt,
      linkedAt: r.account.linkedAt,
    })),
  }));

  app.post('/link-requests/:accountId/:decision', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { accountId, decision } = parse(z.object({ accountId: z.coerce.number().int().positive(), decision: z.enum(['approve', 'reject']) }), request.params);
    const account = services.siteAccounts.get(accountId);
    const player = account?.playerId ? players.get(account.playerId) : undefined;
    if (!account || !player) throw notFound('That link request no longer exists');
    const actor = actorOf(request);
    if (decision === 'approve') services.siteAccounts.verify(accountId, actor.username ?? 'staff');
    else services.siteAccounts.unlinkPlayer(accountId);
    services.audit.record(actor, { category: 'players', action: decision === 'approve' ? 'character_verified' : 'character_link_rejected', target: player.name, details: { discordId: account.discord.id, platformId: player.userId, method: 'staff' } });
    return { ok: true };
  });

  app.post('/:userId/link/verify', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const account = services.siteAccounts.byPlayerUserId(userId, false);
    if (!account) throw notFound('Nobody has linked this player');
    const actor = actorOf(request);
    services.siteAccounts.verify(account.id, actor.username ?? 'staff');
    services.audit.record(actor, { category: 'players', action: 'character_verified', target: players.byUserId(userId)?.name ?? userId, details: { discordId: account.discord.id, method: 'staff' } });
    return { ok: true };
  });

  app.delete('/:userId/link', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const account = services.siteAccounts.byPlayerUserId(userId, false);
    if (!account) throw notFound('Nobody has linked this player');
    services.siteAccounts.unlinkPlayer(account.id);
    services.audit.record(actorOf(request), { category: 'players', action: 'character_unlinked', target: players.byUserId(userId)?.name ?? userId, details: { discordId: account.discord.id } });
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
      /** Time on the server, from the visits the panel has recorded. */
      activity: players.playtime(userId),
      /** The website account linked to this character, and whether the link is proven. */
      link: (() => {
        const a = services.siteAccounts.byPlayerUserId(userId, false);
        return a ? { discord: a.discord, verified: a.playerVerified, verifiedBy: a.verifiedBy, verifiedAt: a.verifiedAt, requestedAt: a.verificationRequestedAt, linkedAt: a.linkedAt } : null;
      })(),
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
    return moderation.unban(actorOf(request), userId, reason);
  });

  app.post('/:userId/notes', { preHandler: requirePermission(services, 'players.note') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Write a note first').max(1000) }), request.body);
    return { record: moderation.note(actorOf(request), userId, text) };
  });
}
