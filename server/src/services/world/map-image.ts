import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DB } from '../../database/db.js';
import { badRequest, notFound } from '../../utils/errors.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import { toMap } from './map-coords.js';

/** The image's edges in in-game map coordinates (x east, y north). */
export interface MapBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The game's map screen shows these as separate maps, but they share one set of
 * in-game coordinates: the World Tree lies just past the north-west edge of the
 * Palpagos map. Each region gets its own image, lined up on its own, so they
 * land in place next to each other.
 *
 * The world bounds are what the game stretches its own square map textures over
 * (T_WorldMap and T_TreeMap), from its DT_WorldMapUIData table as decoded by the
 * PalMiniMap mod for 1.0. Inferred, not official documentation, but they put
 * community-mapped World Tree and Sunreach locations on the right spots.
 */
const GAME_TEXTURES = [
  { id: 'palpagos', label: 'Palpagos Islands', min: { x: -1099400, y: -724400 }, max: { x: 349400, y: 724400 } },
  { id: 'world-tree', label: 'World Tree', min: { x: 347351.5, y: -818197 }, max: { x: 689148.5, y: -476400 } },
] as const;

/** World x runs north and world y east, so the texture's top-left is (max x, min y). */
export const MAP_REGIONS = GAME_TEXTURES.map(({ id, label, min, max }) => {
  const topLeft = toMap({ x: max.x, y: min.y });
  const bottomRight = toMap({ x: min.x, y: max.y });
  const gameBounds: MapBounds = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
  return { id, label, gameBounds };
});
export type MapRegion = (typeof GAME_TEXTURES)[number]['id'];
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

/** Big enough for the game's own 8192px map textures as PNG. */
export const MAP_IMAGE_MAX_BYTES = 64 * 1024 * 1024;
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

/**
 * The starting guess before alignment: where the game draws that region's map,
 * keeping the image's shape. Exact when the image is the game's own texture.
 */
function defaultBounds(region: MapRegion, width: number, height: number): MapBounds {
  const { gameBounds } = MAP_REGIONS.find((r) => r.id === region)!;
  const center = { x: (gameBounds.left + gameBounds.right) / 2, y: (gameBounds.top + gameBounds.bottom) / 2 };
  const halfSpan = (gameBounds.right - gameBounds.left) / 2;
  const aspect = width / height;
  // The game's textures are square, so a square image is placed exactly.
  if (aspect === 1) return { ...gameBounds };
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
