import type { DB } from '../../database/db.js';
import type { DiscordProfile } from './oauth.js';

export interface StoredDiscordProfile extends DiscordProfile {
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

const parseJson = <T>(value: string | null): T | null => (value === null ? null : (JSON.parse(value) as T));

/** The extra details from Discord sign-in, saved per Discord account and replaced on each sign-in. */
export class DiscordProfileService {
  constructor(private readonly db: DB) {}

  save(discordId: string, profile: DiscordProfile): void {
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
}
