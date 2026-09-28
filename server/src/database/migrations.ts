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
  {
    id: 4,
    name: 'moderation_actions',
    sql: `
      -- Kicks, bans, unbans and staff notes made through the panel. The REST
      -- API has no ban list, so this is the panel's record of who it banned.
      CREATE TABLE moderation_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        player_user_id TEXT NOT NULL,
        player_name TEXT,
        action TEXT NOT NULL CHECK (action IN ('kick', 'ban', 'unban', 'note')),
        reason TEXT,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        actor_username TEXT,
        created_at TEXT NOT NULL DEFAULT ${now}
      );
      CREATE INDEX moderation_player ON moderation_actions(server_id, player_user_id, id);
    `,
  },
  {
    id: 5,
    name: 'world_data',
    sql: `
      -- Filled from the REST API's world snapshot (game-data endpoint).
      ALTER TABLE players ADD COLUMN guild_id TEXT;

      CREATE TABLE guilds (
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT ${now},
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        PRIMARY KEY (server_id, guild_id)
      );

      -- Pal Boxes. The cell (position rounded to 5 m) keeps small float
      -- differences between snapshots from creating duplicates.
      CREATE TABLE bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        guild_id TEXT NOT NULL,
        cell TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT ${now},
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        UNIQUE (server_id, guild_id, cell)
      );

      -- Pals seen with an owner, so a profile can list them while the player is offline.
      CREATE TABLE world_pals (
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        instance_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        class_name TEXT,
        nickname TEXT,
        level INTEGER,
        unit_type TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        PRIMARY KEY (server_id, instance_id)
      );
      CREATE INDEX world_pals_owner ON world_pals(server_id, owner_user_id);

      -- Things worth a staff member's look: unusual movement, level jumps, shared addresses.
      CREATE TABLE player_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        player_name TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('movement', 'level', 'shared_ip')),
        summary TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        dismissed_at TEXT,
        dismissed_by TEXT
      );
      CREATE INDEX player_signals_open ON player_signals(server_id, dismissed_at, id);
      CREATE INDEX player_signals_player ON player_signals(server_id, user_id, id);
      CREATE INDEX player_signals_dedupe ON player_signals(server_id, dedupe_key, created_at);

      -- One row per snapshot: server FPS and the busiest map areas at that moment.
      CREATE TABLE world_perf (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        taken_at TEXT NOT NULL,
        fps REAL,
        actors INTEGER NOT NULL,
        players INTEGER NOT NULL,
        cells TEXT NOT NULL
      );
      CREATE INDEX world_perf_time ON world_perf(server_id, taken_at);
    `,
  },
  {
    id: 6,
    name: 'map_image',
    sql: `
      -- The owner-uploaded background for the live map (one per panel). The
      -- file lives next to the database; bounds are the image's edges in
      -- in-game map coordinates.
      CREATE TABLE map_image (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        left_x REAL NOT NULL,
        top_y REAL NOT NULL,
        right_x REAL NOT NULL,
        bottom_y REAL NOT NULL,
        aligned INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ${now},
        updated_by TEXT
      );
    `,
  },
  {
    id: 7,
    name: 'base_intrusion_signals',
    rebuildsTables: true,
    sql: `
      -- Adds the base_intrusion kind; SQLite can't change a CHECK in place.
      CREATE TABLE player_signals_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        player_name TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('movement', 'level', 'shared_ip', 'base_intrusion')),
        summary TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        dismissed_at TEXT,
        dismissed_by TEXT
      );
      INSERT INTO player_signals_new SELECT * FROM player_signals;
      DROP TABLE player_signals;
      ALTER TABLE player_signals_new RENAME TO player_signals;
      CREATE INDEX player_signals_open ON player_signals(server_id, dismissed_at, id);
      CREATE INDEX player_signals_player ON player_signals(server_id, user_id, id);
      CREATE INDEX player_signals_dedupe ON player_signals(server_id, dedupe_key, created_at);
    `,
  },
  {
    id: 8,
    name: 'player_ips_and_ip_bans',
    sql: `
      -- Every address a player has connected from, recorded from the online
      -- list and the world snapshot. Staff-only: never sent to the public site.
      CREATE TABLE player_ips (
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        first_seen_at TEXT NOT NULL DEFAULT ${now},
        last_seen_at TEXT NOT NULL DEFAULT ${now},
        PRIMARY KEY (server_id, user_id, ip)
      );
      CREATE INDEX player_ips_ip ON player_ips(server_id, ip);

      -- The game's REST API only bans platform ids, so the panel keeps its own
      -- list of banned addresses and bans any account seen connecting from one.
      CREATE TABLE ip_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        ip TEXT NOT NULL,
        reason TEXT,
        source_user_id TEXT,
        source_name TEXT,
        actor_username TEXT,
        created_at TEXT NOT NULL DEFAULT ${now},
        UNIQUE (server_id, ip)
      );
    `,
  },
  {
    id: 9,
    name: 'paldefender',
    sql: `
      -- The optional PalDefender plugin integration (one row). Off unless an
      -- owner enables it. The API token is encrypted at rest.
      CREATE TABLE paldefender (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        host TEXT NOT NULL DEFAULT '127.0.0.1',
        port INTEGER NOT NULL DEFAULT 17993,
        use_tls INTEGER NOT NULL DEFAULT 0,
        token_encrypted TEXT,
        updated_at TEXT NOT NULL DEFAULT ${now}
      );
    `,
  },
  {
    id: 10,
    name: 'console',
    sql: `
      -- What the Console page shows: lines tailed from log files plus events the
      -- panel knows about. Kept for a week and capped, so it can't grow forever.
      CREATE TABLE console_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        source TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL
      );
      CREATE INDEX console_lines_at ON console_lines(at);

      -- How far into each tailed file the panel has read, so a restart neither
      -- repeats nor skips lines.
      CREATE TABLE console_offsets (
        path TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ${now}
      );

      -- Where to find the log files (one row). Off until an owner sets it up.
      CREATE TABLE console_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tail_enabled INTEGER NOT NULL DEFAULT 0,
        game_log_path TEXT,
        paldefender_log_path TEXT,
        updated_at TEXT NOT NULL DEFAULT ${now}
      );
    `,
  },
  {
    id: 11,
    name: 'console_logger_socket',
    sql: `
      -- Optional: the PalServerLogger websocket, for the game's real console stream.
      -- The token is encrypted at rest.
      ALTER TABLE console_settings ADD COLUMN logger_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE console_settings ADD COLUMN logger_host TEXT NOT NULL DEFAULT '127.0.0.1';
      ALTER TABLE console_settings ADD COLUMN logger_port INTEGER NOT NULL DEFAULT 8765;
      ALTER TABLE console_settings ADD COLUMN logger_tls INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE console_settings ADD COLUMN logger_token_encrypted TEXT;
    `,
  },
  {
    id: 12,
    name: 'discord_bot',
    sql: `
      -- The optional Discord bot (one row). It receives slash commands as signed HTTPS
      -- requests from Discord and posts events to channels. The bot token is encrypted at rest.
      CREATE TABLE discord_bot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        application_id TEXT,
        public_key TEXT,
        bot_token_encrypted TEXT,
        guild_id TEXT,
        public_info INTEGER NOT NULL DEFAULT 0,
        events_channel_id TEXT,
        log_channel_id TEXT,
        log_min_level TEXT NOT NULL DEFAULT 'error',
        notify_bans INTEGER NOT NULL DEFAULT 1,
        notify_signals INTEGER NOT NULL DEFAULT 1,
        notify_server INTEGER NOT NULL DEFAULT 1,
        notify_joins INTEGER NOT NULL DEFAULT 0,
        commands_registered_at TEXT,
        updated_at TEXT NOT NULL DEFAULT ${now}
      );
    `,
  },
  {
    id: 13,
    name: 'discord_bot_gateway',
    sql: `
      -- The bot's live connection: presence (player count, do not disturb) and, later, chat relay.
      ALTER TABLE discord_bot ADD COLUMN gateway_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE discord_bot ADD COLUMN presence_enabled INTEGER NOT NULL DEFAULT 1;
      -- A channel whose name shows the server status, e.g. "🟢 5/32 online".
      ALTER TABLE discord_bot ADD COLUMN status_channel_id TEXT;
      ALTER TABLE discord_bot ADD COLUMN status_channel_name TEXT;
      ALTER TABLE discord_bot ADD COLUMN status_channel_changed_at TEXT;
    `,
  },
  {
    id: 14,
    name: 'verified_links_roles_and_ban_sync',
    sql: `
      -- A character link is a claim until it is verified: by an in-game code, or by staff.
      -- Only verified links are ever used for Discord roles or bans.
      ALTER TABLE site_accounts ADD COLUMN verified_at TEXT;
      ALTER TABLE site_accounts ADD COLUMN verified_by TEXT;
      ALTER TABLE site_accounts ADD COLUMN verification_requested_at TEXT;
      -- The player chooses whether their Discord name is shown on their public profile.
      ALTER TABLE site_accounts ADD COLUMN show_discord INTEGER NOT NULL DEFAULT 0;

      -- One pending in-game code per account, kept as a hash, expiring and attempt-limited.
      CREATE TABLE link_codes (
        account_id INTEGER PRIMARY KEY REFERENCES site_accounts(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      -- The bot: put people in the Discord server on sign-in, give roles, and keep bans in step.
      ALTER TABLE discord_bot ADD COLUMN join_on_login INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE discord_bot ADD COLUMN verified_role_id TEXT;
      ALTER TABLE discord_bot ADD COLUMN role_owner_id TEXT;
      ALTER TABLE discord_bot ADD COLUMN role_admin_id TEXT;
      ALTER TABLE discord_bot ADD COLUMN role_moderator_id TEXT;
      ALTER TABLE discord_bot ADD COLUMN sync_nicknames INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE discord_bot ADD COLUMN sync_bans INTEGER NOT NULL DEFAULT 0;
    `,
  },
];
