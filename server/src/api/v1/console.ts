import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import type { ConsoleLevel, ConsoleLine, ConsoleSourceName } from '../../services/console/console-service.js';
import { isIP } from 'node:net';
import { tooManyRequests } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

const SOURCES = ['panel', 'game', 'paldefender'] as const;
const LEVELS = ['info', 'warn', 'error'] as const;
const MAX_STREAMS = 20;
const KEEPALIVE_MS = 20_000;

/** "game,panel" -> ['game', 'panel'], ignoring anything unknown. */
const sourceList = z
  .string()
  .max(60)
  .optional()
  .transform((v) => (v ? (v.split(',').filter((s): s is ConsoleSourceName => (SOURCES as readonly string[]).includes(s))) : undefined));

const lineQuery = z.object({
  afterId: z.coerce.number().int().min(0).optional(),
  beforeId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
  sources: sourceList,
  level: z.enum(LEVELS).optional(),
  q: z.string().max(100).optional(),
});

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const loggerSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().min(1).max(253).refine((h) => isIP(h) !== 0 || HOSTNAME.test(h), 'Enter a valid hostname or IP address'),
  port: z.coerce.number().int().min(1).max(65535).default(8765),
  tls: z.boolean().default(false),
  token: z.string().trim().max(256).optional(),
});

const settingsSchema = z.object({
  logger: loggerSchema.optional(),
  tailEnabled: z.boolean(),
  gameLogPath: z.string().trim().max(1024).nullable().default(null),
  paldefenderLogPath: z.string().trim().max(1024).nullable().default(null),
});

/**
 * The view-only console. Lines come from tailed log files and events the panel
 * knows about; there is no command channel (RCON is deprecated by Palworld).
 * Viewing needs console.view; choosing which files to read is owner-only.
 */
export default async function consoleRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { console: log } = services;
  const view = { preHandler: requirePermission(services, 'console.view') };
  const configure = { preHandler: requirePermission(services, 'server.connection') };

  app.get('/lines', view, async (request) => {
    const q = parse(lineQuery, request.query);
    return { lines: log.lines({ afterId: q.afterId, beforeId: q.beforeId, limit: q.limit, sources: q.sources, minLevel: q.level as ConsoleLevel | undefined, search: q.q }), sources: log.tailStatus(), logger: log.settings().logger.enabled ? log.loggerStatus() : null };
  });

  /**
   * Server-sent events: everything after `after`, then new lines as they arrive.
   * A plain streaming response, so it works through Caddy and nginx (which must
   * not buffer it) and reconnects by itself with the last id it saw.
   */
  let streams = 0;
  app.get('/stream', view, async (request, reply) => {
    const q = parse(z.object({ after: z.coerce.number().int().min(0).optional(), sources: sourceList, level: z.enum(LEVELS).optional() }), request.query);
    if (streams >= MAX_STREAMS) throw tooManyRequests('Too many console viewers are open');
    const headerId = Number(request.headers['last-event-id']);
    const after = Number.isFinite(headerId) && request.headers['last-event-id'] ? headerId : q.after;
    streams++;
    reply.hijack();
    const raw = reply.raw;
    // Hijacked replies skip the security hook, so the same headers are set here.
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    const wanted = (line: ConsoleLine) =>
      (!q.sources?.length || q.sources.includes(line.source)) && (!q.level || q.level === 'info' || (q.level === 'warn' ? line.level !== 'info' : line.level === 'error'));
    const send = (lines: ConsoleLine[]) => {
      for (const line of lines) if (wanted(line)) raw.write(`id: ${line.id}\nevent: line\ndata: ${JSON.stringify(line)}\n\n`);
    };
    raw.write('retry: 3000\n\n');
    // Catch up on anything missed while disconnected, then go live.
    if (after !== undefined) send(log.lines({ afterId: after, limit: 1000, sources: q.sources, minLevel: q.level as ConsoleLevel | undefined }));
    const stop = log.subscribe(send);
    const keepalive = setInterval(() => raw.write(': keepalive\n\n'), KEEPALIVE_MS);
    request.raw.on('close', () => {
      clearInterval(keepalive);
      stop();
      streams--;
    });
  });

  app.get('/settings', configure, async () => ({ settings: log.settings(), sources: log.tailStatus(), logger: log.loggerStatus() }));

  app.put('/settings', configure, async (request) => {
    const { logger, ...paths } = parse(settingsSchema, request.body);
    const before = log.settings();
    const tokenValue = logger?.token === '' ? undefined : logger?.token;
    const settings = log.save({ ...paths, logger: logger ? { ...logger, token: tokenValue } : undefined });
    services.audit.record(actorOf(request), {
      category: 'console',
      action: 'settings_updated',
      details: {
        before: { tailEnabled: before.tailEnabled, gameLogPath: before.gameLogPath, paldefenderLogPath: before.paldefenderLogPath, logger: { ...before.logger } },
        after: { tailEnabled: settings.tailEnabled, gameLogPath: settings.gameLogPath, paldefenderLogPath: settings.paldefenderLogPath, logger: { ...settings.logger } },
        // Never log the token itself, only whether it changed.
        loggerTokenChanged: tokenValue !== undefined,
      },
    });
    return { settings, sources: log.tailStatus(), logger: log.loggerStatus() };
  });

  /** Checks the paths without saving, so a typo shows up before switching anything on. */
  app.post('/settings/test', configure, async (request) => {
    const { gameLogPath, paldefenderLogPath, logger } = parse(settingsSchema.omit({ tailEnabled: true }), request.body);
    return {
      checks: log.check({ gameLogPath, paldefenderLogPath }),
      logger: logger ? await log.testLogger({ host: logger.host, port: logger.port, tls: logger.tls, token: logger.token || undefined }) : null,
    };
  });
}
