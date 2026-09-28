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
}

export type PalworldSettings = Record<string, string | number | boolean>;

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
}

export type PalworldErrorCode = 'not_configured' | 'unreachable' | 'unauthorized' | 'api_error' | 'invalid_response';

export class PalworldError extends Error {
  constructor(
    public readonly code: PalworldErrorCode,
    message: string,
  ) {
    super(message);
  }
}
