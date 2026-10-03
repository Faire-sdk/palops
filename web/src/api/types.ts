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
  | 'players.ip'
  | 'accounts.private'
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

export interface ScheduleSettings {
  restartEnabled: boolean;
  restartEveryHours: number;
  restartAt: string;
  restartWarnMinutes: number;
  restartMessage: string;
  saveEnabled: boolean;
  saveEveryMinutes: number;
  updatedAt: string | null;
}

export interface ScheduleStatus {
  timeZone: string;
  nextRestartAt: string | null;
  nextSaveAt: string | null;
  lastRestartAt: string | null;
  lastSaveAt: string | null;
  lastError: { at: string; message: string } | null;
}

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
  playtimeSeconds?: number;
  sessions?: number;
  /** Whether a website account is linked to this character, and whether that link is proven. */
  link?: 'verified' | 'claimed' | null;
}

export interface KnownPlayer {
  id: number;
  userId: string;
  playerId: string | null;
  name: string;
  accountName: string | null;
  level: number | null;
  guild: string | null;
  guildId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  online: boolean;
  banned?: boolean;
  playtimeSeconds?: number;
  sessions?: number;
  link?: 'verified' | 'claimed' | null;
}

/** An address the panel enforces a ban on: one IP or a CIDR range. */
export interface IpBan {
  id: number;
  ip: string;
  reason: string | null;
  playerUserId: string | null;
  playerName: string | null;
  actorUsername: string | null;
  createdAt: string;
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

/** The website account linked to a character. */
/** What Discord sign-in returned. Email and servers are null without accounts.private. */
export interface DiscordProfile {
  connections: Array<{ type: string; id: string; name: string; verified: boolean }> | null;
  /** false: not in the community server; null: unknown. */
  communityMember: { joinedAt: string | null; nick: string | null; roles: string[] } | false | null;
  email: string | null;
  emailVerified: boolean | null;
  guilds: Array<{ id: string; name: string }> | null;
  updatedAt: string;
}

export interface WebsiteAccount {
  id: number;
  discord: { id: string; username: string | null; avatar: string | null };
  player: { userId: string; name: string | null; level: number | null } | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  requestedAt: string | null;
  linkedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  profile: DiscordProfile | null;
}

export interface CharacterLink {
  discord: { id: string; username: string | null; avatar: string | null };
  profile?: DiscordProfile | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  requestedAt: string | null;
  linkedAt: string | null;
}

export interface LinkRequest {
  accountId: number;
  discord: { id: string; username: string | null; avatar: string | null };
  player: { id: number; userId: string; name: string; level: number | null };
  requestedAt: string | null;
  linkedAt: string | null;
}

export interface ServerMetrics {
  knownPlayers: number;
  newPlayers7d: number;
  uniquePlayers: { day: number; week: number; month: number };
  playtimeSeconds: { day: number; week: number; month: number };
  averageSessionSeconds: number;
  sessions30d: number;
  peakConcurrent: { count: number; at: string | null };
  busiestHours: Array<{ hour: number; seconds: number }>;
  daily: Array<{ day: string; seconds: number; players: number }>;
}

export interface PlayerActivity {
  seconds: number;
  sessions: number;
  longestSeconds: number;
  averageSeconds: number;
  seconds7d: number;
  seconds30d: number;
  /** Playtime per UTC day, oldest first, for the last 14 days. */
  daily: Array<{ day: string; seconds: number }>;
  recent: Array<{ startedAt: string; endedAt: string | null; seconds: number }>;
}

export interface PlayerProfile {
  userId: string;
  activity: PlayerActivity;
  link: CharacterLink | null;
  player: KnownPlayer | null;
  /** Only while the player is online. ip is null without players.ip. */
  live: { ping: number | null; location: { x: number; y: number } | null; buildingCount: number | null; ip: string | null } | null;
  banned: boolean;
  /** Empty unless the viewer has players.ip. */
  addresses: Array<{ ip: string; firstSeenAt: string; lastSeenAt: string; banned: boolean }>;
  /** Other players seen on the same addresses. Empty unless the viewer has players.ip. */
  linkedPlayers: Array<{ userId: string; name: string | null; ip: string; lastSeenAt: string }>;
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
  /** emergency: the owner's break-glass password (PANEL_EMERGENCY_PASSWORD) is set. */
  providers: { discord: boolean; password: boolean; emergency?: boolean };
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
  joinOnLogin: boolean;
  verifiedRoleId: string | null;
  roleOwnerId: string | null;
  roleAdminId: string | null;
  roleModeratorId: string | null;
  syncNicknames: boolean;
  syncBans: boolean;
  relayEnabled: boolean;
  relayChannelId: string | null;
  relayToDiscord: boolean;
  relayToGame: boolean;
  relayPattern: string | null;
  relaySources: Array<'game' | 'paldefender'>;
  relayPrefix: string;
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

// ---- PalBan Network (optional shared banlist integration) ----

export interface PalBanSettings {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  sendEvents: boolean;
  checkJoins: boolean;
  sendLogs: boolean;
  sendLogAddresses: boolean;
  serverName: string | null;
  updatedAt: string;
}

export interface PalBanStatus {
  enabled: boolean;
  serverName: string | null;
  lastSyncAt: string | null;
  error: string | null;
  bans: { total: number; active: number };
  notInGame: number;
  queued: number;
  logsQueued: number;
}

export interface PalBanBan {
  id: string;
  gameId: string;
  playerName: string | null;
  discordId: string | null;
  reason: string | null;
  category: string | null;
  status: string;
  active: boolean;
  banDate: string | null;
  expiresAt: string | null;
  unbanDate: string | null;
  inGame: boolean;
  applied: boolean;
}

export interface PalBanPlayer {
  gameId: string;
  playerName: string | null;
  linkedDiscordId: string | null;
  localBanStatus: 'BANNED' | 'PREVIOUSLY_BANNED' | 'NOT_BANNED';
  localBans: Array<{ id: string; reason: string | null; category: string | null; status: string; banDate: string | null; expiresAt: string | null }>;
  network: {
    serversReporting: number;
    reportCount: number;
    activeReportCount: number;
    reports: Array<{ server: string; reason: string | null; status: string; banDate: string | null; expiresAt: string | null }>;
  };
  detections: Array<{ provider: string | null; type: string | null; severity: string | null; confidence: number | null; message: string | null; detectedAt: string | null }>;
}
