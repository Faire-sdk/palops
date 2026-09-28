import type { DiscordAccount } from '../authentication/users.js';

/**
 * Discord OAuth2 (authorization code flow, `identify` scope). This module is
 * the Discord identity boundary; a future Discord bot will live beside it in
 * services/discord and map Discord users to panel users by their Discord id.
 */
/** The signed-in Discord user. The access token is only present for the moment of sign-in and is never stored. */
export type DiscordSignIn = DiscordAccount & { accessToken?: string };

export interface DiscordOAuthProvider {
  /** `joinServer` also asks for permission to add the person to the community's Discord server. */
  authorizeUrl(state: string, options?: { joinServer?: boolean }): string;
  /** Exchanges an authorization code for the signed-in Discord user. */
  exchange(code: string): Promise<DiscordSignIn>;
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

  authorizeUrl(state: string, options: { joinServer?: boolean } = {}): string {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: options.joinServer ? 'identify guilds.join' : 'identify',
      redirect_uri: this.config.redirectUri,
      state,
      prompt: 'none',
    }).toString();
    return url.toString();
  }

  async exchange(code: string): Promise<DiscordSignIn> {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const tokenResponse = await this.call(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }),
    });
    const accessToken = (tokenResponse as { access_token?: unknown }).access_token;
    if (typeof accessToken !== 'string') throw new DiscordOAuthError('Discord did not return an access token');

    const me = (await this.call(`${this.apiBase}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })) as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown };
    if (typeof me.id !== 'string') throw new DiscordOAuthError('Discord returned an unexpected user');
    return {
      id: me.id,
      username: typeof me.username === 'string' ? me.username : null,
      avatar: typeof me.avatar === 'string' ? me.avatar : null,
      accessToken,
    };
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
