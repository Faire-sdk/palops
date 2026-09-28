/**
 * Pieces of the game <-> Discord chat relay that don't need Discord itself:
 * reading a chat line out of the console, and turning a Discord message into
 * something safe to show in the game.
 */

/**
 * A guess at how Palworld's server log shows chat: `[2026-09-28 12:00:00] [CHAT] <Name> message`.
 * It's only a starting point; owners check it against real lines with the pattern tester.
 */
export const DEFAULT_CHAT_PATTERN = '^\\[[^\\]]*\\]\\s*\\[CHAT\\]\\s*<(?<player>[^>]+)>\\s*(?<message>.+)$';

export const RELAY_SOURCES = ['game', 'paldefender'] as const;
export type RelaySource = (typeof RELAY_SOURCES)[number];

const MAX_PATTERN = 300;
const MAX_LINE = 600;
/** Something that nests a repeat inside a repeat, e.g. (a+)+, can take forever to fail on a long line. */
const NESTED_REPEAT = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

export class PatternError extends Error {}

/** Compiles an owner's chat pattern, refusing anything that isn't usable and safe to run on every log line. */
export function compileChatPattern(source: string): RegExp {
  if (source.length > MAX_PATTERN) throw new PatternError(`Keep the pattern under ${MAX_PATTERN} characters`);
  if (NESTED_REPEAT.test(source)) throw new PatternError('That pattern repeats a repeat (like (a+)+), which can hang on a long line. Simplify it.');
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch (err) {
    throw new PatternError(`That isn’t a valid pattern: ${err instanceof Error ? err.message : 'error'}`);
  }
  // Named groups are how the pattern says which part is the name and which is the text.
  if (!/\(\?<player>/.test(source) || !/\(\?<message>/.test(source)) {
    throw new PatternError('The pattern needs two named groups: (?<player>…) for the name and (?<message>…) for what they said');
  }
  return re;
}

/** The player and message in a console line, or null if it isn't a chat line. */
export function parseChatLine(re: RegExp, line: string): { player: string; message: string } | null {
  const match = re.exec(line.slice(0, MAX_LINE));
  const player = match?.groups?.player?.trim();
  const message = match?.groups?.message?.trim();
  return player && message ? { player, message } : null;
}

export interface DiscordMessage {
  content: string;
  mentions?: Array<{ id: string; username?: string; global_name?: string | null }>;
  mention_roles?: string[];
  attachments?: unknown[];
  sticker_items?: unknown[];
}

/** Turns Discord's markup into plain text a player can read: names instead of <@123>, no emoji codes, one line. */
export function plainDiscordText(message: DiscordMessage): string {
  const names = new Map((message.mentions ?? []).map((u) => [u.id, u.global_name || u.username || 'someone']));
  let text = message.content
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id) ?? 'someone'}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, '')
    .replace(/https?:\/\/\S+/g, (url) => (url.length > 40 ? `${url.slice(0, 37)}...` : url))
    // Anything that's a control character or would break the line in game.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text && ((message.attachments?.length ?? 0) > 0 || (message.sticker_items?.length ?? 0) > 0)) text = '[attachment]';
  return text;
}

/** Fits a relayed message into the game's announcement limit, cutting on a word where it can. */
export function fitForGame(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
