import { createPublicKey, verify } from 'node:crypto';

/** DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI, which Node can load. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** Discord signs each request with the time it was sent; older than this is a replay. */
export const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Checks that a request really came from Discord: an Ed25519 signature over
 * the timestamp header followed by the raw body, made with the application's
 * public key (shown in the Developer Portal).
 */
export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, body: Buffer, nowSeconds = Date.now() / 1000): boolean {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

// The parts of Discord's interaction payloads the bot reads.

export const InteractionType = { Ping: 1, Command: 2, Component: 3, Autocomplete: 4, Modal: 5 } as const;
export const ResponseType = { Pong: 1, Message: 4, Deferred: 5, Autocomplete: 8 } as const;
/** Only the person who ran the command sees the reply. */
export const EPHEMERAL = 64;

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  member?: { user?: { id: string; username?: string } };
  user?: { id: string; username?: string };
  data?: { name?: string; options?: CommandOption[] };
}

export interface CommandDefinition {
  name: string;
  description: string;
  type: 1;
  options?: Array<{ name: string; description: string; type: number; required?: boolean; autocomplete?: boolean; max_length?: number }>;
}

const STRING = 3;
const BOOLEAN = 5;
const player = (description: string) => ({ name: 'player', description, type: STRING, required: true, autocomplete: true });
const reason = { name: 'reason', description: 'Why (shown to the player and kept in their history)', type: STRING, max_length: 200 };

/** The slash commands, registered to the configured server. */
export const COMMANDS: CommandDefinition[] = [
  { name: 'status', description: 'Server status: online, players, FPS and uptime', type: 1 },
  { name: 'players', description: 'Who is online right now', type: 1 },
  { name: 'player', description: 'Look up a player', type: 1, options: [player('Name or platform ID')] },
  { name: 'kick', description: 'Kick an online player', type: 1, options: [player('Who to kick'), reason] },
  {
    name: 'ban',
    description: 'Ban a player',
    type: 1,
    options: [player('Who to ban'), reason, { name: 'ban_ip', description: 'Also ban the address they last connected from', type: BOOLEAN }],
  },
  { name: 'unban', description: 'Unban a player', type: 1, options: [player('Who to unban'), reason] },
  { name: 'announce', description: 'Broadcast a message to everyone on the server', type: 1, options: [{ name: 'message', description: 'What to say', type: STRING, required: true, max_length: 200 }] },
  { name: 'save', description: 'Save the world now', type: 1 },
];
