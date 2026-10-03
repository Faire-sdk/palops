import type { DiscordAccount } from '../authentication/users.js';

/**
 * Discord OAuth2 (authorization code flow). This module is the Discord identity
 * boundary; the Discord bot lives beside it in services/discord and maps Discord
 * users to panel users by their Discord id.
 */

/**
 * Everything sign-in asks for: the account, its email, linked accounts (Steam, Xbox, ...),
 * the servers it's in, permission to add it to the community server, and its membership there.
 */
export const DISCORD_SCOPES = ['identify', 'email', 'connections', 'guilds', 'guilds.join', 'guilds.members.read'] as const;

export interface DiscordConnection {
  /** e.g. steam, xbox, epicgames, twitch */
  type: string;
  id: string;
  name: string;
  verified: boolean;
}

/** What the extra scopes return. Each part is null when Discord didn't return it. */
export interface DiscordProfile {
  email: string | null;
  emailVerified: boolean | null;
  connections: DiscordConnection[] | null;
  guilds: Array<{ id: string; name: string }> | null;
  /** Membership in the community server (the Discord bot's server ID), if one is set. */
  communityMember: { joinedAt: string | null; nick: string | null; roles: string[] } | false | null;
}

/** The signed-in Discord user. The access token is only present for the moment of sign-in and is never stored. */
export type DiscordSignIn = DiscordAccount & { accessToken?: string; profile?: DiscordProfile };

export interface DiscordOAuthProvider {
  authorizeUrl(state: string): string;
  /** Exchanges an authorization code for the signed-in Discord user. `guildId` is the community server to check membership of. */
  exchange(code: string, options?: { guildId?: string | null }): Promise<DiscordSignIn>;
}

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Overridable for tests. */
  apiBase?: string;
}

export class DiscordOAuthError extends Error {}

export class DiscordOAuthClient implements DiscordOAuthProvider {
  private readonly apiBase: string;

  constructor(private readonly config: DiscordOAuthConfig) {
    this.apiBase = config.apiBase ?? 'https://discord.com/api/v10';
  }

  authorizeUrl(state: string): string {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: DISCORD_SCOPES.join(' '),
      redirect_uri: this.config.redirectUri,
      state,
      prompt: 'none',
    }).toString();
    return url.toString();
  }

  async exchange(code: string, options: { guildId?: string | null } = {}): Promise<DiscordSignIn> {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const tokenResponse = await this.call(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }),
    });
    const accessToken = (tokenResponse as { access_token?: unknown }).access_token;
    if (typeof accessToken !== 'string') throw new DiscordOAuthError('Discord did not return an access token');

    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
    const me = (await this.call(`${this.apiBase}/users/@me`, auth)) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      avatar?: unknown;
      email?: unknown;
      verified?: unknown;
    };
    if (typeof me.id !== 'string') throw new DiscordOAuthError('Discord returned an unexpected user');

    // The extra details are best effort: signing in never fails because one of them couldn't be read.
    const optional = (path: string) => this.call(`${this.apiBase}${path}`, auth).catch(() => null);
    const [connections, guilds, member] = await Promise.all([
      optional('/users/@me/connections'),
      optional('/users/@me/guilds'),
      options.guildId ? this.memberOf(options.guildId, auth) : Promise.resolve(null),
    ]);
    return {
      id: me.id,
      username: typeof me.username === 'string' ? me.username : null,
      avatar: typeof me.avatar === 'string' ? me.avatar : null,
      accessToken,
      profile: {
        email: typeof me.email === 'string' ? me.email : null,
        emailVerified: typeof me.verified === 'boolean' ? me.verified : null,
        connections: Array.isArray(connections) ? connections.flatMap(toConnection) : null,
        guilds: Array.isArray(guilds) ? guilds.flatMap((g) => (isRecord(g) && typeof g.id === 'string' ? [{ id: g.id, name: typeof g.name === 'string' ? g.name : g.id }] : [])) : null,
        communityMember: member,
      },
    };
  }

  /** The member in the community server; false when they aren't in it, null when it couldn't be checked. */
  private async memberOf(guildId: string, auth: RequestInit): Promise<DiscordProfile['communityMember']> {
    try {
      const m = await this.call(`${this.apiBase}/users/@me/guilds/${encodeURIComponent(guildId)}/member`, auth);
      if (!isRecord(m)) return null;
      return {
        joinedAt: typeof m.joined_at === 'string' ? m.joined_at : null,
        nick: typeof m.nick === 'string' ? m.nick : null,
        roles: Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string') : [],
      };
    } catch (err) {
      return err instanceof DiscordOAuthError && err.message.endsWith('HTTP 404') ? false : null;
    }
  }

  private async call(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    } catch {
      throw new DiscordOAuthError('Could not reach Discord');
    }
    if (!response.ok) throw new DiscordOAuthError(`Discord returned HTTP ${response.status}`);
    return response.json();
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function toConnection(c: unknown): DiscordConnection[] {
  if (!isRecord(c) || typeof c.type !== 'string' || typeof c.id !== 'string') return [];
  return [{ type: c.type, id: c.id, name: typeof c.name === 'string' ? c.name : c.id, verified: c.verified === true }];
}
