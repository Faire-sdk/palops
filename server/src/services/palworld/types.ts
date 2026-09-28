/**
 * The panel's own view of a Palworld server. Everything outside
 * services/palworld talks in these types, never in a specific server tool's
 * wire format, so other integrations (RCON, a wrapper daemon, ...) can be
 * added as new adapters without touching routes or the UI.
 */
export interface PalworldServerInfo {
  name: string;
  description: string;
  version: string;
  worldGuid: string;
}

export interface PalworldMetrics {
  fps: number;
  frameTimeMs: number;
  currentPlayers: number;
  maxPlayers: number;
  uptimeSeconds: number;
  inGameDays: number | null;
  baseCampCount: number | null;
}

export interface PalworldPlayer {
  name: string;
  accountName: string;
  playerId: string;
  /** Platform id such as steam_7656... — the id used for kick/ban. */
  userId: string;
  ip: string | null;
  ping: number | null;
  level: number | null;
  location: { x: number; y: number } | null;
  buildingCount: number | null;
  /** Guild name, when the connection method reports it (the official REST API does not). */
  guild: string | null;
}

export type PalworldSettings = Record<string, string | number | boolean>;

export type WorldUnitType = 'Player' | 'OtomoPal' | 'BaseCampPal' | 'WildPal' | 'NPC' | 'Other';

/** A position in world units (centimetres), as the game reports it. */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** A player, pal or NPC in the world snapshot. */
export interface WorldCharacter {
  instanceId: string;
  unitType: WorldUnitType;
  /** Player name, or a pal's nickname when it has one. */
  name: string;
  /** Internal species or character class, e.g. SheepBall. */
  className: string | null;
  /** For pals: the instance id of the player who owns it. */
  trainerInstanceId: string | null;
  /** For players: platform id and address. */
  userId: string | null;
  ip: string | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
  guildId: string | null;
  guildName: string | null;
  location: WorldPoint;
}

export interface WorldPalBox {
  guildId: string | null;
  guildName: string | null;
  location: WorldPoint;
}

/** Everything in the world at one moment (the REST API's game-data endpoint). */
export interface WorldSnapshot {
  /** The server's local time, as reported. */
  serverTime: string | null;
  fps: number | null;
  averageFps: number | null;
  characters: WorldCharacter[];
  palBoxes: WorldPalBox[];
}

export interface PalworldAdapter {
  readonly kind: string;
  getInfo(): Promise<PalworldServerInfo>;
  getMetrics(): Promise<PalworldMetrics>;
  getPlayers(): Promise<PalworldPlayer[]>;
  getSettings(): Promise<PalworldSettings>;
  announce(message: string): Promise<void>;
  kick(userId: string, message?: string): Promise<void>;
  ban(userId: string, message?: string): Promise<void>;
  unban(userId: string): Promise<void>;
  save(): Promise<void>;
  /** Graceful shutdown after a countdown, shown to players with the message. */
  shutdown(waitSeconds: number, message: string): Promise<void>;
  /** Immediate stop without saving. */
  forceStop(): Promise<void>;
  /**
   * The world snapshot. Needs the server started with -enable-gamedata-api;
   * throws PalworldError('unsupported') when that's off.
   */
  getWorld?(): Promise<WorldSnapshot>;
}

export type PalworldErrorCode = 'not_configured' | 'unreachable' | 'unauthorized' | 'api_error' | 'invalid_response' | 'unsupported';

export class PalworldError extends Error {
  constructor(
    public readonly code: PalworldErrorCode,
    message: string,
  ) {
    super(message);
  }
}
