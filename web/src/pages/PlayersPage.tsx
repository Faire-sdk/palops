import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api/client';
import type { KnownPlayer, LinkRequest, Player, PlayerSignal } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { ServerActivity } from '../components/ActivityMetrics';
import { ExportButton, PlayerName } from '../components/PlayerBits';
import { DataTable } from '../components/DataTable';
import { ModerationDialog, PlayerProfileDialog } from '../components/PlayerActions';
import { useToast } from '../components/Toast';
import { SignalChip } from '../components/world';
import { formatDateTime, formatDuration } from '../format';
import VerifiedIcon from '@mui/icons-material/Verified';
import LinkIcon from '@mui/icons-material/Link';
import { refreshAll, useApi } from '../hooks/useApi';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All players' },
  { id: 'activity', label: 'Activity' },
  { id: 'signals', label: 'Signals' },
  { id: 'links', label: 'Link requests' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Target = { action: 'kick' | 'ban' | 'unban'; userId: string; name: string; ip?: string | null };

export function PlayersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => (t.id !== 'signals' || can('world.view')) && (t.id !== 'links' || can('players.ban')));
  const tab: TabId = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'online';
  const [profile, setProfile] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  return (
    <>
      <PageHeader title="Players" description="Who’s online, everyone the panel has seen, and how much they play. Bans have their own page." actions={<ExportButton path="/players/export.csv" />} />
      <Tabs value={tab} onChange={(_, v: TabId) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      {tab === 'activity' && <ServerActivity />}
      {tab === 'online' && <OnlinePlayers onOpen={setProfile} onAction={setTarget} />}
      {tab === 'all' && <AllPlayers onOpen={setProfile} />}
      {tab === 'signals' && <Signals onOpen={setProfile} />}
      {tab === 'links' && <LinkRequests onOpen={setProfile} />}
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} onOpen={setProfile} />
      <ModerationDialog action={target?.action ?? null} userId={target?.userId ?? ''} name={target?.name ?? ''} ip={target?.ip} onClose={() => setTarget(null)} />
    </>
  );
}

/** A small mark for players with a website account: verified (proven) or claimed (not yet). */
function LinkBadge({ link }: { link: 'verified' | 'claimed' | null | undefined }) {
  if (!link) return null;
  return (
    <Tooltip title={link === 'verified' ? 'Discord account linked and verified' : 'Discord account linked but not verified'}>
      {link === 'verified' ? <VerifiedIcon color="primary" sx={{ fontSize: 16 }} /> : <LinkIcon color="disabled" sx={{ fontSize: 16 }} />}
    </Tooltip>
  );
}

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TextField
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ width: { xs: '100%', sm: 260 } }}
      slotProps={{
        htmlInput: { 'aria-label': label },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

const isOffline = (error: Error) => error instanceof ApiError && ['palworld_unreachable', 'palworld_not_configured'].includes(error.code);

function OnlinePlayers({ onOpen, onAction }: { onOpen: (userId: string) => void; onAction: (t: Target) => void }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<{ players: Player[] }>('/players', { pollMs: 15000 });
  const [query, setQuery] = useState('');

  const players = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.players ?? [];
    return q ? list.filter((p) => [p.name, p.accountName, p.userId, p.playerId, p.ip ?? ''].some((v) => v.toLowerCase().includes(q))) : list;
  }, [data, query]);

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) {
    body = isOffline(error) ? (
      <EmptyState icon={DnsOutlinedIcon} title="Server unavailable">
        {error.message}
      </EmptyState>
    ) : (
      <ErrorState error={error} onRetry={reload} />
    );
  } else {
    body = (
      <DataTable
        rows={players}
        rowKey={(p) => p.userId || p.playerId}
        empty={<EmptyState icon={PeopleOutlinedIcon} title={query ? 'No matching players' : 'Nobody is online right now'} />}
        columns={[
          {
            key: 'name',
            header: 'Player',
            render: (p) => (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <PlayerName name={p.name} userId={p.userId} onOpen={onOpen} />
                <LinkBadge link={p.link} />
              </Stack>
            ),
          },
          { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
          { key: 'guild', header: 'Guild', render: (p) => p.guild ?? '—' },
          { key: 'playtime', header: 'Playtime', nowrap: true, render: (p) => (p.playtimeSeconds ? formatDuration(p.playtimeSeconds) : '—') },
          { key: 'sessions', header: 'Visits', render: (p) => p.sessions ?? 0 },
          { key: 'userId', header: 'Platform ID', render: (p) => <Mono>{p.userId}</Mono> },
          ...(can('players.ip') ? [{ key: 'ip', header: 'IP address', render: (p: Player) => (p.ip ? <Mono>{p.ip}</Mono> : '—') }] : []),
          { key: 'buildings', header: 'Buildings', render: (p) => p.buildingCount ?? '—' },
          { key: 'ping', header: 'Ping', nowrap: true, render: (p) => (p.ping !== null ? `${Math.round(p.ping)} ms` : '—') },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (p) => (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                {can('players.kick') && (
                  <Button size="small" variant="outlined" onClick={() => onAction({ action: 'kick', userId: p.userId, name: p.name })}>
                    Kick
                  </Button>
                )}
                {can('players.ban') && (
                  <Button size="small" variant="outlined" color="error" onClick={() => onAction({ action: 'ban', userId: p.userId, name: p.name, ip: p.ip })}>
                    Ban
                  </Button>
                )}
              </Stack>
            ),
          },
        ]}
      />
    );
  }

  return (
    <Section title={data ? `Online (${data.players.length})` : 'Online'} action={<SearchField label="Search players" value={query} onChange={setQuery} />} disablePadding>
      {body}
    </Section>
  );
}

