import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePermission } from '../../middleware/auth.js';
import type { Services } from '../../services/index.js';
import { MAP_IMAGE_MAX_BYTES, MAP_IMAGE_TYPES, MAP_REGION_IDS, MAP_REGIONS } from '../../services/world/map-image.js';
import { badRequest } from '../../utils/errors.js';
import { parse } from '../../utils/validation.js';

/**
 * World data from the REST API's game-data snapshot. Positions and addresses
 * are staff-only (world.view); guild names and membership follow players.view.
 */
export default async function worldRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { world, mapImage } = services;

  // Map images are sent as the raw request body (Content-Type image/png, image/jpeg or image/webp).
  app.addContentTypeParser(MAP_IMAGE_TYPES, { parseAs: 'buffer', bodyLimit: MAP_IMAGE_MAX_BYTES }, (_request, body, done) => done(null, body));

  app.get('/status', { preHandler: requirePermission(services, 'players.view') }, async () => world.status());

  /** Reads a fresh snapshot now instead of waiting for the next poll. */
  app.post('/refresh', { preHandler: requirePermission(services, 'world.view') }, async () => world.refresh());

  app.get('/map', { preHandler: requirePermission(services, 'world.view') }, async () => ({ status: world.status(), map: world.map() }));

  app.get('/guilds', { preHandler: requirePermission(services, 'players.view') }, async () => ({ guilds: world.guilds() }));

  app.get('/guilds/:guildId', { preHandler: requirePermission(services, 'players.view') }, async (request) => {
    const { guildId } = parse(z.object({ guildId: z.string().min(1).max(100) }), request.params);
    return world.guild(guildId);
  });

  app.get('/bases', { preHandler: requirePermission(services, 'world.view') }, async () => ({ status: world.status(), bases: world.bases() }));

  app.get('/signals', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const query = parse(
      z.object({
        includeDismissed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );
    return world.signals(query);
  });

  app.post('/signals/:id/dismiss', { preHandler: requirePermission(services, 'players.note') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return { signal: world.dismissSignal(actorOf(request), id) };
  });

  app.get('/performance', { preHandler: requirePermission(services, 'world.view') }, async (request) => {
    const { hours } = parse(z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }), request.query);
    return world.performance(hours);
  });

  /** The live map's backgrounds, one per region: metadata, then each file. */
  const regionParams = z.object({ region: z.enum(MAP_REGION_IDS) });

  app.get('/map-images', { preHandler: requirePermission(services, 'world.view') }, async () => ({
    regions: MAP_REGIONS.map(({ id, label }) => ({ id, label })),
    images: mapImage.list(),
  }));

  app.get('/map-images/:region/file', { preHandler: requirePermission(services, 'world.view') }, async (request, reply) => {
    const { region } = parse(regionParams, request.params);
    const file = mapImage.file(region);
    return reply
      .header('Content-Type', file.contentType)
      .header('Cache-Control', 'private, max-age=86400')
      .header('Last-Modified', new Date(file.updatedAt).toUTCString())
      .send(file.data);
  });

  app.put('/map-images/:region', { preHandler: requirePermission(services, 'config.edit'), bodyLimit: MAP_IMAGE_MAX_BYTES }, async (request) => {
    const { region } = parse(regionParams, request.params);
    const { width, height } = parse(
      z.object({ width: z.coerce.number().int().positive(), height: z.coerce.number().int().positive() }),
      request.query,
    );
    const contentType = (request.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!Buffer.isBuffer(request.body)) throw badRequest('Upload a PNG, JPEG or WebP image', 'invalid_image');
    return { image: mapImage.save(actorOf(request), region, { contentType, data: request.body, width, height }) };
  });

  app.patch('/map-images/:region', { preHandler: requirePermission(services, 'config.edit') }, async (request) => {
    const { region } = parse(regionParams, request.params);
    const finite = z.number().finite().min(-100000).max(100000);
    const bounds = parse(z.object({ left: finite, top: finite, right: finite, bottom: finite }), request.body);
    return { image: mapImage.align(actorOf(request), region, bounds) };
  });

  app.delete('/map-images/:region', { preHandler: requirePermission(services, 'config.edit') }, async (request) => {
    const { region } = parse(regionParams, request.params);
    mapImage.remove(actorOf(request), region);
    return { image: null };
  });
}
