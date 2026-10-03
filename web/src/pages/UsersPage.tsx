import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { WebsiteAccount } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { discordAvatarUrl } from '../auth/discord';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { DataTable } from '../components/DataTable';
import { MemberChip } from '../components/DiscordProfile';
import { PlayerProfileDialog } from '../components/PlayerActions';
import { PlayerName } from '../components/PlayerBits';
import { UserProfileDialog } from '../components/UserProfileDialog';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';

type Filter = 'linked' | 'verified' | 'unlinked' | 'all';

/** Everyone who signed in on the public website with Discord, and the character they linked. */
export function UsersPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('linked');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [profile, setProfile] = useState<string | null>(null);
  const [user, setUser] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<{ accounts: WebsiteAccount[]; communityServerId: string | null }>(
    `/accounts?filter=${filter}&q=${encodeURIComponent(q)}`,
    { pollMs: 30000 },
  );
  const showPrivate = can('accounts.private');

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <PageHeader title="Users" description="Players who signed in on the website with Discord and the character they linked. Click someone to see their Discord profile." />
      <Section
        title={
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v: Filter | null) => v && setFilter(v)}>
              <ToggleButton value="linked">Linked</ToggleButton>
              <ToggleButton value="verified">Verified</ToggleButton>
              <ToggleButton value="unlinked">Unlinked</ToggleButton>
              <ToggleButton value="all">All</ToggleButton>
            </ToggleButtonGroup>
            <TextField size="small" placeholder="Search Discord name, ID or character" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { sm: 280 } }} />
          </Stack>
        }
        disablePadding
      >
        {loading && !data ? (
          <Loading />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <DataTable
            rows={data?.accounts ?? []}
            rowKey={(a) => a.id}
            onRowClick={(a) => setUser(a.id)}
            empty={<EmptyState icon={PersonSearchOutlinedIcon} title="No users here yet">Players appear after they sign in on the website{filter !== 'all' && filter !== 'unlinked' ? ' and link their character' : ''}.</EmptyState>}
            columns={[
              {
                key: 'discord',
                header: 'Discord',
                render: (a) => (
                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                    <Avatar src={discordAvatarUrl(a.discord) ?? undefined} sx={{ width: 36, height: 36 }}>
                      {(a.discord.globalName ?? a.discord.username ?? '?').slice(0, 1).toUpperCase()}
                    </Avatar>
                    <div>
                      <Typography sx={{ fontWeight: 600 }}>{a.discord.globalName ?? a.discord.username ?? 'Unknown'}</Typography>
                      {a.discord.username ? (
                        <Typography variant="body2" color="text.secondary">
                          @{a.discord.username}
                        </Typography>
                      ) : (
                        <Mono muted>{a.discord.id}</Mono>
                      )}
                    </div>
                  </Stack>
                ),
              },
              {
                key: 'character',
                header: 'Character',
                render: (a) =>
                  a.player ? (
                    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                      <PlayerName name={a.player.name ?? a.player.userId} userId={a.player.userId} onOpen={setProfile} />
                      <Chip
                        size="small"
                        variant="outlined"
                        color={a.verified ? 'success' : 'warning'}
                        label={a.verified ? `Verified${a.verifiedBy ? ` · ${a.verifiedBy === 'code' ? 'in-game code' : a.verifiedBy}` : ''}` : a.requestedAt ? 'Verification requested' : 'Claimed'}
                      />
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      None
                    </Typography>
                  ),
              },
              { key: 'member', header: 'Discord server', render: (a) => <MemberChip profile={a.profile} /> },
              ...(showPrivate
                ? [
                    {
                      key: 'email',
                      header: 'Email',
                      render: (a: WebsiteAccount) => (a.profile?.email ? `${a.profile.email}${a.profile.emailVerified === false ? ' (not verified)' : ''}` : '—'),
                    },
                    { key: 'guilds', header: 'Servers', align: 'right' as const, render: (a: WebsiteAccount) => a.profile?.guilds?.length ?? '—' },
                  ]
                : []),
              { key: 'seen', header: 'Last sign-in', nowrap: true, render: (a) => formatDateTime(a.lastLoginAt ?? a.createdAt) },
            ]}
          />
        )}
      </Section>
      {!data?.communityServerId && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Set the Discord bot’s server ID in Settings → Discord bot to see who is in your Discord server.
        </Typography>
      )}
      <UserProfileDialog accountId={user} onClose={() => setUser(null)} onOpenPlayer={setProfile} />
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} onOpen={setProfile} />
    </>
  );
}
