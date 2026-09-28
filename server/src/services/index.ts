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
import { PalworldService } from './palworld/index.js';
import { ModerationService } from './players/moderation.js';
import { PlayerDirectory } from './players/player-directory.js';
import { SiteAccountService } from './site/site-accounts.js';
import { ServerRegistry } from './servers/server-registry.js';

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
  siteAccounts: SiteAccountService;
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
    moderation: new ModerationService(db, palworld, players, servers, audit),
    siteAccounts: new SiteAccountService(db, config.sessionMaxMs),
  };
}
