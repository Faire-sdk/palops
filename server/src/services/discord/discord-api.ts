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

  /** Fills in the reply to a command that was answered with "thinking…". */
  editOriginal(applicationId: string, interactionToken: string, content: string): Promise<unknown> {
    return this.call('PATCH', `/webhooks/${applicationId}/${interactionToken}/messages/@original`, { content: content.slice(0, 2000), allowed_mentions: { parse: [] } }, false);
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, auth = true, retried = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: { ...(auth ? { Authorization: `Bot ${this.token}` } : {}), 'User-Agent': 'PalOps (https://github.com/Faire-sdk/palops, 1)', Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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
      return this.call<T>(method, path, body, auth, true);
    }
    if (!response.ok) throw new DiscordApiError(response.status, describe(response.status, parsed));
    return parsed as T;
  }
}
