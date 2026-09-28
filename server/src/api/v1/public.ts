import type { FastifyInstance } from 'fastify';
import type { Services } from '../../services/index.js';
import { forbidden } from '../../utils/errors.js';

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
        players: players.map((p) => ({ name: p.name, level: p.level, guild: p.guild ?? services.players.byUserId(p.userId)?.guild ?? null })),
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
}
