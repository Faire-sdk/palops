import type { FastifyInstance } from 'fastify';
import type { Services } from '../../services/index.js';
import { z } from 'zod';
import { forbidden, notFound } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

/**
 * Unauthenticated, read-only data for the public server website. Also usable
 * from an existing community site (CORS is open, no cookies involved). Never
 * exposes connection details, IPs or platform ids.
 */
export default async function publicRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { site } = services.config;

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
  });

  app.get('/server', async () => {
    const status = await services.palworld.getStatus();
    // Keep the known-player count current (the online list is briefly cached).
    if (status.state === 'online') await services.players.refreshOnline().catch(() => undefined);
    return {
      state: status.state === 'online' ? 'online' : status.state === 'unconfigured' ? 'unknown' : 'offline',
      name: status.info?.name ?? status.connection?.name ?? 'Palworld server',
      description: status.info?.description ?? '',
      version: status.info?.version ?? null,
      players: status.metrics ? { online: status.metrics.currentPlayers, max: status.metrics.maxPlayers } : null,
      uptimeSeconds: status.metrics?.uptimeSeconds ?? null,
      inGameDays: status.metrics?.inGameDays ?? null,
      joinAddress: site.joinAddress,
      discordInvite: site.discordInvite,
      showOnlinePlayers: site.showOnlinePlayers,
      /** Whether players can sign in with Discord on the website. */
      playerLogin: services.discordOAuth !== null,
      knownPlayers: services.players.count(),
    };
  });

  app.get('/players', async () => {
    if (!site.showOnlinePlayers) throw forbidden('This server does not publish its player list');
    try {
      const players = await services.players.refreshOnline();
      // The online list has no guilds; the world snapshot fills them in on the known player.
      return {
        // The id is the panel's row id, which links to the public profile; it isn't a platform ID.
        players: players.map((p) => ({ id: services.players.byUserId(p.userId)?.id ?? null, name: p.name, level: p.level, guild: p.guild ?? services.players.byUserId(p.userId)?.guild ?? null })),
      };
    } catch {
      services.players.markAllOffline();
      return { players: [] };
    }
  });

  /** Guild names with member and base counts. Follows the same switch as the player list. */
  app.get('/guilds', async () => {
    if (!site.showOnlinePlayers) throw forbidden('This server does not publish its player list');
    return {
      guilds: services.world.guilds().map((g) => ({ name: g.name, members: g.members, online: g.online, bases: g.bases })),
    };
  });

  // ---- Player directory and profiles (follow the same switch as the player list) ----

  /** Public profiles use the panel's own row id, so a platform ID never appears in a URL. */
  const publicPlayer = (p: NonNullable<ReturnType<typeof services.players.get>>, playtime: number) => {
    const link = services.siteAccounts.byPlayerUserId(p.userId, true);
    return { id: p.id, name: p.name, level: p.level, guild: p.guild, online: p.online, lastSeenAt: p.lastSeenAt, playtimeSeconds: playtime, verified: !!link };
  };

  app.get('/players/known', async (request) => {
    if (!site.showOnlinePlayers) throw forbidden('This server does not publish its player list');
    const q = parse(
      z.object({
        search: z.string().max(60).optional(),
        sort: z.enum(['recent', 'name', 'playtime', 'level']).default('recent'),
        limit: z.coerce.number().int().min(1).max(60).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    await services.players.refreshOnline().catch(() => undefined);
    const { players: list, total } = services.players.list({ search: q.search, sort: q.sort, limit: q.limit, offset: q.offset });
    const playtime = services.players.playtimeOf(list.map((p) => p.userId));
    return { players: list.map((p) => publicPlayer(p, playtime.get(p.userId) ?? 0)), total };
  });

  app.get('/players/:id', async (request) => {
    if (!site.showOnlinePlayers) throw forbidden('This server does not publish its player list');
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    await services.players.refreshOnline().catch(() => undefined);
    const p = services.players.get(id);
    if (!p) throw notFound('No player found');
    const activity = services.players.playtime(p.userId);
    const account = services.siteAccounts.byPlayerUserId(p.userId, true);
    const guild = p.guildId ? services.world.guilds().find((g) => g.guildId === p.guildId) : undefined;
    const pals = services.world
      .palsOf(p.userId)
      .filter((x) => x.level !== null)
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
      .slice(0, 6)
      .map((x) => ({ name: x.name, className: x.className, level: x.level, active: x.active }));
    return {
      ...publicPlayer(p, activity.seconds),
      firstSeenAt: p.firstSeenAt,
      sessions: activity.sessions,
      averageSessionSeconds: activity.averageSeconds,
      longestSessionSeconds: activity.longestSeconds,
      guildInfo: guild ? { name: guild.name, members: guild.members, online: guild.online, bases: guild.bases } : null,
      pals,
      // Only when the player is verified and chose to show it.
      discord: account?.showDiscord ? { username: account.discord.username, avatar: account.discord.avatar, id: account.discord.id } : null,
    };
  });
}
