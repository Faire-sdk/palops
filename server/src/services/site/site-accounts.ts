import { randomInt } from 'node:crypto';
import type { DB } from '../../database/db.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import type { DiscordAccount } from '../authentication/users.js';

export interface SiteAccount {
  id: number;
  discord: DiscordAccount;
  playerId: number | null;
  playerVerified: boolean;
  /** How it was verified: "code" (typed in from the game) or the staff member who confirmed it. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** The player asked staff to verify the link. */
  verificationRequestedAt: string | null;
  showDiscord: boolean;
  linkedAt: string | null;
  createdAt: string;
}

export type LinkEvent = { type: 'linked' | 'verified' | 'unlinked'; account: SiteAccount; playerId: number | null };

export type CodeResult = 'ok' | 'wrong' | 'expired' | 'locked' | 'none';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** No 0/O or 1/I/L, so a code read off a game screen isn't misread. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface AccountRow {
  id: number;
  discord_id: string;
  discord_username: string | null;
  discord_avatar: string | null;
  player_id: number | null;
  player_verified: number;
  verified_at: string | null;
  verified_by: string | null;
  verification_requested_at: string | null;
  show_discord: number;
  linked_at: string | null;
  created_at: string;
}

const toAccount = (r: AccountRow): SiteAccount => ({
  id: r.id,
  discord: { id: r.discord_id, username: r.discord_username, avatar: r.discord_avatar },
  playerId: r.player_id,
  playerVerified: r.player_verified === 1,
  verifiedBy: r.verified_by,
  verifiedAt: r.verified_at,
  verificationRequestedAt: r.verification_requested_at,
  showDiscord: r.show_discord === 1,
  linkedAt: r.linked_at,
  createdAt: r.created_at,
});

/**
 * Player accounts on the public website. Anyone can sign in with Discord;
 * these accounts have no panel permissions and use their own sessions table.
 */
export class SiteAccountService {
  private listeners: Array<(event: LinkEvent) => void> = [];

