import type { Config } from '../config.js';
import type { DB } from '../database/db.js';
import { randomToken, SecretBox } from '../utils/crypto.js';
import { AuditLog } from './audit/audit-log.js';
import { PasswordResetService } from './authentication/password-resets.js';
import { SessionService } from './authentication/sessions.js';
import { UserService } from './authentication/users.js';
import { PalworldService } from './palworld/index.js';
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
  return {
    config,
    db,
    users,
    sessions: new SessionService(db, { idleMs: config.sessionIdleMs, maxMs: config.sessionMaxMs }),
    passwordResets: new PasswordResetService(db),
    audit: new AuditLog(db),
    servers,
    palworld: new PalworldService(servers),
    setup: new SetupGate(users, config.setupToken),
  };
}
