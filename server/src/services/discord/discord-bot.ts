import type { Config } from '../../config.js';
import type { DB } from '../../database/db.js';
import type { SecretBox } from '../../utils/crypto.js';
import { badRequest, HttpError } from '../../utils/errors.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import { hasPermission, type Permission } from '../authentication/permissions.js';
import type { User, UserService } from '../authentication/users.js';
import type { ConsoleLevel, ConsoleLine, ConsoleService } from '../console/console-service.js';
import { PalworldError, type PalworldService } from '../palworld/index.js';
import type { ModerationService } from '../players/moderation.js';
import type { KnownPlayer, PlayerDirectory } from '../players/player-directory.js';
import type { SiteAccountService } from '../site/site-accounts.js';
import type { WorldService } from '../world/world-service.js';
import { DiscordApi, DiscordApiError } from './discord-api.js';
import { DiscordGateway, Intents, type GatewayStatus, type Presence } from './gateway.js';
import { COMMANDS, EPHEMERAL, InteractionType, ResponseType, type CommandOption, type Interaction } from './interactions.js';

export interface DiscordBotSettings {
  enabled: boolean;
  applicationId: string | null;
  publicKey: string | null;
  hasToken: boolean;
  guildId: string | null;
  /** Anyone in the server may use /status and /players, without a linked panel account. */
  publicInfo: boolean;
  eventsChannelId: string | null;
  logChannelId: string | null;
  logMinLevel: ConsoleLevel;
  notifyBans: boolean;
  notifySignals: boolean;
  notifyServer: boolean;
  notifyJoins: boolean;
  /** Keep a live connection to Discord (needed for the bot's status and, later, the chat relay). */
  gatewayEnabled: boolean;
  /** Show the player count, or that the server is offline, as the bot's status. */
  presenceEnabled: boolean;
  statusChannelId: string | null;
  /** Add players to the Discord server when they sign in to the website. */
  joinOnLogin: boolean;
  /** Given to players whose character link is verified. */
  verifiedRoleId: string | null;
  roleOwnerId: string | null;
  roleAdminId: string | null;
  roleModeratorId: string | null;
  syncNicknames: boolean;
  /** Bans on either side are carried to the other, for verified links only. */
  syncBans: boolean;
  commandsRegisteredAt: string | null;
  updatedAt: string | null;
}

export interface DiscordBotInput {
  enabled: boolean;
  applicationId: string | null;
  publicKey: string | null;
  /** Omit to keep the stored token. */
  botToken?: string;
  guildId: string | null;
  publicInfo: boolean;
  eventsChannelId: string | null;
  logChannelId: string | null;
  logMinLevel: ConsoleLevel;
  notifyBans: boolean;
  notifySignals: boolean;
  notifyServer: boolean;
  notifyJoins: boolean;
  gatewayEnabled: boolean;
  presenceEnabled: boolean;
  statusChannelId: string | null;
  joinOnLogin: boolean;
  verifiedRoleId: string | null;
  roleOwnerId: string | null;
  roleAdminId: string | null;
  roleModeratorId: string | null;
  syncNicknames: boolean;
  syncBans: boolean;
}

export interface BotCheck {
  name: string;
  ok: boolean;
  message: string | null;
}

interface Row {
  enabled: number;
  application_id: string | null;
  public_key: string | null;
  bot_token_encrypted: string | null;
  guild_id: string | null;
  public_info: number;
  events_channel_id: string | null;
  log_channel_id: string | null;
  log_min_level: ConsoleLevel;
  notify_bans: number;
  notify_signals: number;
  notify_server: number;
  notify_joins: number;
  commands_registered_at: string | null;
  gateway_enabled: number;
  presence_enabled: number;
  status_channel_id: string | null;
  status_channel_name: string | null;
  status_channel_changed_at: string | null;
  join_on_login: number;
  verified_role_id: string | null;
  role_owner_id: string | null;
  role_admin_id: string | null;
  role_moderator_id: string | null;
  sync_nicknames: number;
  sync_bans: number;
  updated_at: string;
}

/** What a command needs, in the panel's own permissions, so Discord can do no more than the web panel. */
const COMMAND_PERMISSION: Record<string, Permission> = {
  status: 'server.view',
  players: 'players.view',
  player: 'players.view',
  kick: 'players.kick',
  ban: 'players.ban',
  unban: 'players.ban',
  announce: 'server.broadcast',
  save: 'server.control',
};
/** Commands anyone in the server may use when "public info" is on. */
const PUBLIC_COMMANDS = new Set(['status', 'players']);

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_PER_WINDOW = 6;
const WINDOW_MS = 10_000;
/** Discord allows about five messages every five seconds per channel; stay under it. */
const POST_INTERVAL_MS = 1500;
const MAX_MESSAGE_CHARS = 1900;
const MAX_QUEUED_LINES = 200;

/** Neutralise Discord markdown and mentions in names and messages we repeat. */
export const escapeMd = (text: string) => text.replace(/[\\*_~`|>@#:]/g, (c) => `\\${c}`);
const fence = (text: string) => text.replace(/```/g, 'ʼʼʼ');

const duration = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
};

/** Queues text for one channel and sends it in batches, so a burst becomes one message rather than a flood. */
class ChannelQueue {
  private lines: string[] = [];
  private dropped = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly send: (text: string) => Promise<unknown>,
    private readonly wrap: (text: string) => string = (t) => t,
  ) {}

  push(line: string): void {
    if (this.lines.length >= MAX_QUEUED_LINES) {
      this.lines.shift();
      this.dropped++;
    }
    this.lines.push(line.slice(0, 400));
    this.timer ??= setTimeout(() => void this.flush(), 400);
    this.timer.unref();
  }

  /** Sends one message's worth now, and schedules the rest after the pause Discord's limits need. */
  async flush(): Promise<void> {
    this.timer = undefined;
    if (this.lines.length === 0 && this.dropped === 0) return;
    const parts: string[] = [];
    let size = 0;
    if (this.dropped) {
      parts.push(`… ${this.dropped} earlier line${this.dropped === 1 ? '' : 's'} skipped`);
      this.dropped = 0;
    }
    while (this.lines.length && size + this.lines[0]!.length + 1 < MAX_MESSAGE_CHARS - 20) {
      const line = this.lines.shift()!;
      parts.push(line);
      size += line.length + 1;
    }
    try {
      await this.send(this.wrap(parts.join('\n')));
    } catch {
      // Discord is unreachable or the bot lost access; those lines are dropped rather than retried forever.
    }
    if (this.lines.length) {
      this.timer = setTimeout(() => void this.flush(), POST_INTERVAL_MS);
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.lines = [];
    this.dropped = 0;
  }
}

