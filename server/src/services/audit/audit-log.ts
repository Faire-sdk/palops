import type { DB } from '../../database/db.js';

export const AUDIT_CATEGORIES = ['auth', 'users', 'server', 'players', 'console', 'config', 'backups'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditActor {
  userId: number | null;
  username: string | null;
  ip?: string;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorUserId: number | null;
  actorUsername: string | null;
  category: AuditCategory;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

interface AuditRow {
  id: number;
  created_at: string;
  actor_user_id: number | null;
  actor_username: string | null;
  category: AuditCategory;
  action: string;
  target: string | null;
  details: string | null;
  ip: string | null;
}

/** Append-only record of administrative and security-relevant actions. */
export class AuditLog {
  private listeners: Array<(actor: AuditActor, entry: { category: AuditCategory; action: string; target?: string }) => void> = [];

  constructor(private readonly db: DB) {}

  /** Runs after each entry is written, e.g. to mirror it into the console. */
  onRecord(listener: (actor: AuditActor, entry: { category: AuditCategory; action: string; target?: string }) => void): void {
    this.listeners.push(listener);
  }

  record(
    actor: AuditActor,
    entry: { category: AuditCategory; action: string; target?: string; details?: Record<string, unknown> },
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (actor_user_id, actor_username, category, action, target, details, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor.userId,
        actor.username,
        entry.category,
        entry.action,
        entry.target ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        actor.ip ?? null,
      );
    for (const listener of this.listeners) listener(actor, { category: entry.category, action: entry.action, target: entry.target });
  }

  list(query: { category?: AuditCategory; limit: number; offset: number }): { entries: AuditEntry[]; total: number } {
    const where = query.category ? 'WHERE category = ?' : '';
    const params = query.category ? [query.category] : [];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as AuditRow[];
    return {
      total,
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        actorUserId: r.actor_user_id,
        actorUsername: r.actor_username,
        category: r.category,
        action: r.action,
        target: r.target,
        details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
        ip: r.ip,
      })),
    };
  }
}
