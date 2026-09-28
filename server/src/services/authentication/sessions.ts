import type { DB } from '../../database/db.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import type { Role } from './permissions.js';

export interface SessionUser {
  sessionId: string;
  userId: number;
  username: string;
  role: Role;
}

interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  username: string;
  role: Role;
  disabled: number;
}

export interface SessionOptions {
  idleMs: number;
  maxMs: number;
}

/**
 * Server-side sessions. The browser holds a random token in an HttpOnly
 * cookie; the database only stores its hash.
 */
export class SessionService {
  constructor(
    private readonly db: DB,
    private readonly options: SessionOptions,
  ) {}

  create(userId: number, meta: { ip?: string; userAgent?: string } = {}): { token: string; expiresAt: Date } {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.options.idleMs);
    this.db
      .prepare('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), userId, expiresAt.toISOString(), meta.ip ?? null, meta.userAgent?.slice(0, 255) ?? null);
    return { token, expiresAt };
  }

  /** Validates a token and slides its idle expiry forward, up to the absolute maximum. */
  validate(token: string): SessionUser | undefined {
    const id = sha256(token);
    const row = this.db
      .prepare(
        `SELECT s.id, s.user_id, s.created_at, s.expires_at, u.username, u.role, u.disabled
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(id) as SessionRow | undefined;
    if (!row) return undefined;

    const now = Date.now();
    const hardLimit = Date.parse(row.created_at) + this.options.maxMs;
    if (row.disabled === 1 || Date.parse(row.expires_at) <= now || hardLimit <= now) {
      this.revoke(id);
      return undefined;
    }

    const nextExpiry = new Date(Math.min(now + this.options.idleMs, hardLimit)).toISOString();
    this.db
      .prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
      .run(new Date(now).toISOString(), nextExpiry, id);
    return { sessionId: id, userId: row.user_id, username: row.username, role: row.role };
  }

  revoke(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  revokeToken(token: string): void {
    this.revoke(sha256(token));
  }

  revokeAllForUser(userId: number, exceptSessionId?: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, exceptSessionId ?? null);
  }

  pruneExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  }
}
