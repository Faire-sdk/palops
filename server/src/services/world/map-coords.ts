import type { WorldPoint } from '../palworld/types.js';

/**
 * Converts world units to the coordinates the in-game map shows (x east,
 * y north, roughly -1000..1000 on the main island). The constants are the
 * community-derived transform used by other Palworld server tools.
 */
const SCALE = 462.962962963;
const OFFSET_X = 123467.1611767;
const OFFSET_Y = 157664.55791065;

export interface MapPoint {
  x: number;
  y: number;
}

export function toMap(point: Pick<WorldPoint, 'x' | 'y'>): MapPoint {
  return { x: round1((point.y - OFFSET_Y) / SCALE), y: round1((point.x + OFFSET_X) / SCALE) };
}

export function fromMap(point: MapPoint, z = 0): WorldPoint {
  return { x: point.y * SCALE - OFFSET_X, y: point.x * SCALE + OFFSET_Y, z };
}

/** Straight-line distance in world units, ignoring height. */
export function distance(a: Pick<WorldPoint, 'x' | 'y'>, b: Pick<WorldPoint, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