/**
 * The optional Discord bot. Discord sends slash commands to the panel as signed
 * HTTPS requests (no gateway connection, so no extra dependency), and the bot
 * posts events to channels through Discord's REST API. Each Discord user is
 * matched to a panel user by their Discord ID and can do only what that
 * user's role allows in the web panel. Nothing runs until an owner enables it.
 */
export class DiscordBotService {
  private apiBase: string | undefined;
  private recent = new Map<string, number[]>();
  private pending = new Set<Promise<unknown>>();
  private events: ChannelQueue | undefined;
  private logs: ChannelQueue | undefined;
  private queueKey = '';
  private serverTimer: NodeJS.Timeout | undefined;
  private lastState: 'online' | 'offline' | undefined;
  private offlineStreak = 0;
  private syncing = new Set<string>();
  private syncQueue = new Set<string>();
  private syncRunning: Promise<void> | undefined;
  /** Discord events the bot caused itself and is waiting to see come back, so they aren't acted on twice. */
  private expected = new Map<string, number>();
  /** Discord IDs the bot is acting on right now, so the matching game-side change isn't carried back. */
  private inFlight = new Set<string>();
  private gateway: DiscordGateway | undefined;
  private gatewayKey = '';
  private gatewayUrl: string | undefined;
  /** What the bot shows as its status. */
  private server: { state: 'online' | 'offline' | 'restarting' | 'unknown'; players: number; max: number } = { state: 'unknown', players: 0, max: 0 };
  /** Set when a shutdown starts; cleared once the server has gone down and come back, or after a while. */
  private restarting: { since: number; sawOffline: boolean } | undefined;

  constructor(
    private readonly db: DB,
    private readonly secrets: SecretBox,
    private readonly config: Config,
    private readonly deps: {
      users: UserService;
      palworld: PalworldService;
      players: PlayerDirectory;
      moderation: ModerationService;
      audit: AuditLog;
      world: WorldService;
      console: ConsoleService;
      siteAccounts: SiteAccountService;
    },
  ) {
    deps.audit.onRecord((actor, entry) => this.onAudit(actor, entry));
    deps.world.onSignal((s) => this.notify('notify_signals', `⚠️ Signal for **${escapeMd(s.playerName)}**: ${escapeMd(s.summary)}`));
    deps.players.onPresence(({ joined, left }) => {
      for (const n of joined) this.notify('notify_joins', `${escapeMd(n)} joined`);
      for (const n of left) this.notify('notify_joins', `${escapeMd(n)} left`);
    });
    deps.console.subscribe((lines) => this.forwardLogs(lines));
    deps.siteAccounts.onLinkChange((e) => this.queueSync(e.account.discord.id));
    deps.users.onDiscordChange((ids) => ids.forEach((id) => this.queueSync(id)));
    deps.moderation.onBan((e) => void this.onGameBan(e));
    deps.moderation.onUnban((e) => void this.onGameUnban(e));
  }

  /** Test hook: point at a fake Discord. */
  setApiBase(base: string | undefined, gatewayUrl?: string): void {
    this.apiBase = base;
    this.gatewayUrl = gatewayUrl;
  }

  // ---- Settings ----

  private row(): Row | undefined {
    return this.db.prepare('SELECT * FROM discord_bot WHERE id = 1').get() as Row | undefined;
  }

  settings(): DiscordBotSettings {
    const r = this.row();
    return {
      enabled: r?.enabled === 1,
      // The panel's Discord sign-in app is usually the bot's application too.
      applicationId: r?.application_id ?? this.config.discord?.clientId ?? null,
      publicKey: r?.public_key ?? null,
      hasToken: !!r?.bot_token_encrypted,
      guildId: r?.guild_id ?? null,
      publicInfo: r?.public_info === 1,
      eventsChannelId: r?.events_channel_id ?? null,
      logChannelId: r?.log_channel_id ?? null,
      logMinLevel: r?.log_min_level ?? 'error',
      notifyBans: (r?.notify_bans ?? 1) === 1,
      notifySignals: (r?.notify_signals ?? 1) === 1,
      notifyServer: (r?.notify_server ?? 1) === 1,
      notifyJoins: r?.notify_joins === 1,
      gatewayEnabled: (r?.gateway_enabled ?? 1) === 1,
      presenceEnabled: (r?.presence_enabled ?? 1) === 1,
      statusChannelId: r?.status_channel_id ?? null,
      joinOnLogin: r?.join_on_login === 1,
      verifiedRoleId: r?.verified_role_id ?? null,
      roleOwnerId: r?.role_owner_id ?? null,
      roleAdminId: r?.role_admin_id ?? null,
      roleModeratorId: r?.role_moderator_id ?? null,
      syncNicknames: r?.sync_nicknames === 1,
      syncBans: r?.sync_bans === 1,
      commandsRegisteredAt: r?.commands_registered_at ?? null,
      updatedAt: r?.updated_at ?? null,
    };
  }

