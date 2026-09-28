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
}

export interface KnownPlayer {
  id: number;
  userId: string;
  playerId: string | null;
  name: string;
  level: number | null;
  guild: string | null;
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
