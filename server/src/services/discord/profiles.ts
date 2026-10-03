import type { DB } from '../../database/db.js';
import type { DiscordProfile } from './oauth.js';

/** The sign-in details that are kept per Discord account (identity lives in DiscordIdentity). */
export type StoredDiscordProfile = Omit<DiscordProfile, 'globalName' | 'banner' | 'accentColor'> & { updatedAt: string };

/** A Discord user's current name and pictures. */
export interface DiscordIdentity {
  username: string | null;
  globalName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: number | null;
  updatedAt: string;
}

interface Row {
  discord_id: string;
  email: string | null;
  email_verified: number | null;
  connections: string | null;
  guilds: string | null;
  community_member: string | null;
  updated_at: string;
}

interface IdentityRow {
  username: string | null;
  global_name: string | null;
  avatar: string | null;
  banner: string | null;
  accent_color: number | null;
  updated_at: string;
}

const parseJson = <T>(value: string | null): T | null => (value === null ? null : (JSON.parse(value) as T));

/**
 * The extra details from Discord sign-in, saved per Discord account and replaced on each sign-in,
 * plus each user's current name and pictures (refreshed by sign-in and by the bot's lookups).
 */
export class DiscordProfileService {
  constructor(private readonly db: DB) {}

  save(discordId: string, profile: DiscordProfile, account?: { username: string | null; avatar: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO discord_profiles (discord_id, email, email_verified, connections, guilds, community_member, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (discord_id) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified,
           connections = excluded.connections, guilds = excluded.guilds, community_member = excluded.community_member,
           updated_at = excluded.updated_at`,
      )
      .run(
        discordId,
        profile.email,
        profile.emailVerified === null ? null : profile.emailVerified ? 1 : 0,
        profile.connections && JSON.stringify(profile.connections),
        profile.guilds && JSON.stringify(profile.guilds),
        profile.communityMember === null ? null : JSON.stringify(profile.communityMember),
      );
    if (account) {
      this.saveIdentity(discordId, { username: account.username, avatar: account.avatar, globalName: profile.globalName, banner: profile.banner, accentColor: profile.accentColor });
    }
  }

  get(discordId: string): StoredDiscordProfile | null {
    const r = this.db.prepare('SELECT * FROM discord_profiles WHERE discord_id = ?').get(discordId) as Row | undefined;
    if (!r) return null;
    return {
      email: r.email,
      emailVerified: r.email_verified === null ? null : !!r.email_verified,
      connections: parseJson(r.connections),
      guilds: parseJson(r.guilds),
      communityMember: parseJson(r.community_member),
      updatedAt: r.updated_at,
    };
  }

  saveIdentity(discordId: string, i: Omit<DiscordIdentity, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO discord_users (discord_id, username, global_name, avatar, banner, accent_color, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (discord_id) DO UPDATE SET username = excluded.username, global_name = excluded.global_name,
           avatar = excluded.avatar, banner = excluded.banner, accent_color = excluded.accent_color, updated_at = excluded.updated_at`,
      )
      .run(discordId, i.username, i.globalName, i.avatar, i.banner, i.accentColor);
    // Keep the website account's copy current too, so every page shows the new picture.
    this.db.prepare('UPDATE site_accounts SET discord_username = ?, discord_avatar = ? WHERE discord_id = ?').run(i.username, i.avatar, discordId);
  }

  identity(discordId: string): DiscordIdentity | null {
    const r = this.db.prepare('SELECT * FROM discord_users WHERE discord_id = ?').get(discordId) as IdentityRow | undefined;
    return r ? { username: r.username, globalName: r.global_name, avatar: r.avatar, banner: r.banner, accentColor: r.accent_color, updatedAt: r.updated_at } : null;
  }
}