  /** Runs when a character is linked, verified or unlinked, e.g. to update Discord roles. */
  onLinkChange(listener: (event: LinkEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(type: LinkEvent['type'], account: SiteAccount, playerId: number | null): void {
    for (const listener of this.listeners) listener({ type, account, playerId });
  }

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
   * Links a character to the account. A self-service link is only a claim until it
   * is verified. A claim doesn't lock the character: whoever proves it's theirs
   * (with a code from the game, or via staff) takes it over from an unverified claimant.
   */
  linkPlayer(accountId: number, playerId: number): SiteAccount {
    const account = this.get(accountId);
    if (!account) throw notFound('Account not found');
    if (account.playerId === playerId) return account;
    const holder = this.db.prepare('SELECT id, player_verified FROM site_accounts WHERE player_id = ?').get(playerId) as { id: number; player_verified: number } | undefined;
    if (holder && holder.id !== accountId) {
      if (holder.player_verified === 1) throw conflict('That character is already linked to another Discord account. Ask the server staff if it’s yours.');
      // Only an unverified claim is in the way, and that proves nothing, so it gives way.
      this.unlinkPlayer(holder.id);
    }
    if (account.playerId !== null) this.unlinkPlayer(accountId);
    this.db.prepare(`UPDATE site_accounts SET player_id = ?, player_verified = 0, verified_at = NULL, verified_by = NULL, verification_requested_at = NULL, linked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(playerId, accountId);
    const linked = this.get(accountId)!;
    this.emit('linked', linked, playerId);
    return linked;
  }

  /** Marks the link as proven. `by` is "code" or the staff member who confirmed it. */
  verify(accountId: number, by: string): SiteAccount {
    const account = this.get(accountId);
    if (!account?.playerId) throw badRequest('Link a character first', 'not_linked');
    this.db.prepare(`UPDATE site_accounts SET player_verified = 1, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), verified_by = ?, verification_requested_at = NULL WHERE id = ?`).run(by, accountId);
    this.db.prepare('DELETE FROM link_codes WHERE account_id = ?').run(accountId);
    const verified = this.get(accountId)!;
    this.emit('verified', verified, verified.playerId);
    return verified;
  }

  unlinkPlayer(accountId: number): void {
    const before = this.get(accountId);
    this.db.prepare('UPDATE site_accounts SET player_id = NULL, player_verified = 0, verified_at = NULL, verified_by = NULL, verification_requested_at = NULL, linked_at = NULL WHERE id = ?').run(accountId);
    this.db.prepare('DELETE FROM link_codes WHERE account_id = ?').run(accountId);
    if (before?.playerId) this.emit('unlinked', this.get(accountId)!, before.playerId);
  }

  setShowDiscord(accountId: number, show: boolean): void {
    this.db.prepare('UPDATE site_accounts SET show_discord = ? WHERE id = ?').run(show ? 1 : 0, accountId);
  }

  requestVerification(accountId: number): SiteAccount {
    const account = this.get(accountId);
    if (!account?.playerId) throw badRequest('Link a character first', 'not_linked');
    if (account.playerVerified) return account;
    this.db.prepare(`UPDATE site_accounts SET verification_requested_at = COALESCE(verification_requested_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?`).run(accountId);
    return this.get(accountId)!;
  }

  /** Links waiting for staff to confirm, oldest first. */
  pendingRequests(): Array<{ account: SiteAccount; player: { id: number; userId: string; name: string; level: number | null } }> {
    const rows = this.db
      .prepare(
        `SELECT a.*, p.id AS p_id, p.user_id AS p_user_id, p.name AS p_name, p.level AS p_level FROM site_accounts a
         JOIN players p ON p.id = a.player_id WHERE a.player_verified = 0 AND a.verification_requested_at IS NOT NULL ORDER BY a.verification_requested_at`,
      )
      .all() as Array<AccountRow & { p_id: number; p_user_id: string; p_name: string; p_level: number | null }>;
    return rows.map((r) => ({ account: toAccount(r), player: { id: r.p_id, userId: r.p_user_id, name: r.p_name, level: r.p_level } }));
  }

  /** The account linked to this platform ID; with verifiedOnly, only if the link is proven. */
  byPlayerUserId(userId: string, verifiedOnly = true): SiteAccount | undefined {
    const row = this.db
      .prepare(`SELECT a.* FROM site_accounts a JOIN players p ON p.id = a.player_id WHERE p.user_id = ? ${verifiedOnly ? 'AND a.player_verified = 1' : ''} LIMIT 1`)
      .get(userId) as AccountRow | undefined;
    return row && toAccount(row);
  }

  /** The verified character of a Discord user, if any. */
  verifiedPlayerOf(discordId: string): { id: number; userId: string; name: string } | undefined {
    return this.db
      .prepare(`SELECT p.id, p.user_id AS userId, p.name FROM site_accounts a JOIN players p ON p.id = a.player_id WHERE a.discord_id = ? AND a.player_verified = 1`)
      .get(discordId) as { id: number; userId: string; name: string } | undefined;
  }

  all(): SiteAccount[] {
    return (this.db.prepare('SELECT * FROM site_accounts').all() as AccountRow[]).map(toAccount);
  }

  // ---- In-game codes ----

  /** Makes a code for the linked character. Only its hash is kept. */
  createCode(accountId: number): { code: string; playerId: number } {
    const account = this.get(accountId);
    if (!account?.playerId) throw badRequest('Link a character first', 'not_linked');
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO link_codes (account_id, player_id, code_hash, attempts, sent_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET player_id = excluded.player_id, code_hash = excluded.code_hash, attempts = 0, sent_at = excluded.sent_at, expires_at = excluded.expires_at`,
      )
      .run(accountId, account.playerId, sha256(code), new Date(now).toISOString(), new Date(now + CODE_TTL_MS).toISOString());
    return { code, playerId: account.playerId };
  }

  discardCode(accountId: number): void {
    this.db.prepare('DELETE FROM link_codes WHERE account_id = ?').run(accountId);
  }

  /** When a code was last sent, so it can't be re-sent in a rush. */
  lastCodeSentAt(accountId: number): number | null {
    const row = this.db.prepare('SELECT sent_at FROM link_codes WHERE account_id = ?').get(accountId) as { sent_at: string } | undefined;
    return row ? Date.parse(row.sent_at) : null;
  }

  /** Checks a typed code. Wrong guesses are counted, and too many lock it until a new one is sent. */
  checkCode(accountId: number, input: string): CodeResult {
    const row = this.db.prepare('SELECT * FROM link_codes WHERE account_id = ?').get(accountId) as { player_id: number; code_hash: string; attempts: number; expires_at: string } | undefined;
    const account = this.get(accountId);
    if (!row || !account || account.playerId !== row.player_id) return 'none';
    if (Date.parse(row.expires_at) <= Date.now()) return 'expired';
    if (row.attempts >= MAX_ATTEMPTS) return 'locked';
    if (sha256(input.trim().toUpperCase().replace(/[\s-]/g, '')) !== row.code_hash) {
      this.db.prepare('UPDATE link_codes SET attempts = attempts + 1 WHERE account_id = ?').run(accountId);
      return 'wrong';
    }
    return 'ok';
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
