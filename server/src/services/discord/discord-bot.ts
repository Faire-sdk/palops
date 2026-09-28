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
import type { WorldService } from '../world/world-service.js';
import { DiscordApi, DiscordApiError } from './discord-api.js';
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
    },
  ) {
    deps.audit.onRecord((actor, entry) => this.onAudit(actor, entry));
    deps.world.onSignal((s) => this.notify('notify_signals', `⚠️ Signal for **${escapeMd(s.playerName)}**: ${escapeMd(s.summary)}`));
    deps.players.onPresence(({ joined, left }) => {
      for (const n of joined) this.notify('notify_joins', `${escapeMd(n)} joined`);
      for (const n of left) this.notify('notify_joins', `${escapeMd(n)} left`);
    });
    deps.console.subscribe((lines) => this.forwardLogs(lines));
  }

  /** Test hook: point at a fake Discord. */
  setApiBase(base: string | undefined): void {
    this.apiBase = base;
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
      commandsRegisteredAt: r?.commands_registered_at ?? null,
      updatedAt: r?.updated_at ?? null,
    };
  }

  save(input: DiscordBotInput): DiscordBotSettings {
    const existing = this.row();
    const ids: Array<[string, string | null]> = [['Application ID', input.applicationId], ['Server ID', input.guildId], ['Events channel ID', input.eventsChannelId], ['Log channel ID', input.logChannelId]];
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
           notify_bans, notify_signals, notify_server, notify_joins)
         VALUES (1, @enabled, @app, @key, @token, @guild, @pub, @events, @logs, @level, @bans, @signals, @server, @joins)
         ON CONFLICT (id) DO UPDATE SET enabled = @enabled, application_id = @app, public_key = @key, bot_token_encrypted = COALESCE(@token, bot_token_encrypted),
           guild_id = @guild, public_info = @pub, events_channel_id = @events, log_channel_id = @logs, log_min_level = @level,
           notify_bans = @bans, notify_signals = @signals, notify_server = @server, notify_joins = @joins,
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
      });
    this.queueKey = '';
    this.lastState = undefined;
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

  async check(input: { botToken?: string; guildId: string | null; eventsChannelId: string | null; logChannelId: string | null }): Promise<BotCheck[]> {
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
        const target = this.resolve(text('player'));
        await this.deps.moderation.kick(actor, target.userId, text('reason'));
        return `Kicked **${escapeMd(target.name)}**.`;
      }
      case 'ban': {
        const target = this.resolve(text('player'), true);
        const banIp = options.get('ban_ip') === true;
        if (banIp && !hasPermission(user!.role, 'world.view')) throw new CommandError('Banning an address needs a role that can see player addresses.');
        const result = await this.deps.moderation.ban(actor, target.userId, text('reason'), { banIp });
        return [`Banned **${escapeMd(target.name)}**.`, result.ipBan ? `Also banned the address ${result.ipBan.ip}.` : '', result.ipSkipped ?? ''].filter(Boolean).join(' ');
      }
      case 'unban': {
        const target = this.resolve(text('player'), true);
        await this.deps.moderation.unban(actor, target.userId, text('reason'));
        return `Unbanned **${escapeMd(target.name)}**.`;
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

  /** Starts the check that tells the events channel when the server goes down or comes back. */
  start(): void {
    this.serverTimer ??= setInterval(() => void this.checkServer(), 30_000);
    this.serverTimer.unref();
  }

  stop(): void {
    if (this.serverTimer) clearInterval(this.serverTimer);
    this.serverTimer = undefined;
    this.events?.stop();
    this.logs?.stop();
  }

  /** One look at the server. It has to be down twice running before it's announced, so a blip stays quiet. */
  async checkServer(): Promise<void> {
    if (!this.active) return;
    let state: 'online' | 'offline';
    try {
      const s = await this.deps.palworld.getStatus({ fresh: true });
      if (s.state === 'unconfigured') return;
      state = s.state === 'online' ? 'online' : 'offline';
    } catch {
      state = 'offline';
    }
    this.offlineStreak = state === 'offline' ? this.offlineStreak + 1 : 0;
    if (state === 'offline' && this.offlineStreak < 2) return;
    if (this.lastState && this.lastState !== state) this.notify('notify_server', state === 'online' ? '🟢 The server is back online.' : '🔴 The server is offline.');
    this.lastState = state;
  }
}

/** What to tell the user when a command fails. These errors are written to be shown to people. */
function explain(err: unknown): string {
  if (err instanceof CommandError || err instanceof HttpError) return err.message;
  if (err instanceof PalworldError) return `The Palworld server said: ${err.message}`;
  return 'Something went wrong running that command.';
}

/** A command failed in a way the user should be told about, in plain words. */
class CommandError extends Error {}
