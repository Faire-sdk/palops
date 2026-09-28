import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { COMMANDS, verifyDiscordSignature, type Interaction } from '../../services/discord/interactions.js';
import { parse } from '../../utils/validation.js';

/**
 * Where Discord sends slash commands. It's public but every request must carry
 * Discord's Ed25519 signature, and it has its own plugin so the body stays raw
 * (the signature covers the exact bytes).
 */
export async function discordInteractionRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { discordBot } = services;
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 32 * 1024 }, (_request, body, done) => done(null, body));

  app.post('/interactions', async (request, reply) => {
    const key = discordBot.publicKey();
    const signature = request.headers['x-signature-ed25519'];
    const timestamp = request.headers['x-signature-timestamp'];
    if (!key || typeof signature !== 'string' || typeof timestamp !== 'string' || !Buffer.isBuffer(request.body) || !verifyDiscordSignature(key, signature, timestamp, request.body)) {
      return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Invalid request signature' } });
    }
    let interaction: Interaction;
    try {
      interaction = JSON.parse(request.body.toString('utf8')) as Interaction;
    } catch {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid JSON' } });
    }
    return discordBot.handleInteraction(interaction);
  });
}

const id = z.string().trim().regex(/^\d{15,25}$/, 'Use the long number from Discord').nullable().default(null);

const settingsSchema = z.object({
  enabled: z.boolean(),
  applicationId: id,
  publicKey: z.string().trim().max(64).nullable().default(null),
  botToken: z.string().trim().max(200).optional(),
  guildId: id,
  publicInfo: z.boolean().default(false),
  eventsChannelId: id,
  logChannelId: id,
  logMinLevel: z.enum(['info', 'warn', 'error']).default('error'),
  notifyBans: z.boolean().default(true),
  notifySignals: z.boolean().default(true),
  notifyServer: z.boolean().default(true),
  notifyJoins: z.boolean().default(false),
});

/** Owner-only setup for the optional Discord bot. */
export default async function discordBotRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { discordBot } = services;
  const owner = { preHandler: requirePermission(services, 'server.connection') };

  app.get('/settings', owner, async (request) => ({
    settings: discordBot.settings(),
    // Where to paste into the Developer Portal's "Interactions Endpoint URL".
    interactionsUrl: `${request.protocol}://${request.host}/api/v1/discord/interactions`,
    commands: COMMANDS.map((c) => ({ name: c.name, description: c.description })),
  }));

  app.put('/settings', owner, async (request) => {
    const { botToken, ...rest } = parse(settingsSchema, request.body);
    const before = discordBot.settings();
    const token = botToken === '' ? undefined : botToken;
    const settings = discordBot.save({ ...rest, botToken: token });
    const { hasToken: _t, updatedAt: _u, commandsRegisteredAt: _c, ...summary } = settings;
    const { hasToken: _bt, updatedAt: _bu, commandsRegisteredAt: _bc, ...beforeSummary } = before;
    services.audit.record(actorOf(request), {
      category: 'server',
      action: 'discord_bot_updated',
      // Never log the token itself, only whether it changed.
      details: { before: beforeSummary, after: summary, tokenChanged: token !== undefined },
    });
    return { settings };
  });

  /** Tries the token, server and channels without saving. */
  app.post('/test', owner, async (request) => {
    const { botToken, guildId, eventsChannelId, logChannelId } = parse(settingsSchema.pick({ botToken: true, guildId: true, eventsChannelId: true, logChannelId: true }), request.body);
    return { checks: await discordBot.check({ botToken: botToken || undefined, guildId, eventsChannelId, logChannelId }) };
  });

  app.post('/register-commands', owner, async (request) => {
    const count = await discordBot.registerCommands();
    services.audit.record(actorOf(request), { category: 'server', action: 'discord_commands_registered', details: { count } });
    return { count, settings: discordBot.settings() };
  });

  app.post('/send-test', owner, async () => {
    await discordBot.sendTest();
    return { ok: true };
  });
}
