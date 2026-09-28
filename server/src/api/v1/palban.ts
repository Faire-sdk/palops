import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import { hasPermission } from '../../services/authentication/permissions.js';
import type { Services } from '../../services/index.js';
import { PalBanError } from '../../services/palban/palban-client.js';
import { toCsv } from '../../utils/csv.js';
import { HttpError, badRequest } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

const userIdParams = z.object({ userId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/, 'Invalid player id') });
const settingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().trim().min(1).max(300),
  key: z.string().trim().max(256).optional(),
  sendEvents: z.boolean().default(true),
  checkJoins: z.boolean().default(true),
  sendLogs: z.boolean().default(false),
  sendLogAddresses: z.boolean().default(false),
});

/** PalBan errors reach the client as ordinary API errors instead of a 500. */
function translate(err: unknown): never {
  if (err instanceof PalBanError) {
    const status = err.code === 'not_configured' ? 409 : err.code === 'unreachable' || err.code === 'rate_limited' ? 503 : err.code === 'not_found' ? 404 : 502;
    throw new HttpError(status, err.code, err.message);
  }
  throw err;
}

/**
 * The optional PalBan Network integration. Settings are owner-only, like the
 * server connection. Everything else answers "not set up" until it's enabled.
 */
export default async function palbanRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { palban } = services;

  app.get('/settings', { preHandler: requirePermission(services, 'server.connection') }, async () => ({ settings: palban.settings(), status: palban.status() }));

  app.put('/settings', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(settingsSchema, request.body);
    const before = palban.settings();
    const key = input.key === '' ? undefined : input.key;
    if (input.enabled && !key && !before?.hasKey) throw badRequest('Enter the integration key to switch PalBan Network on', 'key_required');
    const settings = palban.save({ ...input, key });
    services.audit.record(actorOf(request), {
      category: 'server',
      action: 'palban_updated',
      details: {
        before: before ? { enabled: before.enabled, baseUrl: before.baseUrl, sendEvents: before.sendEvents, checkJoins: before.checkJoins, sendLogs: before.sendLogs, sendLogAddresses: before.sendLogAddresses } : null,
        after: { enabled: settings.enabled, baseUrl: settings.baseUrl, sendEvents: settings.sendEvents, checkJoins: settings.checkJoins, sendLogs: settings.sendLogs, sendLogAddresses: settings.sendLogAddresses },
        // Never log the key itself, only whether it changed.
        keyChanged: key !== undefined,
      },
    });
    return { settings, status: palban.status() };
  });

  /** Checks the key: which PalBan server it is for and whether it has the permissions PalOps uses. */
  app.post('/test', { preHandler: requirePermission(services, 'server.connection') }, async (request) => {
    const input = parse(z.object({ baseUrl: settingsSchema.shape.baseUrl, key: z.string().trim().max(256).optional() }), request.body);
    try {
      return await palban.test(input);
    } catch (err) {
      return translate(err);
    }
  });

  app.get('/status', { preHandler: requirePermission(services, 'players.view') }, async () => palban.status());

  /** The server's PalBan banlist next to the game's, and what is banned only in the game. */
  app.get('/bans', { preHandler: requirePermission(services, 'players.view') }, async () => ({
    enabled: palban.enabled(),
    status: palban.status(),
    bans: palban.enabled() ? palban.bans() : [],
    onlyHere: palban.enabled() ? palban.onlyHere() : [],
  }));

  app.post('/sync', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    try {
      return { ...(await palban.sync(actorOf(request))), status: palban.status() };
    } catch (err) {
      return translate(err);
    }
  });

  /** Bans a player in the game from an active PalBan ban: the team's decision, one ban at a time. */
  app.post('/bans/:banId/apply', { preHandler: requirePermission(services, 'players.ban') }, async (request) => {
    const { banId } = parse(z.object({ banId: z.string().min(1).max(100) }), request.params);
    await palban.apply(actorOf(request), banId);
    return { ok: true, status: palban.status() };
  });

  /** What the network knows about a player. Other servers' reports are leads to review, not a verdict. */
  app.get('/players/:userId', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const { userId } = parse(userIdParams, request.params);
    const { fresh } = parse(z.object({ fresh: z.coerce.boolean().default(false) }), request.query);
    try {
      return { player: await palban.lookup(userId, { fresh }) };
    } catch (err) {
      return translate(err);
    }
  });

  /**
   * The game's bans as a CSV that PalBan Network's importer reads without mapping,
   * for adding what is banned only here. Addresses only for staff with players.ip.
   */
  app.get('/export.csv', { preHandler: requirePermission(services, 'players.ban') }, async (request, reply) => {
    const showIp = hasPermission(request.user!.role, 'players.ip');
    const bans = services.moderation.activeBans();
    const rows = bans.map((b) => {
      const link = services.siteAccounts.byPlayerUserId(b.playerUserId, false);
      return { b, discordId: link?.playerVerified ? link.discord.id : null, discordName: link?.playerVerified ? link.discord.username : null, ip: showIp ? services.players.lastAddress(b.playerUserId) : null };
    });
    services.audit.record(actorOf(request), { category: 'players', action: 'export', target: 'palban', details: { rows: rows.length, addresses: showIp } });
    const csv = toCsv(rows, [
      { header: 'game_id', value: (r) => r.b.playerUserId },
      { header: 'player_name', value: (r) => r.b.playerName },
      { header: 'discord_username', value: (r) => r.discordName },
      { header: 'discord_id', value: (r) => r.discordId },
      ...(showIp ? [{ header: 'ip', value: (r: (typeof rows)[number]) => r.ip }] : []),
      { header: 'ban_date', value: (r) => r.b.createdAt },
      { header: 'reason', value: (r) => r.b.reason },
      { header: 'status', value: () => 'ACTIVE' },
    ]);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="palops-palban-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(csv);
  });
}
