import type { DiscordApi } from './discord-api.js';
import type { DiscordProfileService } from './profiles.js';

/** Profiles older than this are looked up again. */
const STALE_MS = 6 * 60 * 60 * 1000;
/** Opening one profile refreshes it if it's older than this. */
const FRESH_MS = 60 * 1000;
const ROLE_CACHE_MS = 10 * 60 * 1000;
/** Gap between background lookups, well inside Discord's rate limits. */
const GAP_MS = 250;
const MAX_QUEUE = 200;

export interface RoleInfo {
  id: string;
  name: string;
  /** 0 = no colour. */
  color: number;
  position: number;
}

/**
 * Keeps Discord names and profile pictures current by asking Discord with the bot's
 * token (GET /users/{id}), the way PalBan Network does, instead of relying on the
 * copy from each person's last sign-in. Needs only a saved bot token; everything is
 * best effort and never blocks a page for long.
 */
export class DiscordLookupService {
  private attempted = new Map<string, number>();
  private inFlight = new Map<string, Promise<void>>();
  private queue: string[] = [];
  private running: Promise<void> | undefined;
  private roleCache: { guildId: string; at: number; roles: RoleInfo[] } | undefined;

  constructor(
    private readonly api: () => DiscordApi | null,
    private readonly guildId: () => string | null,
    private readonly profiles: DiscordProfileService,
    private readonly gapMs = GAP_MS,
  ) {}

  /** Looks one user up now, unless this panel already did within maxAgeMs. */
  async refresh(discordId: string, maxAgeMs = FRESH_MS): Promise<void> {
    const api = this.api();
    if (!api) return;
    // A lookup already on its way answers this one too.
    const pending = this.inFlight.get(discordId);
    if (pending) return pending;
    const now = Date.now();
    if (now - (this.attempted.get(discordId) ?? 0) < maxAgeMs) return;
    this.attempted.set(discordId, now);
    const lookup = this.lookUp(api, discordId).finally(() => this.inFlight.delete(discordId));
    this.inFlight.set(discordId, lookup);
    return lookup;
  }

  private async lookUp(api: DiscordApi, discordId: string): Promise<void> {
    try {
      const u = await api.user(discordId);
      const known = this.profiles.identity(discordId);
      this.profiles.saveIdentity(discordId, {
        username: u.username ?? known?.username ?? null,
        globalName: u.global_name ?? null,
        avatar: u.avatar ?? null,
        banner: u.banner ?? null,
        accentColor: typeof u.accent_color === 'number' ? u.accent_color : null,
      });
    } catch {
      // Unknown user, missing token permission or Discord down: keep what we have.
    }
  }

  /** Queues background lookups for anyone not refreshed in the last few hours. */
  refreshStale(discordIds: string[]): void {
    if (!this.api()) return;
    const now = Date.now();
    for (const id of discordIds) {
      if (this.queue.length >= MAX_QUEUE) break;
      if (this.queue.includes(id) || now - (this.attempted.get(id) ?? 0) < STALE_MS) continue;
      const known = this.profiles.identity(id);
      if (known && now - Date.parse(known.updatedAt) < STALE_MS) continue;
      this.queue.push(id);
    }
    this.running ??= this.drain().finally(() => (this.running = undefined));
  }

  /** Resolves when queued lookups are done (for tests and shutdown). */
  settle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** The community server's roles, cached for a few minutes; null when unavailable. */
  async roles(): Promise<RoleInfo[] | null> {
    const api = this.api();
    const guildId = this.guildId();
    if (!api || !guildId) return null;
    if (this.roleCache && this.roleCache.guildId === guildId && Date.now() - this.roleCache.at < ROLE_CACHE_MS) return this.roleCache.roles;
    try {
      const roles = (await api.roles(guildId)).map((r) => ({ id: r.id, name: r.name, color: r.color ?? 0, position: r.position ?? 0 }));
      this.roleCache = { guildId, at: Date.now(), roles };
      return roles;
    } catch {
      return this.roleCache?.guildId === guildId ? this.roleCache.roles : null;
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const id = this.queue.shift()!;
      await this.refresh(id, STALE_MS).catch(() => undefined);
      if (this.queue.length && this.gapMs) await new Promise((r) => setTimeout(r, this.gapMs));
    }
  }
}
