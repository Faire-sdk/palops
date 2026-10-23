import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { DiscordProfile } from '../api/types';
import { formatDateTime } from '../format';

/** Display names for Discord connection types; anything else shows as Discord names it. */
const CONNECTION_NAMES: Record<string, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  epicgames: 'Epic Games',
  battlenet: 'Battle.net',
  riotgames: 'Riot Games',
  twitch: 'Twitch',
  youtube: 'YouTube',
  twitter: 'X',
  github: 'GitHub',
  spotify: 'Spotify',
  reddit: 'Reddit',
};

export const connectionName = (type: string) => CONNECTION_NAMES[type] ?? type;

/** Whether they're in the community Discord server, as a chip. */
export function MemberChip({ profile }: { profile: DiscordProfile | null | undefined }) {
  const m = profile?.communityMember;
  if (m === undefined || m === null) return <Chip size="small" variant="outlined" label="Unknown" />;
  if (m === false) return <Chip size="small" variant="outlined" color="warning" label="Not in server" />;
  return (
    <Tooltip title={m.joinedAt ? `Joined ${formatDateTime(m.joinedAt)}` : ''}>
      <Chip size="small" variant="outlined" color="success" label={m.nick ? `Member · ${m.nick}` : 'Member'} />
    </Tooltip>
  );
}

/** Linked accounts (Steam, Xbox, ...) as chips. */
export function ConnectionChips({ profile }: { profile: DiscordProfile | null | undefined }) {
  const list = profile?.connections;
  if (!list?.length) return <Typography variant="body2" color="text.secondary">{list ? 'None' : '—'}</Typography>;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {list.map((c) => (
        <Tooltip key={`${c.type}:${c.id}`} title={`${c.id}${c.verified ? ' · verified by Discord' : ''}`}>
          <Chip size="small" label={`${connectionName(c.type)}: ${c.name}`} variant={c.verified ? 'filled' : 'outlined'} />
        </Tooltip>
      ))}
    </Stack>
  );
}

/** The whole profile, for the player dialog. Email and servers only appear when the viewer may see them. */
export function DiscordProfileDetails({ profile }: { profile: DiscordProfile | null | undefined }) {
  if (!profile) return <Typography variant="body2" color="text.secondary">No Discord details yet. They appear after the player’s next website sign-in.</Typography>;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
          Discord server
        </Typography>
        <MemberChip profile={profile} />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
          Connections
        </Typography>
        <ConnectionChips profile={profile} />
      </Stack>
      {profile.email !== null && (
        <Stack direction="row" spacing={1}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
            Email
          </Typography>
          <Typography variant="body2">
            {profile.email}
            {profile.emailVerified === false ? ' (not verified)' : ''}
          </Typography>
        </Stack>
      )}
      {profile.guilds && (
        <Stack direction="row" spacing={1}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
            Servers
          </Typography>
          <Typography variant="body2">
            {profile.guilds.length} {profile.guilds.length === 1 ? 'server' : 'servers'}
            {profile.guilds.length > 0 && <Typography component="span" variant="body2" color="text.secondary">{` · ${profile.guilds.slice(0, 8).map((g) => g.name).join(', ')}${profile.guilds.length > 8 ? '…' : ''}`}</Typography>}
          </Typography>
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary">
        From their last website sign-in, {formatDateTime(profile.updatedAt)}.
      </Typography>
    </Stack>
  );
}
