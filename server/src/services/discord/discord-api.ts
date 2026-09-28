export class DiscordApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_BASE = 'https://discord.com/api/v10';

/** Discord's own error text is safe and useful ("Missing Access"); anything else is trimmed. */
function describe(status: number, body: unknown): string {
  const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  if (status === 401) return 'Discord rejected the bot token';
  if (status === 403) return `Discord says the bot lacks access${typeof message === 'string' ? `: ${message}` : ''}`;
  if (status === 404) return 'Discord couldn’t find that (check the ID, and that the bot is in the server)';
  return typeof message === 'string' ? message.slice(0, 200) : `Discord returned HTTP ${status}`;
}

/** The few Discord REST calls the bot needs. */
export class DiscordApi {
  constructor(
    private readonly token: string,
    private readonly base = DEFAULT_BASE,
  ) {}

  me(): Promise<{ id: string; username: string }> {
    return this.call('GET', '/users/@me');
  }

  guild(id: string): Promise<{ id: string; name: string }> {
    return this.call('GET', `/guilds/${id}`);
  }

  channel(id: string): Promise<{ id: string; name?: string; guild_id?: string }> {
    return this.call('GET', `/channels/${id}`);
  }

  /** Replaces the server's slash commands with these. */
  registerGuildCommands(applicationId: string, guildId: string, commands: unknown[]): Promise<unknown> {
    return this.call('PUT', `/applications/${applicationId}/guilds/${guildId}/commands`, commands);
  }

  /** Plain text; nothing in it can ping anyone. */
  postMessage(channelId: string, content: string): Promise<unknown> {
    return this.call('POST', `/channels/${channelId}/messages`, { content: content.slice(0, 2000), allowed_mentions: { parse: [] } });
  }

  // ---- Members, roles and bans ----

  /** The member's roles and nickname, or null when they aren't in the server. */
  async member(guildId: string, userId: string): Promise<{ roles: string[]; nick: string | null } | null> {
    try {
      const m = await this.call<{ roles?: string[]; nick?: string | null }>('GET', `/guilds/${guildId}/members/${userId}`);
      return { roles: m.roles ?? [], nick: m.nick ?? null };
    } catch (err) {
      if (err instanceof DiscordApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Puts someone in the server using the access token from their sign-in (needs the guilds.join scope). */
  addMember(guildId: string, userId: string, body: { access_token: string; nick?: string; roles?: string[] }): Promise<unknown> {
    return this.call('PUT', `/guilds/${guildId}/members/${userId}`, body);
  }

  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<unknown> {
    return this.call('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, true, reason);
  }

  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<unknown> {
    return this.call('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, true, reason);
  }

  setNickname(guildId: string, userId: string, nick: string | null, reason: string): Promise<unknown> {
    return this.call('PATCH', `/guilds/${guildId}/members/${userId}`, { nick }, true, reason);
  }

  banMember(guildId: string, userId: string, reason: string): Promise<unknown> {
    return this.call('PUT', `/guilds/${guildId}/bans/${userId}`, { delete_message_seconds: 0 }, true, reason);
  }

  unbanMember(guildId: string, userId: string, reason: string): Promise<unknown> {
    return this.call('DELETE', `/guilds/${guildId}/bans/${userId}`, undefined, true, reason);
  }

  /** Answers an interaction that arrived over the gateway (over HTTP the answer is the response itself). */
  interactionCallback(interactionId: string, interactionToken: string, response: unknown): Promise<unknown> {
    return this.call('POST', `/interactions/${interactionId}/${interactionToken}/callback`, response, false);
  }

  /** Discord allows two name changes per channel every ten minutes, so callers must not do this often. */
  renameChannel(channelId: string, name: string): Promise<unknown> {
    return this.call('PATCH', `/channels/${channelId}`, { name });
  }

  /** Fills in the reply to a command that was answered with "thinking…". */
  editOriginal(applicationId: string, interactionToken: string, content: string): Promise<unknown> {
    return this.call('PATCH', `/webhooks/${applicationId}/${interactionToken}/messages/@original`, { content: content.slice(0, 2000), allowed_mentions: { parse: [] } }, false);
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, auth = true, reason?: string, retried = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: { ...(auth ? { Authorization: `Bot ${this.token}` } : {}), ...(reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason.slice(0, 400)) } : {}), 'User-Agent': 'PalOps (https://github.com/Faire-sdk/palops, 1)', Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch (err) {
      throw new DiscordApiError(0, err instanceof Error && err.name === 'TimeoutError' ? 'Discord did not answer in time' : 'Could not reach Discord');
    }
    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (response.status === 429 && !retried) {
      const wait = Math.min(Number((parsed as { retry_after?: number } | undefined)?.retry_after ?? 1), 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.call<T>(method, path, body, auth, reason, true);
    }
    if (!response.ok) throw new DiscordApiError(response.status, describe(response.status, parsed));
    return parsed as T;
  }
}
