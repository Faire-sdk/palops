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
  | 'paldefender.manage'
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
  accountName: string | null;
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
  /** Addresses this player has connected from. Empty unless the viewer has world.view. */
  ips: PlayerIp[];
  /** Live connection details while online. Null unless the viewer has world.view. */
  live: { ip: string | null; ping: number | null; buildingCount: number | null; position: MapPoint | null } | null;
}

export interface PlayerIp {
  ip: string;
  firstSeenAt: string;
  lastSeenAt: string;
  banned: boolean;
  /** Other accounts seen on the same address. */
  sharedWith: Array<{ userId: string; name: string; lastSeenAt: string }>;
}

export interface IpBan {
  id: number;
  ip: string;
  reason: string | null;
  sourceUserId: string | null;
  sourceName: string | null;
  actorUsername: string | null;
  createdAt: string;
  accounts: Array<{ userId: string; name: string }>;
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

export type SignalKind = 'movement' | 'level' | 'shared_ip' | 'base_intrusion';

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

/** The live map's background image; bounds are its edges in map coordinates. */
export interface MapImage {
  contentType: string;
  width: number;
  height: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  aligned: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

// ---- PalDefender (optional plugin integration) ----

export interface PalDefenderSettings {
  enabled: boolean;
  host: string;
  port: number;
  useTls: boolean;
  hasToken: boolean;
  updatedAt: string;
}

export interface PalDefenderStatus {
  enabled: boolean;
  version: string | null;
  lastSyncAt: string | null;
  error: string | null;
}

export interface PalDefenderCheck {
  name: string;
  permission: string;
  ok: boolean;
  message: string | null;
}

/** How mirroring an action to PalDefender went. Null when the integration is off. */
export type PalDefenderResult = { ok: boolean; message: string | null } | null;

export interface PalDefenderBan {
  kind: 'user' | 'ip';
  id: string;
  active: boolean;
  reason: string | null;
  bannedBy: string | null;
  bannedVia: string | null;
  bannedAt: string | null;
  unbannedAt: string | null;
}

export interface PdPal {
  instanceId: string;
  palId: string;
  nickname: string | null;
  gender: string | null;
  level: number | null;
  shiny: boolean;
  hp: number | null;
  passives: string[];
  activeSkills: string[];
  slot: number | null;
  page: number | null;
}

export interface PdPals {
  player: { uid: string | null; name: string | null };
  team: PdPal[];
  palbox: PdPal[];
  baseCamps: Array<{ id: string; level: number | null; state: string | null; mapPos: MapPoint | null; pals: PdPal[] }>;
}

export interface PdItems {
  player: { uid: string | null; name: string | null };
  containers: Array<{ name: string; available: boolean; usedSlots: number | null; maxSlots: number | null; slots: Array<{ slot: number; itemId: string; count: number }> }>;
}

export interface PdTechs {
  unlocked: string[];
  unlockedCount: number;
  lockedCount: number;
  totalCount: number;
}

export interface PdProgression {
  progression: Record<string, unknown>;
}

export interface PdGuildSummary {
  id: string;
  name: string;
  level: number | null;
  admin: { id: string; name: string } | null;
  memberCount: number;
  campCount: number;
}

export interface PdGuild {
  name: string;
  level: number | null;
  admin: { id: string; name: string } | null;
  members: Array<{ uid: string; name: string; status: string | null }>;
  camps: Array<{ id: string; level: number | null; state: string | null; mapPos: MapPoint | null }>;
  storage: { used: number; max: number } | null;
  currentResearch: string | null;
}

export const PD_RELICS = ['CapturePower', 'HungerReduction', 'SwimSpeed', 'FoodDecayReduction', 'JumpPower', 'GliderSpeed', 'ClimbSpeed', 'StatusAilmentResist', 'StaminaReduction', 'SphereHoming', 'ExpBonus', 'RainbowPassiveRate', 'MoveSpeed'] as const;

export const PD_MESSAGE_TYPES = [
  { id: 'PlayerChat', label: 'Chat message to them' },
  { id: 'PlayerGlobalChat', label: 'Global chat message' },
  { id: 'PlayerGuildChat', label: 'Guild chat message' },
  { id: 'PlayerLogNormal', label: 'Log line (normal)' },
  { id: 'PlayerLogImportant', label: 'Log line (important)' },
  { id: 'PlayerLogVeryImportant', label: 'Log line (very important)' },
] as const;

// ---- Console ----

export type ConsoleSource = 'panel' | 'game' | 'paldefender';
export type ConsoleLevel = 'info' | 'warn' | 'error';

export interface ConsoleLine {
  id: number;
  at: string;
  source: ConsoleSource;
  level: ConsoleLevel;
  message: string;
}

export interface TailStatus {
  source: ConsoleSource;
  path: string;
  state: 'watching' | 'missing';
  files: number;
  lastLineAt: string | null;
}

export interface LoggerSettings {
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  hasToken: boolean;
}

export interface LoggerStatus {
  state: 'off' | 'connecting' | 'connected' | 'error';
  message: string | null;
  lastMessageAt: string | null;
}

export interface ConsoleSettings {
  tailEnabled: boolean;
  gameLogPath: string | null;
  paldefenderLogPath: string | null;
  logger: LoggerSettings;
  updatedAt: string | null;
}

export interface PathCheck {
  source: 'game' | 'paldefender';
  ok: boolean;
  kind: 'file' | 'directory' | null;
  message: string | null;
}

// ---- Discord bot (optional) ----

export interface DiscordBotSettings {
  enabled: boolean;
  applicationId: string | null;
  publicKey: string | null;
  hasToken: boolean;
  guildId: string | null;
  publicInfo: boolean;
  eventsChannelId: string | null;
  logChannelId: string | null;
  logMinLevel: ConsoleLevel;
  notifyBans: boolean;
  notifySignals: boolean;
  notifyServer: boolean;
  notifyJoins: boolean;
  gatewayEnabled: boolean;
  presenceEnabled: boolean;
  statusChannelId: string | null;
  commandsRegisteredAt: string | null;
  updatedAt: string | null;
}

export interface GatewayStatus {
  state: 'off' | 'connecting' | 'connected' | 'error';
  message: string | null;
  botUserId: string | null;
}

export interface BotCheck {
  name: string;
  ok: boolean;
  message: string | null;
}
