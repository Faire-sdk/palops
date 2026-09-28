import { randomToken } from '../../utils/crypto.js';

const TTL_MS = 10 * 60 * 1000;

/** What the user was doing when they were sent to Discord. */
export type OAuthIntent =
  | { kind: 'login' }
  | { kind: 'setup'; setupToken: string }
  | { kind: 'link'; userId: number };

/**
 * Single-use OAuth `state` values, kept server side so the callback can only
 * complete a flow this panel started (and in the same browser, via a cookie).
 */
export class OAuthStateStore {
  private readonly states = new Map<string, { intent: OAuthIntent; expiresAt: number }>();

  create(intent: OAuthIntent): string {
    const now = Date.now();
    for (const [key, entry] of this.states) if (entry.expiresAt <= now) this.states.delete(key);
    const state = randomToken();
    this.states.set(state, { intent, expiresAt: now + TTL_MS });
    return state;
  }

  consume(state: string): OAuthIntent | undefined {
    const entry = this.states.get(state);
    this.states.delete(state);
    return entry && entry.expiresAt > Date.now() ? entry.intent : undefined;
  }
}

export const OAUTH_STATE_TTL_MS = TTL_MS;
