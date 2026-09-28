import { dirname, resolve } from 'node:path';
import type { Config } from '../config.js';
import type { DB } from '../database/db.js';
import { randomToken, SecretBox } from '../utils/crypto.js';
import { AuditLog } from './audit/audit-log.js';
import { PasswordResetService } from './authentication/password-resets.js';
import { SessionService } from './authentication/sessions.js';
import { UserService } from './authentication/users.js';
import { DiscordOAuthClient, type DiscordOAuthProvider } from './discord/oauth.js';
import { DevDiscordOAuth } from './discord/dev-oauth.js';
import { OAuthStateStore } from './discord/oauth-states.js';
import { PalBanService } from './palban/palban-service.js';
import { PalDefenderService } from './paldefender/paldefender-service.js';
import { PalworldService } from './palworld/index.js';
import { DiscordBotService } from './discord/discord-bot.js';
import { ConsoleService } from './console/console-service.js';
import { ModerationService } from './players/moderation.js';
import { PlayerDirectory } from './players/player-directory.js';
import { SiteAccountService } from './site/site-accounts.js';
import { ServerRegistry } from './servers/server-registry.js';
import { MapImageService } from './world/map-image.js';
import { WorldService } from './world/world-service.js';

export interface Services {
  config: Config;
  db: DB;
  users: UserService;
  sessions: SessionService;
  passwordResets: PasswordResetService;
  audit: AuditLog;
  servers: ServerRegistry;
  palworld: PalworldService;
  setup: SetupGate;
  /** Null when Discord sign-in isn't configured. */
  discordOAuth: DiscordOAuthProvider | null;
  oauthStates: OAuthStateStore;
  players: PlayerDirectory;
  moderation: ModerationService;
  /** Optional PalDefender plugin integration; does nothing until an owner enables it. */
  paldefender: PalDefenderService;
  /** Optional PalBan Network integration; does nothing until an owner enables it. */
  palban: PalBanService;
  /** The view-only console: tailed log files plus events the panel knows about. */
  console: ConsoleService;
  /** The optional Discord bot; does nothing until an owner enables it. */
  discordBot: DiscordBotService;
  siteAccounts: SiteAccountService;
  world: WorldService;
  mapImage: MapImageService;
}

/**
 * First-run setup: while the panel has no users, the owner account can be
 * created with a one-time token printed to the server log (or preset with
 * PANEL_SETUP_TOKEN). This stops a stranger from claiming a fresh install.
 */
export class SetupGate {
  private token: string | undefined;

  constructor(
    private readonly users: UserService,
    preset?: string,
  ) {
    if (users.count() === 0) this.token = preset ?? randomToken(18);
  }

  get required(): boolean {
    return this.users.count() === 0;
  }

  /** The token to print at startup, if setup is still pending. */
  get pendingToken(): string | undefined {
    return this.required ? this.token : undefined;
  }

  complete(): void {
    this.token = undefined;
  }
}

export function createServices(config: Config, db: DB): Services {
  const users = new UserService(db);
  const servers = new ServerRegistry(db, new SecretBox(config.secret, 'server-credentials'));
  const palworld = new PalworldService(servers);
  const audit = new AuditLog(db);
  const players = new PlayerDirectory(db, palworld, servers);
  const paldefender = new PalDefenderService(db, new SecretBox(config.secret, 'paldefender-token'), players, servers);
  const consoleLog = new ConsoleService(db, config.databasePath === ':memory:' ? [] : [dirname(resolve(config.databasePath))], new SecretBox(config.secret, 'console-logger-token'));
  const world = new WorldService(db, palworld, players, servers, audit);
  // Mirror what the panel knows into the console, so it's useful even before any log file is set up.
  audit.onRecord((actor, entry) => {
    if (entry.category === 'auth') return;
    consoleLog.add('panel', `${actor.username ?? 'system'}: ${entry.action.replace(/_/g, ' ')}${entry.target ? ` · ${entry.target}` : ''}`, 'info');
  });
  players.onPresence(({ joined, left }) => {
    for (const name of joined) consoleLog.add('panel', `${name} joined`, 'info');
    for (const name of left) consoleLog.add('panel', `${name} left`, 'info');
  });
  world.onSignal((s) => consoleLog.add('panel', `Signal for ${s.playerName}: ${s.summary}`, 'warn'));
  const moderation = new ModerationService(db, palworld, players, servers, audit, paldefender);
  const palban = new PalBanService(db, new SecretBox(config.secret, 'palban-key'), moderation, players, servers, audit);
  const siteAccounts = new SiteAccountService(db, config.sessionMaxMs);
  const discordBot = new DiscordBotService(db, new SecretBox(config.secret, 'discord-bot-token'), config, { users, palworld, players, moderation, audit, world, console: consoleLog, siteAccounts, paldefender, palban });
  return {
    config,
    db,
    users,
    sessions: new SessionService(db, { idleMs: config.sessionIdleMs, maxMs: config.sessionMaxMs }),
    passwordResets: new PasswordResetService(db),
    audit,
    servers,
    palworld,
    setup: new SetupGate(users, config.setupToken),
    discordOAuth: config.devDiscordLogin
      ? new DevDiscordOAuth()
      : config.discord
        ? new DiscordOAuthClient(config.discord)
        : null,
    oauthStates: new OAuthStateStore(),
    players,
    moderation,
    paldefender,
    palban,
    siteAccounts,
    world,
    console: consoleLog,
    discordBot,
    mapImage: new MapImageService(db, config.databasePath, audit),
  };
}
