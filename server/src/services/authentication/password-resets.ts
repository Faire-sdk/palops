import type { DB } from '../../database/db.js';
import { randomToken, sha256 } from '../../utils/crypto.js';

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Account recovery building block: an owner issues a one-time token for a user
 * and hands it over out of band. Delivery by email or Discord can be layered
 * on top later without changing how tokens are stored or redeemed.
 */
export class PasswordResetService {
  constructor(private readonly db: DB) {}

  issue(userId: number, createdBy: number | null): { token: string; expiresAt: string } {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    this.db.transaction(() => {
      // Only the newest token for a user is valid.
      this.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(userId);
      this.db
        .prepare('INSERT INTO password_resets (id, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)')
        .run(sha256(token), userId, createdBy, expiresAt);
    })();
    return { token, expiresAt };
  }

  /** Marks the token used and returns its user id, or undefined if invalid or expired. */
  redeem(token: string): number | undefined {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id`,
      )
      .get(now, sha256(token), now) as { user_id: number } | undefined;
    return result?.user_id;
  }
}
