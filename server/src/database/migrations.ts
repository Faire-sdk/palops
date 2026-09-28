/**
 * Ordered, append-only list of schema migrations. Never edit a migration that
 * has shipped; add a new one instead.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
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
];