  save(input: DiscordBotInput): DiscordBotSettings {
    const existing = this.row();
    const ids: Array<[string, string | null]> = [['Application ID', input.applicationId], ['Server ID', input.guildId], ['Events channel ID', input.eventsChannelId], ['Log channel ID', input.logChannelId], ['Status channel ID', input.statusChannelId], ['Verified role ID', input.verifiedRoleId], ['Owner role ID', input.roleOwnerId], ['Admin role ID', input.roleAdminId], ['Moderator role ID', input.roleModeratorId]];
    for (const [label, value] of ids) if (value && !SNOWFLAKE.test(value)) throw badRequest(`${label} should be the long number from Discord (Developer Mode → Copy ID)`, 'invalid_id');
    if (input.publicKey && !/^[0-9a-f]{64}$/i.test(input.publicKey)) throw badRequest('The public key is 64 hexadecimal characters, from the Developer Portal’s General Information page', 'invalid_public_key');
    if (input.enabled) {
      const missing = [
        !input.applicationId && 'Application ID',
        !input.publicKey && 'public key',
        !input.botToken && !existing?.bot_token_encrypted && 'bot token',
        !input.guildId && 'Server ID',
      ].filter(Boolean);
      if (missing.length) throw badRequest(`To switch the bot on, enter the ${missing.join(', ')}`, 'incomplete');
    }
    this.db
      .prepare(
        `INSERT INTO discord_bot (id, enabled, application_id, public_key, bot_token_encrypted, guild_id, public_info, events_channel_id, log_channel_id, log_min_level,
           notify_bans, notify_signals, notify_server, notify_joins, gateway_enabled, presence_enabled, status_channel_id,
           join_on_login, verified_role_id, role_owner_id, role_admin_id, role_moderator_id, sync_nicknames, sync_bans)
         VALUES (1, @enabled, @app, @key, @token, @guild, @pub, @events, @logs, @level, @bans, @signals, @server, @joins, @gateway, @presence, @statusChannel,
           @joinLogin, @verifiedRole, @roleOwner, @roleAdmin, @roleMod, @nicks, @syncBans)
         ON CONFLICT (id) DO UPDATE SET enabled = @enabled, application_id = @app, public_key = @key, bot_token_encrypted = COALESCE(@token, bot_token_encrypted),
           guild_id = @guild, public_info = @pub, events_channel_id = @events, log_channel_id = @logs, log_min_level = @level,
           notify_bans = @bans, notify_signals = @signals, notify_server = @server, notify_joins = @joins,
           gateway_enabled = @gateway, presence_enabled = @presence, status_channel_id = @statusChannel,
           join_on_login = @joinLogin, verified_role_id = @verifiedRole, role_owner_id = @roleOwner, role_admin_id = @roleAdmin, role_moderator_id = @roleMod,
           sync_nicknames = @nicks, sync_bans = @syncBans,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run({
        enabled: input.enabled ? 1 : 0,
        app: input.applicationId || null,
        key: input.publicKey?.toLowerCase() || null,
        token: input.botToken ? this.secrets.encrypt(input.botToken) : null,
        guild: input.guildId || null,
        pub: input.publicInfo ? 1 : 0,
        events: input.eventsChannelId || null,
        logs: input.logChannelId || null,
        level: input.logMinLevel,
        bans: input.notifyBans ? 1 : 0,
        signals: input.notifySignals ? 1 : 0,
        server: input.notifyServer ? 1 : 0,
        joins: input.notifyJoins ? 1 : 0,
        gateway: input.gatewayEnabled ? 1 : 0,
        presence: input.presenceEnabled ? 1 : 0,
        statusChannel: input.statusChannelId || null,
        joinLogin: input.joinOnLogin ? 1 : 0,
        verifiedRole: input.verifiedRoleId || null,
        roleOwner: input.roleOwnerId || null,
        roleAdmin: input.roleAdminId || null,
        roleMod: input.roleModeratorId || null,
        nicks: input.syncNicknames ? 1 : 0,
        syncBans: input.syncBans ? 1 : 0,
      });
    this.queueKey = '';
    this.lastState = undefined;
    this.applyGateway();
    return this.settings();
  }

  private token(): string | null {
    const r = this.row();
    return r?.bot_token_encrypted ? this.secrets.decrypt(r.bot_token_encrypted) : null;
  }

  private api(): DiscordApi | null {
    const t = this.token();
    return t ? new DiscordApi(t, this.apiBase) : null;
  }

  /** Whether commands and notifications are live. */
  get active(): boolean {
    const s = this.settings();
    return s.enabled && s.hasToken && !!s.guildId && !!s.applicationId;
  }

  // ---- Checks and command registration (owner tools) ----

  async check(input: { botToken?: string; guildId: string | null; eventsChannelId: string | null; logChannelId: string | null; statusChannelId?: string | null }): Promise<BotCheck[]> {
    const token = input.botToken || this.token();
    if (!token) return [{ name: 'Bot token', ok: false, message: 'Enter the bot token' }];
    const api = new DiscordApi(token, this.apiBase);
    const checks: BotCheck[] = [];
    const run = async (name: string, fn: () => Promise<string | null>) => {
      try {
        checks.push({ name, ok: true, message: await fn() });
      } catch (err) {
        checks.push({ name, ok: false, message: err instanceof DiscordApiError ? err.message : 'Failed' });
      }
    };
    await run('Bot token', async () => `Signed in as ${(await api.me()).username}`);
    if (input.guildId) await run('Server', async () => (await api.guild(input.guildId!)).name);
    if (input.eventsChannelId) await run('Events channel', async () => `#${(await api.channel(input.eventsChannelId!)).name ?? 'channel'}`);
    if (input.logChannelId) await run('Log channel', async () => `#${(await api.channel(input.logChannelId!)).name ?? 'channel'}`);
    if (input.statusChannelId) await run('Status channel', async () => `#${(await api.channel(input.statusChannelId!)).name ?? 'channel'} (the bot needs Manage Channels to rename it)`);
    return checks;
  }

  /** Puts the slash commands on the configured server. */
  async registerCommands(): Promise<number> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.applicationId || !s.guildId) throw badRequest('Save the application ID, bot token and server ID first', 'incomplete');
    await api.registerGuildCommands(s.applicationId, s.guildId, COMMANDS);
    this.db.prepare(`UPDATE discord_bot SET commands_registered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1`).run();
    return COMMANDS.length;
  }

  async sendTest(): Promise<void> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.eventsChannelId) throw badRequest('Save an events channel first', 'incomplete');
    await api.postMessage(s.eventsChannelId, 'PalOps is connected to this channel.');
  }

  // ---- Roles, nicknames and joining the server ----

  /** Whether players are added to the Discord server when they sign in on the website. */
  get joinOnLoginActive(): boolean {
    return this.active && this.settings().joinOnLogin;
  }

  private managedRoles(s: DiscordBotSettings): string[] {
    return [s.verifiedRoleId, s.roleOwnerId, s.roleAdminId, s.roleModeratorId].filter((r): r is string => !!r);
  }

  /** The roles and nickname a Discord user should have: from their verified link, and from their panel role. */
  private desired(discordId: string, s: DiscordBotSettings): { roles: string[]; nick: string | null } {
    const roles: string[] = [];
    const player = this.deps.siteAccounts.verifiedPlayerOf(discordId);
    if (player && s.verifiedRoleId) roles.push(s.verifiedRoleId);
    const user = this.deps.users.findByDiscordId(discordId);
    if (user && !user.disabled) {
      const staff = ({ owner: s.roleOwnerId, admin: s.roleAdminId, moderator: s.roleModeratorId } as Record<string, string | null>)[user.role];
      if (staff) roles.push(staff);
    }
    return { roles, nick: s.syncNicknames && player ? player.name.slice(0, 32) : null };
  }

  /** Adds someone to the server with the access token from their sign-in. It's used once and never kept. */
  async addToGuild(discordId: string, accessToken: string): Promise<void> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.guildId) return;
    const want = this.desired(discordId, s);
    await api.addMember(s.guildId, discordId, { access_token: accessToken, ...(want.nick ? { nick: want.nick } : {}), ...(want.roles.length ? { roles: want.roles } : {}) });
    // Someone already in the server isn't changed by the call above, so make sure their roles are right.
    this.queueSync(discordId);
  }

  /** Brings one member's managed roles (and nickname) in line with their link and panel role. Other roles are left alone. */
  async syncMember(discordId: string): Promise<'synced' | 'not_in_server'> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.guildId) throw badRequest('Save the bot token and server ID first', 'incomplete');
    const member = await api.member(s.guildId, discordId);
    if (!member) return 'not_in_server';
    const want = this.desired(discordId, s);
    for (const role of this.managedRoles(s)) {
      const has = member.roles.includes(role);
      const should = want.roles.includes(role);
      if (should && !has) await api.addRole(s.guildId, discordId, role, 'PalOps: role sync');
      if (!should && has) await api.removeRole(s.guildId, discordId, role, 'PalOps: role sync');
    }
    if (want.nick && member.nick !== want.nick) await api.setNickname(s.guildId, discordId, want.nick, 'PalOps: character name');
    return 'synced';
  }

  /** Syncs everyone who has a link or a panel role. Slow on purpose, to stay inside Discord's rate limits. */
  async syncAll(): Promise<{ checked: number; synced: number; notInServer: number; failed: number }> {
    if (!this.active) throw badRequest('Switch the bot on first', 'incomplete');
    const ids = new Set<string>([...this.deps.siteAccounts.all().map((a) => a.discord.id), ...this.deps.users.list().flatMap((u) => (u.discord ? [u.discord.id] : []))]);
    const result = { checked: ids.size, synced: 0, notInServer: 0, failed: 0 };
    for (const id of ids) {
      try {
        if ((await this.syncMember(id)) === 'synced') result.synced++;
        else result.notInServer++;
      } catch {
        result.failed++;
      }
      await this.pause();
    }
    return result;
  }

  private pause(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.config.env === 'test' ? 0 : 250));
  }

  /** Syncs a member soon, one at a time, so a burst of changes doesn't hammer Discord. */
  private queueSync(discordId: string): void {
    if (!this.active) return;
    this.syncQueue.add(discordId);
    if (this.syncRunning) return;
    const run = (async () => {
      await Promise.resolve();
      while (this.syncQueue.size) {
        const id = this.syncQueue.values().next().value as string;
        this.syncQueue.delete(id);
        try {
          await this.syncMember(id);
        } catch {
          // Not in the server, or the bot lacks Manage Roles; the settings page's checks explain it.
        }
        await this.pause();
      }
    })().finally(() => {
      this.syncRunning = undefined;
      this.pending.delete(run);
    });
    this.syncRunning = run;
    this.pending.add(run);
  }

  // ---- Keeping bans in step (verified links only) ----

  private get syncBansActive(): boolean {
    return this.active && this.settings().syncBans;
  }

  /** The bot is about to ban or unban this user on Discord; Discord will send an event back, which should be ignored once. */
  private expect(discordId: string, kind: 'add' | 'remove'): void {
    this.expected.set(`${discordId}:${kind}`, Date.now() + 30_000);
  }

  private consumeExpected(discordId: string, kind: 'add' | 'remove'): boolean {
    const now = Date.now();
    for (const [key, until] of this.expected) if (until <= now) this.expected.delete(key);
    return this.expected.delete(`${discordId}:${kind}`);
  }

  /** Runs an action while the game-side listeners are told to leave this Discord user alone. */
  private async acting<T>(discordId: string, fn: () => Promise<T>): Promise<T> {
    this.inFlight.add(discordId);
    try {
      return await fn();
    } finally {
      this.inFlight.delete(discordId);
    }
  }

  /** A player was banned in game (by staff, the bot or address enforcement): ban their verified Discord account too. */
  private async onGameBan(e: { userId: string; name: string | null; reason: string }): Promise<void> {
    if (!this.syncBansActive) return;
    const account = this.deps.siteAccounts.byPlayerUserId(e.userId, true);
    const s = this.settings();
    const api = this.api();
    if (!account || !api || !s.guildId) return;
    const id = account.discord.id;
    if (this.inFlight.has(id)) return;
    const who = escapeMd(account.discord.username ?? id);
    if (this.deps.users.findByDiscordId(id)) {
      this.notify('notify_bans', `ℹ️ ${who} is a panel user, so they were not banned from Discord along with ${escapeMd(e.name ?? e.userId)}.`);
      return;
    }
    this.expect(id, 'add');
    try {
      await api.banMember(s.guildId, id, `Banned in game${e.reason ? `: ${e.reason}` : ''}`.slice(0, 200));
      this.notify('notify_bans', `🔨 Also banned ${who} from Discord (linked to ${escapeMd(e.name ?? e.userId)}).`);
    } catch (err) {
      this.notify('notify_bans', `⚠️ Couldn't ban ${who} from Discord: ${escapeMd(err instanceof DiscordApiError ? err.message : 'unknown error')}`);
    }
  }

  private async onGameUnban(e: { userId: string; name: string | null }): Promise<void> {
    if (!this.syncBansActive) return;
    const account = this.deps.siteAccounts.byPlayerUserId(e.userId, true);
    const s = this.settings();
    const api = this.api();
    if (!account || !api || !s.guildId) return;
    const id = account.discord.id;
    if (this.inFlight.has(id)) return;
    this.expect(id, 'remove');
    try {
      await api.unbanMember(s.guildId, id, 'Unbanned in game');
      this.notify('notify_bans', `♻️ Also unbanned ${escapeMd(account.discord.username ?? id)} on Discord.`);
    } catch {
      // Not banned there, or no permission.
    }
  }

  /** Someone was banned or unbanned on Discord directly: do the same to their verified character. */
  private async onDiscordBan(d: { guild_id: string; user: { id: string } }, added: boolean): Promise<void> {
    const s = this.settings();
    if (!this.syncBansActive || d.guild_id !== s.guildId) return;
    const id = d.user?.id;
    if (!id || this.consumeExpected(id, added ? 'add' : 'remove')) return;
    const player = this.deps.siteAccounts.verifiedPlayerOf(id);
    if (!player) return;
    const actor: AuditActor = { userId: null, username: 'Discord ban sync' };
    try {
      await this.acting(id, async () => {
        if (added && !this.deps.moderation.isBanned(player.userId)) await this.deps.moderation.ban(actor, player.userId, 'Banned from the Discord server');
        else if (!added && this.deps.moderation.isBanned(player.userId)) await this.deps.moderation.unban(actor, player.userId, 'Unbanned from the Discord server');
      });
    } catch (err) {
      this.notify('notify_bans', `⚠️ Couldn't ${added ? 'ban' : 'unban'} ${escapeMd(player.name)} in game after a Discord ${added ? 'ban' : 'unban'}: ${escapeMd(err instanceof Error ? err.message : 'unknown error')}`);
    }
  }

  // ---- Interactions ----

  publicKey(): string | null {
    return this.row()?.public_key ?? null;
  }

  /**
   * Answers a verified interaction. Commands get an immediate "thinking…" reply
   * and the real answer follows, so a slow Palworld server never breaks Discord's
   * three-second limit.
   */
  handleInteraction(i: Interaction): { type: number; data?: unknown } {
    if (i.type === InteractionType.Ping) return { type: ResponseType.Pong };
    const s = this.settings();
    if (i.type === InteractionType.Autocomplete) return { type: ResponseType.Autocomplete, data: { choices: this.active && i.guild_id === s.guildId ? this.autocomplete(i, s) : [] } };
    if (i.type !== InteractionType.Command) return { type: ResponseType.Message, data: { content: 'That isn’t supported.', flags: EPHEMERAL } };
    const name = i.data?.name ?? '';
    const isPublic = s.publicInfo && PUBLIC_COMMANDS.has(name);
    const flags = isPublic ? 0 : EPHEMERAL;
    if (!this.active) return { type: ResponseType.Message, data: { content: 'The PalOps bot is switched off.', flags: EPHEMERAL } };
    if (i.guild_id !== s.guildId) return { type: ResponseType.Message, data: { content: 'This bot only works in its own server.', flags: EPHEMERAL } };
    const discordId = i.member?.user?.id ?? i.user?.id ?? '';
    if (this.rateLimited(discordId)) return { type: ResponseType.Message, data: { content: 'Slow down a little and try again.', flags: EPHEMERAL } };
    const task = this.run(i, name, discordId, isPublic)
      .catch((err) => explain(err))
      .then((content) => this.api()?.editOriginal(i.application_id, i.token, content))
      .catch(() => undefined)
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    return { type: ResponseType.Deferred, data: { flags } };
  }

  /** For tests: wait for command replies still being sent. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private rateLimited(discordId: string): boolean {
    const now = Date.now();
    const hits = (this.recent.get(discordId) ?? []).filter((t) => now - t < WINDOW_MS);
    hits.push(now);
    this.recent.set(discordId, hits);
    if (this.recent.size > 500) for (const [k, v] of this.recent) if (v.every((t) => now - t >= WINDOW_MS)) this.recent.delete(k);
    return hits.length > MAX_PER_WINDOW;
  }

  private linkedUser(discordId: string): User | undefined {
    const user = this.deps.users.findByDiscordId(discordId);
    return user && !user.disabled ? user : undefined;
  }

  private allowed(user: User | undefined, command: string, isPublic: boolean): boolean {
    if (isPublic) return true;
    const needs = COMMAND_PERMISSION[command];
    return !!user && !!needs && hasPermission(user.role, needs);
  }

  private async run(i: Interaction, command: string, discordId: string, isPublic: boolean): Promise<string> {
    const user = this.linkedUser(discordId);
    if (!COMMAND_PERMISSION[command]) throw new CommandError('I don’t know that command.');
    if (!user && !isPublic) {
      throw new CommandError('Your Discord account isn’t linked to a PalOps user. Ask an owner to add your Discord ID in the panel’s Settings → Users.');
    }
    if (!this.allowed(user, command, isPublic)) throw new CommandError(`Your PalOps role (${user?.role}) isn’t allowed to use /${command}.`);
    const options = new Map((i.data?.options ?? []).map((o) => [o.name, o.value]));
    const text = (key: string) => (typeof options.get(key) === 'string' ? (options.get(key) as string).trim() : '');
    // Attributed to the panel user, so the audit log shows who did it and that it came from Discord.
    const actor: AuditActor = { userId: user?.id ?? null, username: user ? `${user.username} (via Discord)` : null };

    switch (command) {
      case 'status':
        return this.status();
      case 'players':
        return this.onlinePlayers();
      case 'player':
        return this.lookup(this.resolve(text('player')));
      case 'kick': {
        const { game, member } = this.targets(i, options, text('player'), false);
        if (!game) throw new CommandError(`${escapeMd(member?.name ?? 'That member')} has no verified character linked, so I don’t know who to kick in game.`);
        await this.deps.moderation.kick(actor, game.userId, text('reason'));
        return `Kicked **${escapeMd(game.name)}**.`;
      }
      case 'ban': {
        const { game, member } = this.targets(i, options, text('player'), true);
        const banIp = options.get('ban_ip') === true;
        if (banIp && !hasPermission(user!.role, 'world.view')) throw new CommandError('Banning an address needs a role that can see player addresses.');
        const lines: string[] = [];
        if (member) {
          this.guardMemberAction(user!, member.id);
          await this.banOnDiscord(member.id, text('reason'));
          lines.push(`Banned **${escapeMd(member.name)}** from Discord.`);
        }
        if (game) {
          const result = await this.acting(member?.id ?? '', () => this.deps.moderation.ban(actor, game.userId, text('reason'), { banIp }));
          lines.push(`Banned **${escapeMd(game.name)}** in game.`);
          if (result.ipBan) lines.push(`Also banned the address ${result.ipBan.ip}.`);
          if (result.ipSkipped) lines.push(result.ipSkipped);
          if (!member && this.syncBansActive && this.deps.siteAccounts.byPlayerUserId(game.userId, true)) lines.push('Their linked Discord account is being banned too.');
        } else if (member) {
          lines.push('They have no verified character linked, so nothing was banned in game.');
        }
        return lines.join(' ');
      }
      case 'unban': {
        const { game, member } = this.targets(i, options, text('player'), true);
        const lines: string[] = [];
        if (member) {
          await this.unbanOnDiscord(member.id, text('reason'));
          lines.push(`Unbanned **${escapeMd(member.name)}** on Discord.`);
        }
        if (game) {
          await this.acting(member?.id ?? '', () => this.deps.moderation.unban(actor, game.userId, text('reason')));
          lines.push(`Unbanned **${escapeMd(game.name)}** in game.`);
        }
        return lines.join(' ');
      }
      case 'announce': {
        const message = text('message');
        if (!message) throw new CommandError('Say what to announce.');
        await this.deps.palworld.announce(message);
        this.deps.audit.record(actor, { category: 'server', action: 'broadcast', details: { message } });
        return 'Announced to everyone on the server.';
      }
      case 'save':
        await this.deps.palworld.save();
        this.deps.audit.record(actor, { category: 'server', action: 'world_saved' });
        return 'Saving the world.';
      default:
        throw new CommandError('I don’t know that command.');
    }
  }

  /** A player from what was typed or picked: an exact platform ID, or a name that matches one known player. */
  private resolve(query: string, allowUnknownId = false): { userId: string; name: string } {
    if (!query) throw new CommandError('Say which player.');
    const found = this.deps.players.find(query);
    if (found.length === 1) return { userId: found[0]!.userId, name: found[0]!.name };
    if (found.length > 1) throw new CommandError(`More than one player matches “${escapeMd(query)}”. Pick from the list, or use their platform ID.`);
    if (allowUnknownId && /^[A-Za-z0-9_.:-]{1,80}$/.test(query) && /_/.test(query)) return { userId: query, name: query };
    throw new CommandError(`I haven't seen a player called “${escapeMd(query)}”.`);
  }

  /** Who a moderation command is about: a player, a Discord member, or both. A member's character comes from their verified link only. */
  private targets(
    i: Interaction,
    options: Map<string, string | number | boolean | undefined>,
    typedPlayer: string,
    allowUnknownId: boolean,
  ): { game?: { userId: string; name: string }; member?: { id: string; name: string } } {
    const memberId = typeof options.get('member') === 'string' ? String(options.get('member')) : '';
    const resolvedUser = memberId ? i.data?.resolved?.users?.[memberId] : undefined;
    const member = memberId ? { id: memberId, name: resolvedUser?.global_name || resolvedUser?.username || memberId } : undefined;
    let game = typedPlayer ? this.resolve(typedPlayer, allowUnknownId) : undefined;
    if (member && !game) {
      const linked = this.deps.siteAccounts.verifiedPlayerOf(member.id);
      if (linked) game = { userId: linked.userId, name: linked.name };
    }
    if (!game && !member) throw new CommandError('Say which player, or pick a Discord member.');
    return { game, member };
  }

  /** Nobody can be Discord-banned through the bot by someone of equal or lower panel rank, and nobody bans themselves or the bot. */
  private guardMemberAction(caller: User, targetDiscordId: string): void {
    if (targetDiscordId === caller.discord?.id) throw new CommandError('You can’t do that to yourself.');
    if (targetDiscordId === this.gatewayStatus().botUserId) throw new CommandError('I can’t do that to myself.');
    const rank: Record<string, number> = { owner: 3, admin: 2, moderator: 1, viewer: 0 };
    const target = this.deps.users.findByDiscordId(targetDiscordId);
    if (target && rank[target.role]! >= rank[caller.role]!) throw new CommandError('That member is a panel user with the same or a higher role than yours, so I won’t ban them from Discord.');
  }

  private async banOnDiscord(discordId: string, reason: string): Promise<void> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.guildId) throw new CommandError('The bot isn’t fully set up.');
    this.expect(discordId, 'add');
    await api.banMember(s.guildId, discordId, `PalOps: ${reason || 'banned'}`.slice(0, 200));
  }

  private async unbanOnDiscord(discordId: string, reason: string): Promise<void> {
    const s = this.settings();
    const api = this.api();
    if (!api || !s.guildId) throw new CommandError('The bot isn’t fully set up.');
    this.expect(discordId, 'remove');
    await api.unbanMember(s.guildId, discordId, `PalOps: ${reason || 'unbanned'}`.slice(0, 200));
  }

  private async status(): Promise<string> {
    const status = await this.deps.palworld.getStatus({ fresh: true });
    if (status.state === 'unconfigured') throw new CommandError('No Palworld server is connected to PalOps yet.');
    if (status.state !== 'online' || !status.metrics) return `**${escapeMd(status.info?.name ?? status.connection?.name ?? 'Server')}** is **${status.state}**.`;
    const m = status.metrics;
    return [
      `**${escapeMd(status.info?.name ?? 'Server')}** is **online**`,
      `Players: ${m.currentPlayers}/${m.maxPlayers} · FPS: ${Math.round(m.fps)} · Uptime: ${duration(m.uptimeSeconds)}`,
      status.info?.version ? `Version: ${escapeMd(status.info.version)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async onlinePlayers(): Promise<string> {
    const players = await this.deps.players.refreshOnline();
    if (players.length === 0) return 'Nobody is online right now.';
    const lines = players.slice(0, 40).map((p) => `• **${escapeMd(p.name)}**${p.level ? ` · level ${p.level}` : ''}`);
    return [`**${players.length} online**`, ...lines, players.length > 40 ? `…and ${players.length - 40} more` : ''].filter(Boolean).join('\n');
  }

  private lookup(target: { userId: string }): string {
    const p: KnownPlayer | undefined = this.deps.players.byUserId(target.userId);
    if (!p) return `I haven't seen ${escapeMd(target.userId)} yet.`;
    const banned = this.deps.moderation.isBanned(p.userId);
    return [
      `**${escapeMd(p.name)}**${p.online ? ' · online' : ''}${banned ? ' · banned' : ''}`,
      `Level ${p.level ?? '?'} · ${p.guild ? `guild ${escapeMd(p.guild)}` : 'no guild'}`,
      `First seen ${p.firstSeenAt.slice(0, 10)} · last seen ${p.lastSeenAt.slice(0, 16).replace('T', ' ')} UTC`,
      `Platform ID: \`${p.userId}\``,
    ].join('\n');
  }

  private autocomplete(i: Interaction, s: DiscordBotSettings): Array<{ name: string; value: string }> {
    const focused = (i.data?.options ?? []).find((o: CommandOption) => o.focused);
    if (!focused || focused.name !== 'player') return [];
    const discordId = i.member?.user?.id ?? i.user?.id ?? '';
    const command = i.data?.name ?? '';
    if (!this.allowed(this.linkedUser(discordId), command, s.publicInfo && PUBLIC_COMMANDS.has(command))) return [];
    const typed = String(focused.value ?? '').slice(0, 80);
    const { players } = this.deps.players.list({ search: typed, limit: 25, offset: 0 });
    return players.map((p) => ({ name: `${p.name} (${p.userId})`.slice(0, 100), value: p.userId }));
  }

  // ---- Notifications ----

  private queues(): { events?: ChannelQueue; logs?: ChannelQueue } {
    const s = this.settings();
    const key = `${s.enabled}|${s.hasToken}|${s.eventsChannelId}|${s.logChannelId}|${s.updatedAt}`;
    if (key !== this.queueKey) {
      this.events?.stop();
      this.logs?.stop();
      this.events = this.logs = undefined;
      this.queueKey = key;
      const api = s.enabled ? this.api() : null;
      if (api && s.eventsChannelId) this.events = new ChannelQueue((t) => api.postMessage(s.eventsChannelId!, t));
      if (api && s.logChannelId) this.logs = new ChannelQueue((t) => api.postMessage(s.logChannelId!, t), (t) => `\`\`\`\n${fence(t)}\n\`\`\``);
    }
    return { events: this.events, logs: this.logs };
  }

  private notify(flag: 'notify_bans' | 'notify_signals' | 'notify_server' | 'notify_joins', text: string): void {
    const r = this.row();
    if (!r || r[flag] !== 1) return;
    this.queues().events?.push(text);
  }

  private onAudit(actor: AuditActor, entry: { category: string; action: string; target?: string }): void {
    if (entry.category === 'server' && (entry.action === 'shutdown' || entry.action === 'force_stop') && this.active) {
      this.markRestarting();
      this.notify('notify_server', '🟠 The server is shutting down or restarting.');
      return;
    }
    if (entry.category !== 'players') return;
    const who = escapeMd(actor.username ?? 'system');
    const target = entry.target ? escapeMd(entry.target) : 'a player';
    const verbs: Record<string, string> = { ban: 'banned', unban: 'unbanned', kick: 'kicked', ip_ban: 'banned the address', ip_unban: 'unbanned the address' };
    const verb = verbs[entry.action];
    if (verb) this.notify('notify_bans', `🔨 **${who}** ${verb} ${target}`);
  }

  private forwardLogs(lines: ConsoleLine[]): void {
    const r = this.row();
    if (!r || r.enabled !== 1 || !r.log_channel_id) return;
    const rank: Record<ConsoleLevel, number> = { info: 0, warn: 1, error: 2 };
    const queue = this.queues().logs;
    if (!queue) return;
    // Panel events already go to the events channel; this is the game's and PalDefender's own output.
    for (const l of lines) if (l.source !== 'panel' && rank[l.level] >= rank[r.log_min_level]) queue.push(l.message);
  }

  /** Starts the periodic server check and the gateway connection. */
  start(): void {
    this.serverTimer ??= setInterval(() => void this.checkServer(), 30_000);
    this.serverTimer.unref();
    this.applyGateway();
  }

  stop(): void {
    if (this.serverTimer) clearInterval(this.serverTimer);
    this.serverTimer = undefined;
    this.events?.stop();
    this.logs?.stop();
    this.gateway?.stop();
    this.gateway = undefined;
    this.gatewayKey = '';
  }

  // ---- The live connection and the bot's status ----

  gatewayStatus(): GatewayStatus {
    return this.gateway?.status() ?? { state: 'off', message: null, botUserId: null };
  }

  /** What the bot's status should say right now. Offline and restarting show "do not disturb". */
  presence(): Presence {
    const { state, players, max } = this.server;
    switch (state) {
      case 'online':
        return { status: 'online', activity: { name: `${players}/${max} players`, type: 3 } };
      case 'restarting':
        return { status: 'dnd', activity: { name: 'Server restarting', type: 3 } };
      case 'offline':
        return { status: 'dnd', activity: { name: 'Server offline', type: 3 } };
      default:
        return { status: 'idle', activity: { name: 'Checking the server…', type: 3 } };
    }
  }

  /** The intents the bot needs for what's switched on. Message content is privileged, so it's only asked for when something reads messages. */
  protected intents(): number {
    return Intents.Guilds | Intents.GuildModeration | Intents.GuildMessages;
  }

  /** Starts, restarts or stops the gateway to match the settings. Safe to call at any time. */
  private applyGateway(): void {
    const s = this.settings();
    // Tests only connect when they've pointed the bot at a fake gateway, never to the real one.
    const wanted = this.active && s.gatewayEnabled && (this.config.env !== 'test' || !!this.gatewayUrl);
    const key = wanted ? `${s.updatedAt}|${this.intents()}` : '';
    if (key === this.gatewayKey && (wanted === !!this.gateway)) return;
    this.gateway?.stop();
    this.gateway = undefined;
    this.gatewayKey = key;
    const token = wanted ? this.token() : null;
    if (!wanted || !token) return;
    this.gateway = new DiscordGateway({ token, intents: this.intents(), presence: () => (s.presenceEnabled ? this.presence() : { status: 'online', activity: null }), onDispatch: (event, data) => this.onGatewayEvent(event, data), url: this.gatewayUrl });
    this.gateway.start();
  }

  private onGatewayEvent(event: string, data: unknown): void {
    if (event === 'GUILD_BAN_ADD' || event === 'GUILD_BAN_REMOVE') {
      const task = this.onDiscordBan(data as { guild_id: string; user: { id: string } }, event === 'GUILD_BAN_ADD').finally(() => this.pending.delete(task));
      this.pending.add(task);
      return;
    }
    if (event === 'INTERACTION_CREATE') {
      const interaction = data as Interaction;
      const response = this.handleInteraction(interaction);
      const task = this.api()
        ?.interactionCallback(interaction.id, interaction.token, response)
        .catch(() => undefined)
        .finally(() => this.pending.delete(task!));
      if (task) this.pending.add(task);
    }
  }

  /** A shutdown or stop has been ordered: show "restarting" until the server has gone down and come back. */
  private markRestarting(): void {
    this.restarting = { since: Date.now(), sawOffline: false };
    this.server = { ...this.server, state: 'restarting' };
    this.pushStatus();
  }

  private pushStatus(): void {
    if (this.settings().presenceEnabled) this.gateway?.updatePresence();
    void this.updateStatusChannel();
  }

  /** e.g. "🟢 5/32 online". Discord limits renames to about twice per ten minutes per channel, so this waits at least six between changes. */
  private async updateStatusChannel(): Promise<void> {
    const r = this.row();
    const api = this.api();
    if (!r?.status_channel_id || !api || r.enabled !== 1) return;
    const { state, players, max } = this.server;
    const name = state === 'online' ? `🟢 ${players}/${max} online` : state === 'restarting' ? '🟠 restarting' : state === 'offline' ? '🔴 offline' : '⚪ checking';
    if (name === r.status_channel_name) return;
    const last = r.status_channel_changed_at ? Date.parse(r.status_channel_changed_at) : 0;
    if (Date.now() - last < 6 * 60 * 1000) return;
    try {
      await api.renameChannel(r.status_channel_id, name);
      this.db.prepare(`UPDATE discord_bot SET status_channel_name = ?, status_channel_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1`).run(name);
    } catch {
      // Missing permission or a rate limit; it tries again at the next change.
    }
  }

  /**
   * One look at the server. It has to be down twice running before it's announced,
   * so a blip stays quiet, and a shutdown ordered from PalOps shows as "restarting".
   */
  async checkServer(): Promise<void> {
    if (!this.active) return;
    let state: 'online' | 'offline';
    let players = 0;
    let max = 0;
    try {
      const s = await this.deps.palworld.getStatus({ fresh: true });
      if (s.state === 'unconfigured') {
        this.server = { state: 'unknown', players: 0, max: 0 };
        return;
      }
      state = s.state === 'online' ? 'online' : 'offline';
      players = s.metrics?.currentPlayers ?? 0;
      max = s.metrics?.maxPlayers ?? 0;
    } catch {
      state = 'offline';
    }
    this.offlineStreak = state === 'offline' ? this.offlineStreak + 1 : 0;

    if (this.restarting) {
      if (state === 'offline') this.restarting.sawOffline = true;
      if ((state === 'online' && this.restarting.sawOffline) || Date.now() - this.restarting.since > 20 * 60 * 1000) this.restarting = undefined;
    }
    const shown = this.restarting ? 'restarting' : state === 'offline' && this.offlineStreak < 2 && this.server.state === 'online' ? 'online' : state;
    const before = this.server;
    this.server = { state: shown, players, max };

    // Announce real changes. A planned restart was already announced when it was ordered.
    if (shown !== 'restarting' && (shown === 'online' || shown === 'offline')) {
      const announced = this.lastState;
      this.lastState = shown;
      if (announced && announced !== shown) this.notify('notify_server', shown === 'online' ? '🟢 The server is back online.' : '🔴 The server is offline.');
    }
    if (before.state !== this.server.state || before.players !== this.server.players || before.max !== this.server.max) this.pushStatus();
    // A rename that had to wait (Discord's rate limit) is retried on every check until the channel matches.
    else void this.updateStatusChannel();
  }
}

/** What to tell the user when a command fails. These errors are written to be shown to people. */
function explain(err: unknown): string {
  if (err instanceof CommandError || err instanceof HttpError || err instanceof DiscordApiError) return err.message;
  if (err instanceof PalworldError) return `The Palworld server said: ${err.message}`;
  return 'Something went wrong running that command.';
}

/** A command failed in a way the user should be told about, in plain words. */
class CommandError extends Error {}
