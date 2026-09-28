/**
 * Ordered, append-only list of schema migrations. Never edit a migration that
 * has shipped; add a new one instead.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
  /** Run with foreign keys off, for SQLite table rebuilds (checked afterwards). */
  rebuildsTables?: boolean;
}

const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'moderator', 'viewer')),
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ${now},
        updated_at TEXT NOT NULL DEFAULT ${now},
        last_login_at TEXT
      );

      -- The session id is a SHA-256 of the cookie token, so a leaked database
      -- cannot be used to hijack sessions.
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT ${now},
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        expires_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      -- One-time password reset tokens (hashed). Issued by an owner today;
      -- an email/Discord delivery channel can be added later.
      CREATE TABLE password_resets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${now},
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      -- Append-only audit trail. Rows are never deleted by the application.
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT ${now},
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_username TEXT,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        ip TEXT
      );
      CREATE INDEX audit_log_created ON audit_log(created_at);
      CREATE INDEX audit_log_category ON audit_log(category, created_at);

      -- Palworld servers the panel manages. The MVP uses a single row, but the
      -- table keeps multi-server support a data change rather than a rewrite.
      CREATE TABLE servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        host TEXT NOT NULL DEFAULT '',
        port INTEGER NOT NULL DEFAULT 8212,
        username TEXT NOT NULL DEFAULT 'admin',
        password_encrypted TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        updated_at TEXT NOT NULL DEFAULT ${now}
      );
    `,
  },
  {
    id: 2,
    name: 'discord_accounts',
    rebuildsTables: true,
    // Discord becomes the primary sign-in: link users to a Discord account and
    // make the password optional. SQLite needs a table rebuild to drop NOT NULL.
    sql: `
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'moderator', 'viewer')),
        disabled INTEGER NOT NULL DEFAULT 0,
        discord_id TEXT UNIQUE,
        discord_username TEXT,
        discord_avatar TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        updated_at TEXT NOT NULL DEFAULT ${now},
        last_login_at TEXT
      );
      INSERT INTO users_new (id, username, password_hash, role, disabled, created_at, updated_at, last_login_at)
        SELECT id, username, password_hash, role, disabled, created_at, updated_at, last_login_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `,
  },
  {
    id: 3,
    name: 'players_and_site_accounts',
    sql: `
      -- Players the panel has seen on each server, recorded from the online
      -- player list. Only what the panel needs, not a copy of the save file.
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        player_id TEXT,
        name TEXT NOT NULL,
        account_name TEXT,
        level INTEGER,
        guild TEXT,
        first_seen_at TEXT NOT NULL DEFAULT ${now},
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        UNIQUE (server_id, user_id)
      );
      CREATE INDEX players_name ON players(server_id, name COLLATE NOCASE);

      -- Accounts for players on the public website (Discord sign-in). Kept
      -- apart from panel users so a player login can never reach the panel.
      CREATE TABLE site_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL UNIQUE,
        discord_username TEXT,
        discord_avatar TEXT,
        player_id INTEGER UNIQUE REFERENCES players(id) ON DELETE SET NULL,
        player_verified INTEGER NOT NULL DEFAULT 0,
        linked_at TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        last_login_at TEXT
      );

      CREATE TABLE site_sessions (
        id TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES site_accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT ${now},
        expires_at TEXT NOT NULL
      );
    `,
  },
];
