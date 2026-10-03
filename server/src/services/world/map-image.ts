import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DB } from '../../database/db.js';
import { badRequest, notFound } from '../../utils/errors.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';

/** The image's edges in in-game map coordinates (x east, y north). */
export interface MapBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The game's map screen shows these as separate maps, but they share one set of
 * in-game coordinates: the World Tree lies far to the north-west of Palpagos.
 * Each region gets its own image, lined up on its own, so they land in place
 * next to each other. The World Tree guess comes from community-mapped
 * locations there (roughly x -1980..-1440, y 1140..1625), not official data.
 */
export const MAP_REGIONS = [
  { id: 'palpagos', label: 'Palpagos Islands', center: { x: 0, y: 0 }, halfSpan: 1000 },
  { id: 'world-tree', label: 'World Tree', center: { x: -1710, y: 1385 }, halfSpan: 450 },
] as const;
export type MapRegion = (typeof MAP_REGIONS)[number]['id'];
export const MAP_REGION_IDS = MAP_REGIONS.map((r) => r.id) as [MapRegion, ...MapRegion[]];

export interface MapImage {
  region: MapRegion;
  contentType: string;
  width: number;
  height: number;
  bounds: MapBounds;
  /** False until an owner lines it up; until then the bounds are a guess. */
  aligned: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

interface MapImageRow {
  region: MapRegion;
  file_name: string;
  content_type: string;
  width: number;
  height: number;
  left_x: number;
  top_y: number;
  right_x: number;
  bottom_y: number;
  aligned: number;
  updated_at: string;
  updated_by: string | null;
}

export const MAP_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 16384;

const TYPES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
export const MAP_IMAGE_TYPES = Object.keys(TYPES);

/**
 * Stores the live map's background images, one per region. PalOps doesn't ship
 * the game's map art, so an owner uploads their own and lines each up with two
 * known points.
 */
export class MapImageService {
  private dir: string | undefined;

  constructor(
    private readonly db: DB,
    private readonly databasePath: string,
    private readonly audit: AuditLog,
  ) {}

  list(): MapImage[] {
    const rows = this.db.prepare('SELECT * FROM map_images').all() as MapImageRow[];
    return MAP_REGION_IDS.flatMap((id) => rows.filter((r) => r.region === id).map(toImage));
  }

  get(region: MapRegion): MapImage | null {
    const row = this.row(region);
    return row ? toImage(row) : null;
  }

  file(region: MapRegion): { contentType: string; data: Buffer; updatedAt: string } {
    const row = this.row(region);
    if (!row) throw notFound('No map image has been uploaded');
    try {
      return { contentType: row.content_type, data: readFileSync(join(this.directory(), row.file_name)), updatedAt: row.updated_at };
    } catch {
      throw notFound('The map image file is missing; upload it again');
    }
  }

  save(actor: AuditActor, region: MapRegion, input: { contentType: string; data: Buffer; width: number; height: number }): MapImage {
    const type = TYPES[input.contentType];
    if (!type || !type.matches(input.data)) throw badRequest('Upload a PNG, JPEG or WebP image', 'invalid_image');
    if (![input.width, input.height].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_SIDE)) {
      throw badRequest(`Image sides must be between 1 and ${MAX_SIDE} pixels`, 'invalid_image');
    }
    const previous = this.row(region);
    // Palpagos keeps the name it had when it was the only image.
    const fileName = region === 'palpagos' ? `map-image.${type.ext}` : `map-image-${region}.${type.ext}`;
    writeFileSync(join(this.directory(), fileName), input.data);
    if (previous && previous.file_name !== fileName) rmSync(join(this.directory(), previous.file_name), { force: true });

    // A replacement with the same shape keeps its alignment; otherwise start from a centred guess.
    const keep = previous?.aligned && previous.width * input.height === previous.height * input.width;
    const bounds = keep ? toImage(previous).bounds : defaultBounds(region, input.width, input.height);
    this.db
      .prepare(
        `INSERT INTO map_images (region, file_name, content_type, width, height, left_x, top_y, right_x, bottom_y, aligned, updated_at, updated_by)
         VALUES (@region, @fileName, @contentType, @width, @height, @left, @top, @right, @bottom, @aligned, @now, @by)
         ON CONFLICT (region) DO UPDATE SET file_name = excluded.file_name, content_type = excluded.content_type, width = excluded.width,
           height = excluded.height, left_x = excluded.left_x, top_y = excluded.top_y, right_x = excluded.right_x,
           bottom_y = excluded.bottom_y, aligned = excluded.aligned, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run({
        region,
        fileName,
        contentType: input.contentType,
        width: input.width,
        height: input.height,
        ...bounds,
        aligned: keep ? 1 : 0,
        now: new Date().toISOString(),
        by: actor.username,
      });
    this.audit.record(actor, { category: 'config', action: 'map_image_uploaded', details: { region, width: input.width, height: input.height, bytes: input.data.length } });
    return this.get(region)!;
  }

  align(actor: AuditActor, region: MapRegion, bounds: MapBounds): MapImage {
    if (!this.row(region)) throw notFound('Upload a map image first');
    if (!(bounds.right > bounds.left && bounds.top > bounds.bottom)) {
      throw badRequest('Those points put the map upside down or mirrored; check the coordinates', 'invalid_alignment');
    }
    this.db
      .prepare('UPDATE map_images SET left_x = ?, top_y = ?, right_x = ?, bottom_y = ?, aligned = 1, updated_at = ?, updated_by = ? WHERE region = ?')
      .run(bounds.left, bounds.top, bounds.right, bounds.bottom, new Date().toISOString(), actor.username, region);
    this.audit.record(actor, { category: 'config', action: 'map_image_aligned', details: { region, ...bounds } });
    return this.get(region)!;
  }

  remove(actor: AuditActor, region: MapRegion): void {
    const row = this.row(region);
    if (!row) return;
    rmSync(join(this.directory(), row.file_name), { force: true });
    this.db.prepare('DELETE FROM map_images WHERE region = ?').run(region);
    this.audit.record(actor, { category: 'config', action: 'map_image_removed', details: { region } });
  }

  private row(region: MapRegion): MapImageRow | undefined {
    return this.db.prepare('SELECT * FROM map_images WHERE region = ?').get(region) as MapImageRow | undefined;
  }

  /** Next to the database, so backups of the data folder include it. */
  private directory(): string {
    if (!this.dir) {
      if (this.databasePath === ':memory:') {
        this.dir = mkdtempSync(join(tmpdir(), 'palops-'));
      } else {
        this.dir = dirname(resolve(this.databasePath));
        mkdirSync(this.dir, { recursive: true });
      }
    }
    return this.dir;
  }
}

/** The starting guess before alignment: the region's usual area, keeping the image's shape. */
function defaultBounds(region: MapRegion, width: number, height: number): MapBounds {
  const { center, halfSpan } = MAP_REGIONS.find((r) => r.id === region)!;
  const aspect = width / height;
  const halfX = aspect >= 1 ? halfSpan : halfSpan * aspect;
  const halfY = aspect >= 1 ? halfSpan / aspect : halfSpan;
  return { left: center.x - halfX, right: center.x + halfX, top: center.y + halfY, bottom: center.y - halfY };
}

function toImage(row: MapImageRow): MapImage {
  return {
    region: row.region,
    contentType: row.content_type,
    width: row.width,
    height: row.height,
    bounds: { left: row.left_x, top: row.top_y, right: row.right_x, bottom: row.bottom_y },
    aligned: row.aligned === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}
