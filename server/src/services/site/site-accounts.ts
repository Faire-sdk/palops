import type { DB } from '../../database/db.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { conflict, notFound } from '../../utils/errors.js';
import type { DiscordAccount } from '../authentication/users.js';

export interface SiteAccount {
  id: number;
  discord: DiscordAccount;
  playerId: number | null;
  playerVerified: boolean;
  linkedAt: string | null;
  createdAt: string;
}

interface AccountRow {
  id: number;
  discord_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  player_id: number | null;
  player_verified: number;
  linked_at: string | null;
  created_at: string;
}

const toAccount = (r: AccountRow): SiteAccount => ({
  id: r.id,
  discord: { id: r.discord_id, username: r.discord_username, avatar: r.discord_avatar },
  playerId: r.player_id,
  playerVerified: r.player_verified === 1,
  linkedAt: r.linked_at,
  createdAt: r.created_at,
});

/**
 * Player accounts on the public website. Anyone can sign in with Discord;
 * these accounts have no panel permissions and use their own sessions table.
 */
export class SiteAccountService {
  constructor(
    private readonly db: DB,
    private readonly sessionMs: number,
  ) {}

  signIn(discord: DiscordAccount): SiteAccount {
    this.db
      .prepare(
        `INSERT INTO site_accounts (discord_id, discord_username, discord_avatar, last_login_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (discord_id) DO UPDATE SET discord_username = excluded.discord_username,
           discord_avatar = excluded.discord_avatar, last_login_at = excluded.last_login_at`,
      )
      .run(discord.id, discord.username, discord.avatar);
    return this.getByDiscordId(discord.id)!;
  }

  get(id: number): SiteAccount | undefined {
    const row = this.db.prepare('SELECT * FROM site_accounts WHERE id = ?').get(id) as AccountRow | undefined;
    return row && toAccount(row);
  }

  getByDiscordId(discordId: string): SiteAccount | undefined {
    const row = this.db.prepare('SELECT * FROM site_accounts WHERE discord_id = ?').get(discordId) as AccountRow | undefined;
    return row && toAccount(row);
  }

  /**
   * Links a character to the account. Self-service links are unverified;
   * staff verification (or an in-game code via a server plugin) comes later.
   */
  linkPlayer(accountId: number, playerId: number): SiteAccount {
    if (!this.get(accountId)) throw notFound('Account not found');
    const holder = this.db.prepare('SELECT id FROM site_accounts WHERE player_id = ?').get(playerId) as { id: number } | undefined;
    if (holder && holder.id !== accountId) {
      throw conflict('That character is already linked to another Discord account. Ask the server staff if it’s yours.');
    }
    this.db
      .prepare(
        `UPDATE site_accounts SET player_id = ?, player_verified = 0, linked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
      .run(playerId, accountId);
    return this.get(accountId)!;
  }

  unlinkPlayer(accountId: number): void {
    this.db.prepare('UPDATE site_accounts SET player_id = NULL, player_verified = 0, linked_at = NULL WHERE id = ?').run(accountId);
  }

  createSession(accountId: number): string {
    const token = randomToken();
    this.db
      .prepare('INSERT INTO site_sessions (id, account_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), accountId, new Date(Date.now() + this.sessionMs).toISOString());
    return token;
  }

  validateSession(token: string): SiteAccount | undefined {
    const row = this.db
      .prepare('SELECT account_id, expires_at FROM site_sessions WHERE id = ?')
      .get(sha256(token)) as { account_id: number; expires_at: string } | undefined;
    if (!row) return undefined;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.revokeSession(token);
      return undefined;
    }
    return this.get(row.account_id);
  }

  revokeSession(token: string): void {
    this.db.prepare('DELETE FROM site_sessions WHERE id = ?').run(sha256(token));
  }

  pruneExpired(): void {
    this.db.prepare('DELETE FROM site_sessions WHERE expires_at <= ?').run(new Date().toISOString());
  }
}
