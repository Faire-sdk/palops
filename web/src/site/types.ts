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
  id: number | null;
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
  profileId: number;
  playtimeSeconds: number;
  sessions: number;
  verified: boolean;
  /** "in-game code" or "staff" once verified. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  linkedAt: string | null;
  verification: { requestedAt: string | null; inGameCode: boolean; codePending: boolean };
}

export interface PlayerProfile {
  account: { discord: { id: string; username: string | null; avatar: string | null }; createdAt: string };
  character: Character | null;
  privacy: { showDiscord: boolean };
}

/** A row in the public player directory. */
export interface DirectoryPlayer {
  id: number;
  name: string;
  level: number | null;
  guild: string | null;
  online: boolean;
  lastSeenAt: string;
  playtimeSeconds: number;
  verified: boolean;
}

export interface PublicProfile extends DirectoryPlayer {
  firstSeenAt: string;
  sessions: number;
  averageSessionSeconds: number;
  longestSessionSeconds: number;
  guildInfo: { name: string; members: number; online: number; bases: number } | null;
  pals: Array<{ name: string | null; className: string | null; level: number | null; active: boolean }>;
  discord: { username: string | null; avatar: string | null; id: string } | null;
}