const PAGE_SIZE = 50;

function AllPlayers({ onOpen }: { onOpen: (userId: string) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<'recent' | 'name' | 'playtime' | 'level'>('recent');
  const [filter, setFilter] = useState<'all' | 'online' | 'banned' | 'linked' | 'verified' | 'unverified'>('all');
  const search = query.trim();
  const path = `/players/known?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&sort=${sort}&filter=${filter}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const { data, error, loading, reload } = useApi<{ players: KnownPlayer[]; total: number }>(path);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <>
        <DataTable
          rows={data?.players ?? []}
          rowKey={(p) => p.id}
          empty={
            <EmptyState icon={PeopleOutlinedIcon} title={search ? 'No matching players' : 'No players seen yet'}>
              {!search && 'Players are recorded once a minute while they’re online.'}
            </EmptyState>
          }
          columns={[
            {
              key: 'name',
              header: 'Player',
              render: (p) => (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <PlayerName name={p.name} userId={p.userId} onOpen={onOpen} />
                  <LinkBadge link={p.link} />
                  {p.online && <Chip label="Online" color="success" variant="outlined" />}
                  {p.banned && <Chip label="Banned" color="error" variant="outlined" />}
                </Stack>
              ),
            },
            { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
            { key: 'guild', header: 'Guild', render: (p) => p.guild ?? '—' },
            { key: 'playtime', header: 'Playtime', nowrap: true, render: (p) => (p.playtimeSeconds ? formatDuration(p.playtimeSeconds) : '—') },
          { key: 'sessions', header: 'Visits', render: (p) => p.sessions ?? 0 },
            { key: 'userId', header: 'Platform ID', render: (p) => <Mono>{p.userId}</Mono> },
            { key: 'lastSeen', header: 'Last seen', nowrap: true, render: (p) => formatDateTime(p.lastSeenAt) },
          ]}
        />
        {pages > 1 && (
          <Stack sx={{ alignItems: 'center', py: 2 }}>
            <Pagination count={pages} page={page + 1} onChange={(_, p) => setPage(p - 1)} color="primary" />
          </Stack>
        )}
      </>
    );
  }

  return (
    <Section
      title={data ? `All players (${data.total})` : 'All players'}
      disablePadding
      action={
        <SearchField
          label="Search name, ID or guild"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
        />
      }
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ p: 2, borderBottom: 1, borderColor: 'divider', alignItems: { sm: 'center' } }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', flexGrow: 1 }}>
          {(
            [
              ['all', 'Everyone'],
              ['online', 'Online'],
              ['banned', 'Banned'],
              ['linked', 'Has a Discord link'],
              ['verified', 'Verified'],
              ['unverified', 'Not verified'],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} label={label} color={filter === id ? 'primary' : 'default'} variant={filter === id ? 'filled' : 'outlined'} onClick={() => (setFilter(id), setPage(0))} />
          ))}
        </Stack>
        <TextField select label="Sort by" value={sort} onChange={(e) => (setSort(e.target.value as typeof sort), setPage(0))} sx={{ minWidth: 170 }}>
          <MenuItem value="recent">Recently seen</MenuItem>
          <MenuItem value="playtime">Most playtime</MenuItem>
          <MenuItem value="level">Highest level</MenuItem>
          <MenuItem value="name">Name</MenuItem>
        </TextField>
      </Stack>
      {body}
    </Section>
  );
}

/** Website accounts that asked staff to confirm the character they linked is theirs. */
function LinkRequests({ onOpen }: { onOpen: (userId: string) => void }) {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ requests: LinkRequest[] }>('/players/link-requests', { pollMs: 30000 });

  const decide = async (r: LinkRequest, decision: 'approve' | 'reject') => {
    try {
      await api.post(`/players/link-requests/${r.accountId}/${decision}`);
      notify(decision === 'approve' ? `${r.player.name} is now verified for ${r.discord.username ?? r.discord.id}` : 'Link rejected', 'success');
      await reload();
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <DataTable
        rows={data?.requests ?? []}
        rowKey={(r) => r.accountId}
        empty={<EmptyState icon={PeopleOutlinedIcon} title="No link requests">Players who ask staff to verify their character show up here.</EmptyState>}
        columns={[
          { key: 'discord', header: 'Discord account', render: (r) => r.discord.username ?? r.discord.id },
          { key: 'player', header: 'Says they are', render: (r) => <PlayerName name={r.player.name} userId={r.player.userId} onOpen={onOpen} /> },
          { key: 'level', header: 'Level', render: (r) => r.player.level ?? '—' },
          { key: 'at', header: 'Asked', nowrap: true, render: (r) => (r.requestedAt ? formatDateTime(r.requestedAt) : '—') },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r) => (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button size="small" variant="contained" onClick={() => decide(r, 'approve')}>
                  Approve
                </Button>
                <Button size="small" variant="outlined" color="error" onClick={() => decide(r, 'reject')}>
                  Reject
                </Button>
              </Stack>
            ),
          },
        ]}
      />
    );
  }

  return (
    <Section title={data ? `Link requests (${data.requests.length})` : 'Link requests'} disablePadding>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
        Only approve someone you can tell is really that player (ask in Discord or the game). An approved link gives them their Discord roles, and it’s what lets a ban on either side reach the
        other. Open the player to see their history first.
      </Typography>
      {body}
    </Section>
  );
}

/** Unusual movement, level jumps and shared addresses, from the world snapshot. */
function Signals({ onOpen }: { onOpen: (userId: string) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE = 25;
  const { data, error, loading, reload } = useApi<{ signals: PlayerSignal[]; total: number }>(
    `/world/signals?includeDismissed=${all}&limit=${PAGE}&offset=${page * PAGE}`,
    { pollMs: 30000 },
  );

  const dismiss = async (id: number) => {
    try {
      await api.post(`/world/signals/${id}/dismiss`);
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <>
        <DataTable
          rows={data?.signals ?? []}
          rowKey={(s) => s.id}
          empty={<EmptyState title={all ? 'No signals yet' : 'Nothing to review'}>Signals come from the world snapshot, so they need world data switched on.</EmptyState>}
          columns={[
            { key: 'player', header: 'Player', render: (s) => <PlayerName name={s.playerName ?? s.userId} userId={s.userId} onOpen={onOpen} /> },
            { key: 'kind', header: 'Signal', render: (s) => <SignalChip kind={s.kind} /> },
            { key: 'summary', header: 'What happened', render: (s) => s.summary },
            { key: 'at', header: 'When', nowrap: true, render: (s) => formatDateTime(s.createdAt) },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (s) =>
                s.dismissedAt ? (
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    Dismissed by {s.dismissedBy ?? 'someone'}
                  </Typography>
                ) : (
                  can('players.note') && (
                    <Button size="small" variant="outlined" onClick={() => dismiss(s.id)}>
                      Dismiss
                    </Button>
                  )
                ),
            },
          ]}
        />
        {data && data.total > PAGE && (
          <Stack sx={{ alignItems: 'center', py: 2 }}>
            <Pagination count={Math.ceil(data.total / PAGE)} page={page + 1} onChange={(_, p) => setPage(p - 1)} color="primary" />
          </Stack>
        )}
      </>
    );
  }

  return (
    <Section
      title={data ? `Signals (${data.total})` : 'Signals'}
      disablePadding
      action={
        <FormControlLabel
          control={
            <Switch
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked);
                setPage(0);
              }}
            />
          }
          label="Show dismissed"
        />
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
        Hints worth a look, not proof of cheating. Fast travel, respawning, boss rewards and shared home networks can all trigger them.
      </Typography>
      {body}
    </Section>
  );
}
