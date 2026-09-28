// Mirrors the server's API responses. Keep in sync with server/src.
export type Role = 'owner' | 'admin' | 'moderator' | 'viewer';
export const ROLES: Role[] = ['owner', 'admin', 'moderator', 'viewer'];

export type Permission =
  | 'server.view'
  | 'server.control'
  | 'server.broadcast'
  | 'server.connection'
  | 'players.view'
  | 'players.kick'
  | 'players.ban'
  | 'players.note'
  | 'world.view'
  | 'console.view'
  | 'console.execute'
  | 'config.view'
  | 'config.edit'
  | 'logs.view'
  | 'audit.view'
  | 'backups.manage'
  | 'users.manage';

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  discord: { id: string; username: string | null; avatar: string | null } | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionInfo {
  user: User;
  permissions: Permission[];
}

export type ServerState = 'online' | 'offline' | 'error' | 'unconfigured';

export interface ServerStatus {
  state: ServerState;
  checkedAt: string;
  connection: { name: string; adapter: string; host: string; port: number } | null;
  info: { name: string; description: string; version: string; worldGuid: string } | null;
  metrics: {
    fps: number;
    frameTimeMs: number;
    currentPlayers: number;
    maxPlayers: number;
    uptimeSeconds: number;
    inGameDays: number | null;
    baseCampCount: number | null;
  } | null;
  error: { code: string; message: string } | null;
}

export interface Player {
  name: string;
  accountName: string;
  playerId: string;
  userId: string;
  ip: string | null;
  ping: number | null;
  level: number | null;
  location: { x: number; y: number } | null;
  buildingCount: number | null;
  guild: string | null;
}

export interface KnownPlayer {
  id: number;
  userId: string;
  playerId: string | null;
  name: string;
  level: number | null;
  guild: string | null;
  guildId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  online: boolean;
  banned?: boolean;
}

export type ModerationAction = 'kick' | 'ban' | 'unban' | 'note';

export interface ModerationRecord {
  id: number;
  playerUserId: string;
  playerName: string | null;
  action: ModerationAction;
  reason: string | null;
  actorUsername: string | null;
  createdAt: string;
}

export interface PlayerProfile {
  userId: string;
  player: KnownPlayer | null;
  banned: boolean;
  history: ModerationRecord[];
  pals: PlayerPal[];
  /** Empty unless the viewer has world.view. */
  signals: PlayerSignal[];
}

// ---- World data (the REST API's game-data snapshot) ----

export type WorldState = 'ok' | 'disabled' | 'unavailable' | 'unconfigured' | 'pending';

export interface WorldStatus {
  state: WorldState;
  message: string | null;
  takenAt: string | null;
  fps: number | null;
  counts: { players: number; ownedPals: number; basePals: number; wildPals: number; npcs: number; palBoxes: number } | null;
}

/** In-game map coordinates (x east, y north). */
export interface MapPoint {
  x: number;
  y: number;
}

export interface Guild {
  guildId: string;
  name: string;
  members: number;
  online: number;
  bases: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WorkerPal {
  instanceId: string;
  name: string;
  className: string | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
}

export interface Base {
  id: number;
  guildId: string;
  guildName: string | null;
  location: MapPoint;
  firstSeenAt: string;
  lastSeenAt: string;
  workers: WorkerPal[] | null;
}

export interface GuildDetail {
  guild: Guild;
  members: KnownPlayer[];
  bases: Base[];
}

export interface PlayerPal {
  instanceId: string;
  name: string | null;
  className: string | null;
  level: number | null;
  unitType: string;
  lastSeenAt: string;
  active: boolean;
}

export type SignalKind = 'movement' | 'level' | 'shared_ip';

export interface PlayerSignal {
  id: number;
  userId: string;
  playerName: string | null;
  kind: SignalKind;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  dismissedAt: string | null;
  dismissedBy: string | null;
}

export interface WorldMapData {
  takenAt: string;
  players: Array<{ userId: string; name: string; level: number | null; guildId: string | null; guildName: string | null; at: MapPoint }>;
  pals: Array<{ kind: 'OtomoPal' | 'BaseCampPal' | 'WildPal'; name: string; className: string | null; level: number | null; guildName: string | null; owner: string | null; at: MapPoint }>;
  npcs: Array<{ className: string | null; at: MapPoint }>;
  bases: Array<{ id: number; guildId: string; guildName: string | null; workers: number; at: MapPoint }>;
  truncated: boolean;
}

export interface Hotspot {
  cell: string;
  center: MapPoint;
  samples: number;
  avgActors: number;
  avgPlayers: number;
  avgFps: number | null;
  fpsVsAverage: number | null;
}

export interface WorldPerformance {
  hours: number;
  avgFps: number | null;
  timeline: Array<{ at: string; fps: number | null; actors: number; players: number }>;
  hotspots: Hotspot[];
}

export type AdapterKind = 'rest' | 'mock';

export interface ServerConnection {
  id: number;
  name: string;
  adapter: AdapterKind;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorUsername: string | null;
  category: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuthOptions {
  setupRequired: boolean;
  providers: { discord: boolean; password: boolean };
}
