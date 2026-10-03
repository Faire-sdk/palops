import type { DB } from '../../database/db.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { hashPassword, passwordProblem } from './passwords.js';
import type { Role } from './permissions.js';

export interface DiscordAccount {
  id: string;
  username: string | null;
  avatar: string | null;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  discord: DiscordAccount | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  role: Role;
  disabled: number;
  discord_id: string | null;
  discord_username: string | null;
  discord_avatar: string | null;
  created_at: string;
  last_login_at: string | null;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
/** Usernames that are only a Discord ID, which get replaced by the Discord name at sign-in. */
const PLACEHOLDER_USERNAME = /^(discord[_.-]?)?\d{17,20}$/i;
/** Discord user ids are snowflakes: 17-20 digit integers. */
export const DISCORD_ID_PATTERN = /^\d{17,20}$/;

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  role: row.role,
  disabled: row.disabled === 1,
  hasPassword: row.password_hash !== null,
  discord: row.discord_id ? { id: row.discord_id, username: row.discord_username, avatar: row.discord_avatar } : null,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

const touch = `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export interface NewUser {
  username: string;
  role: Role;
  password?: string;
  discord?: DiscordAccount;
}

export class UserService {
  private discordListeners: Array<(discordIds: string[]) => void> = [];

  constructor(private readonly db: DB) {}

  /** Runs with the Discord IDs whose panel role may have changed (created, re-linked, role or status changed). */
  onDiscordChange(listener: (discordIds: string[]) => void): void {
    this.discordListeners.push(listener);
  }

  private changed(...ids: Array<string | null | undefined>): void {
    const list = [...new Set(ids.filter((i): i is string => !!i))];
    if (list.length) for (const listener of this.discordListeners) listener(list);
  }

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

  findByDiscordId(discordId: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as UserRow | undefined;
    return row && toUser(row);
  }

  /** Includes the password hash; only for authentication code. */
  findForLogin(username: string): (User & { passwordHash: string | null }) | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row && { ...toUser(row), passwordHash: row.password_hash };
  }

  getPasswordHash(id: number): string | null | undefined {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string | null } | undefined;
    return row?.password_hash;
  }

  async create(input: NewUser): Promise<User> {
    if (!USERNAME_PATTERN.test(input.username)) {
      throw badRequest('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
    }
    if (input.password === undefined && !input.discord) {
      throw badRequest('A user needs a Discord account or a password to sign in with', 'no_sign_in_method');
    }
    let hash: string | null = null;
    if (input.password !== undefined) {
      const problem = passwordProblem(input.password, input.username);
      if (problem) throw badRequest(problem, 'weak_password');
      hash = await hashPassword(input.password);
    }
    if (this.findForLogin(input.username)) throw conflict('That username is already taken');
    if (input.discord) this.assertDiscordFree(input.discord.id);
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO users (username, password_hash, role, discord_id, discord_username, discord_avatar)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.username, hash, input.role, input.discord?.id ?? null, input.discord?.username ?? null, input.discord?.avatar ?? null);
    this.changed(input.discord?.id);
    return this.get(Number(lastInsertRowid))!;
  }

  /** Picks a free, valid panel username based on a Discord name. */
  availableUsername(base: string): string {
    let name = base.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 28);
    if (name.length < 3) name = `user${name}`;
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? name : `${name}${i + 1}`;
      if (!this.findForLogin(candidate)) return candidate;
    }
  }

  async setPassword(id: number, password: string): Promise<void> {
    const user = this.get(id);
    if (!user) throw notFound('User not found');
    const problem = passwordProblem(password, user.username);
    if (problem) throw badRequest(problem, 'weak_password');
    const hash = await hashPassword(password);
    this.db.prepare(`UPDATE users SET password_hash = ?, ${touch} WHERE id = ?`).run(hash, id);
  }

  /** Links (or with null, unlinks) a Discord account. */
  setDiscord(id: number, discord: DiscordAccount | null): User {
    const before = this.get(id);
    if (!before) throw notFound('User not found');
    if (discord) this.assertDiscordFree(discord.id, id);
    this.db
      .prepare(`UPDATE users SET discord_id = ?, discord_username = ?, discord_avatar = ?, ${touch} WHERE id = ?`)
      .run(discord?.id ?? null, discord?.username ?? null, discord?.avatar ?? null, id);
    // An account named after a bare Discord ID (e.g. "discord_123…") takes their Discord name once it's known.
    if (discord?.username && PLACEHOLDER_USERNAME.test(before.username)) {
      this.db.prepare(`UPDATE users SET username = ?, ${touch} WHERE id = ?`).run(this.availableUsername(discord.username), id);
    }
    if (before.discord?.id !== discord?.id) this.changed(before.discord?.id, discord?.id);
    return this.get(id)!;
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
    this.db.prepare(`UPDATE users SET role = ?, disabled = ?, ${touch} WHERE id = ?`).run(role, disabled ? 1 : 0, id);
    if (role !== user.role || disabled !== user.disabled) this.changed(user.discord?.id);
    return this.get(id)!;
  }

  touchLogin(id: number): void {
    this.db.prepare(`UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
  }

  private assertDiscordFree(discordId: string, exceptUserId?: number) {
    const owner = this.findByDiscordId(discordId);
    if (owner && owner.id !== exceptUserId) throw conflict('That Discord account is already linked to another panel user');
  }

  private activeOwnerCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0`).get() as { n: number }).n;
  }
}
