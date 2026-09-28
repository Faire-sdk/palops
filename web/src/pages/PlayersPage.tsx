import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api/client';
import type { KnownPlayer, ModerationRecord, Player, PlayerSignal } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { DataTable } from '../components/DataTable';
import { ModerationDialog, PlayerProfileDialog } from '../components/PlayerActions';
import { useToast } from '../components/Toast';
import { SignalChip } from '../components/world';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All players' },
  { id: 'bans', label: 'Bans' },
  { id: 'signals', label: 'Signals' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Target = { action: 'kick' | 'ban' | 'unban'; userId: string; name: string };

export function PlayersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => t.id !== 'signals' || can('world.view'));
  const tab: TabId = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'online';
  const [profile, setProfile] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  return (
    <>
      <PageHeader title="Players" description="Who’s online, everyone the panel has seen, and bans made from the panel." />
      <Tabs value={tab} onChange={(_, v: TabId) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      {tab === 'online' && <OnlinePlayers onOpen={setProfile} onAction={setTarget} />}
      {tab === 'all' && <AllPlayers onOpen={setProfile} />}
      {tab === 'bans' && <Bans onOpen={setProfile} onAction={setTarget} />}
      {tab === 'signals' && <Signals onOpen={setProfile} />}
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} />
      <ModerationDialog action={target?.action ?? null} userId={target?.userId ?? ''} name={target?.name ?? ''} onClose={() => setTarget(null)} />
    </>
  );
}

function PlayerName({ name, userId, onOpen }: { name: string; userId: string; onOpen: (userId: string) => void }) {
  return (
    <Link component="button" underline="hover" onClick={() => onOpen(userId)} sx={{ fontWeight: 600, textAlign: 'left' }}>
      {name}
    </Link>
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
    return q ? list.filter((p) => [p.name, p.accountName, p.userId, p.playerId].some((v) => v.toLowerCase().includes(q))) : list;
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
          { key: 'name', header: 'Player', render: (p) => <PlayerName name={p.name} userId={p.userId} onOpen={onOpen} /> },
          { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
          { key: 'guild', header: 'Guild', render: (p) => p.guild ?? '—' },
          { key: 'userId', header: 'Platform ID', render: (p) => <Mono>{p.userId}</Mono> },
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
                  <Button size="small" variant="outlined" color="error" onClick={() => onAction({ action: 'ban', userId: p.userId, name: p.name })}>
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
  const search = query.trim();
  const path = `/players/known?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
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
                  {p.online && <Chip label="Online" color="success" variant="outlined" />}
                  {p.banned && <Chip label="Banned" color="error" variant="outlined" />}
                </Stack>
              ),
            },
            { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
            { key: 'guild', header: 'Guild', render: (p) => p.guild ?? '—' },
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
      {body}
    </Section>
  );
}

function Bans({ onOpen, onAction }: { onOpen: (userId: string) => void; onAction: (t: Target) => void }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<{ bans: ModerationRecord[] }>('/players/bans');
  const [userId, setUserId] = useState('');

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <DataTable
        rows={data?.bans ?? []}
        rowKey={(b) => b.id}
        empty={<EmptyState icon={PeopleOutlinedIcon} title="No bans from the panel" />}
        columns={[
          { key: 'name', header: 'Player', render: (b) => <PlayerName name={b.playerName ?? b.playerUserId} userId={b.playerUserId} onOpen={onOpen} /> },
          { key: 'userId', header: 'Platform ID', render: (b) => <Mono>{b.playerUserId}</Mono> },
          { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
          { key: 'by', header: 'Banned by', render: (b) => b.actorUsername ?? '—' },
          { key: 'at', header: 'When', nowrap: true, render: (b) => formatDateTime(b.createdAt) },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (b) =>
              can('players.ban') && (
                <Button size="small" variant="outlined" onClick={() => onAction({ action: 'unban', userId: b.playerUserId, name: b.playerName ?? b.playerUserId })}>
                  Unban
                </Button>
              ),
          },
        ]}
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Section title={data ? `Bans (${data.bans.length})` : 'Bans'} disablePadding>
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
          Only bans made from PalOps are listed. The REST API can’t read bans made in-game or through a shared ban list.
        </Typography>
        {body}
      </Section>
      {can('players.ban') && (
        <Section title="Ban by platform ID">
          <Stack
            component="form"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'flex-start' } }}
            onSubmit={(e) => {
              e.preventDefault();
              if (userId.trim()) onAction({ action: 'ban', userId: userId.trim(), name: userId.trim() });
            }}
          >
            <TextField
              label="Platform ID"
              helperText="For someone who isn’t online, e.g. steam_76561198000000000"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              slotProps={{ htmlInput: { pattern: '[A-Za-z0-9_.:\\-]{1,80}' } }}
              sx={{ maxWidth: { sm: 420 } }}
            />
            <Button variant="contained" color="error" type="submit" sx={{ height: 40 }}>
              Ban
            </Button>
          </Stack>
        </Section>
      )}
    </Stack>
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
