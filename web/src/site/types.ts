export interface PublicServer {
  state: 'online' | 'offline' | 'unknown';
  name: string;
  description: string;
  version: string | null;
  players: { online: number; max: number } | null;
  uptimeSeconds: number | null;
  inGameDays: number | null;
  joinAddress: string | null;
  discordInvite: string | null;
  showOnlinePlayers: boolean;
  playerLogin: boolean;
  knownPlayers: number;
}

export interface PublicPlayer {
  name: string;
  level: number | null;
  guild: string | null;
}

export interface PublicGuild {
  name: string;
  members: number;
  online: number;
  bases: number;
}

export interface Character {
  name: string;
  level: number | null;
  guild: string | null;
  online: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  platformId: string;
  verified: boolean;
  linkedAt: string | null;
}

export interface PlayerProfile {
  account: { discord: { id: string; username: string | null; avatar: string | null }; createdAt: string };
  character: Character | null;
}
