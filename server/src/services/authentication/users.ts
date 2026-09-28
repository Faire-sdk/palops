import type { DB } from '../../database/db.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { hashPassword, passwordProblem } from './passwords.js';
import type { Role } from './permissions.js';

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  role: row.role,
  disabled: row.disabled === 1,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

export class UserService {
  constructor(private readonly db: DB) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map(toUser);
  }

  get(id: number): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row && toUser(row);
  }

  /** Includes the password hash; only for authentication code. */
  findForLogin(username: string): (User & { passwordHash: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row && { ...toUser(row), passwordHash: row.password_hash };
  }

  getPasswordHash(id: number): string | undefined {
    return (this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined)
      ?.password_hash;
  }

  async create(username: string, password: string, role: Role): Promise<User> {
    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
    }
    const problem = passwordProblem(password, username);
    if (problem) throw badRequest(problem, 'weak_password');
    if (this.findForLogin(username)) throw conflict('That username is already taken');
    const hash = await hashPassword(password);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, hash, role);
    return this.get(Number(lastInsertRowid))!;
  }

  async setPassword(id: number, password: string): Promise<void> {
    const user = this.get(id);
    if (!user) throw notFound('User not found');
    const problem = passwordProblem(password, user.username);
    if (problem) throw badRequest(problem, 'weak_password');
    const hash = await hashPassword(password);
    this.db
      .prepare(`UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(hash, id);
  }

  update(id: number, changes: { role?: Role; disabled?: boolean }): User {
    const user = this.get(id);
    if (!user) throw notFound('User not found');
    const role = changes.role ?? user.role;
    const disabled = changes.disabled ?? user.disabled;
    const losesOwner = user.role === 'owner' && !user.disabled && (role !== 'owner' || disabled);
    if (losesOwner && this.activeOwnerCount() <= 1) {
      throw badRequest('The panel must keep at least one active owner', 'last_owner');
    }
    this.db
      .prepare(`UPDATE users SET role = ?, disabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(role, disabled ? 1 : 0, id);
    return this.get(id)!;
  }

  touchLogin(id: number): void {
    this.db.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
  }

  private activeOwnerCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0`).get() as { n: number })
      .n;
  }
}
