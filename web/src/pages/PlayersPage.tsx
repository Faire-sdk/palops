import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
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
import type { IpBan, KnownPlayer, LinkRequest, ModerationRecord, PalDefenderBan, PalDefenderResult, PalDefenderStatus, Player, PlayerSignal } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { DataTable } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModerationDialog, PlayerProfileDialog, warnIfPalDefenderFailed } from '../components/PlayerActions';
import { useToast } from '../components/Toast';
import { SignalChip } from '../components/world';
import { formatDateTime, formatDuration } from '../format';
import VerifiedIcon from '@mui/icons-material/Verified';
import LinkIcon from '@mui/icons-material/Link';
import { refreshAll, useApi } from '../hooks/useApi';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All players' },
  { id: 'bans', label: 'Bans' },
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
      {tab === 'links' && <LinkRequests onOpen={setProfile} />}
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} onOpen={setProfile} />
      <ModerationDialog action={target?.action ?? null} userId={target?.userId ?? ''} name={target?.name ?? ''} ip={target?.ip} onClose={() => setTarget(null)} />
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

function Bans({ onOpen, onAction }: { onOpen: (userId: string) => void; onAction: (t: Target) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ bans: ModerationRecord[]; ipBans: IpBan[] }>('/players/bans');
  const [userId, setUserId] = useState('');
  const [ip, setIp] = useState('');
  const [ipReason, setIpReason] = useState('');
  const [busy, setBusy] = useState(false);

  const banIp = async () => {
    setBusy(true);
    try {
      const { ipBan, paldefender } = await api.post<{ ipBan: IpBan; paldefender?: PalDefenderResult }>('/players/ip-bans', { ip, reason: ipReason });
      notify(`${ipBan.ip} is banned`, 'success');
      warnIfPalDefenderFailed(notify, paldefender);
      setIp('');
      setIpReason('');
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const liftIpBan = async (ban: IpBan) => {
    try {
      const res = await api.delete<{ paldefender?: PalDefenderResult }>(`/players/ip-bans/${ban.id}`);
      notify(`${ban.ip} is no longer banned`, 'success');
      warnIfPalDefenderFailed(notify, res?.paldefender);
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
      {can('players.ip') && (
        <Section title={data ? `Address bans (${data.ipBans.length})` : 'Address bans'} disablePadding>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
            The game can only ban platform IDs, so PalOps enforces these itself: anyone who connects from a banned address is kicked within about 20 seconds.
          </Typography>
          {data && (
            <DataTable
              rows={data.ipBans}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No address bans" />}
              columns={[
                { key: 'ip', header: 'Address', render: (b) => <Mono>{b.ip}</Mono> },
                {
                  key: 'player',
                  header: 'From player',
                  render: (b) => (b.playerUserId ? <PlayerName name={b.playerName ?? b.playerUserId} userId={b.playerUserId} onOpen={onOpen} /> : '—'),
                },
                { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
                { key: 'by', header: 'Banned by', render: (b) => b.actorUsername ?? '—' },
                { key: 'at', header: 'When', nowrap: true, render: (b) => formatDateTime(b.createdAt) },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (b) =>
                    can('players.ban') && (
                      <Button size="small" variant="outlined" onClick={() => void liftIpBan(b)}>
                        Lift
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </Section>
      )}
      {can('players.ip') && <PalDefenderBans onOpen={onOpen} />}
      {can('players.ban') && can('players.ip') && (
        <Section title="Ban an address">
          <Stack
            component="form"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'flex-start' } }}
            onSubmit={(e) => {
              e.preventDefault();
              if (ip.trim()) void banIp();
            }}
          >
            <TextField
              label="IP address or range"
              helperText="e.g. 203.0.113.7, or 203.0.113.0/24 for a whole range"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              required
              slotProps={{ htmlInput: { maxLength: 64 } }}
              sx={{ maxWidth: { sm: 300 } }}
            />
            <TextField label="Reason" placeholder="Optional" value={ipReason} onChange={(e) => setIpReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ maxWidth: { sm: 300 } }} />
            <Button variant="contained" color="error" type="submit" loading={busy} sx={{ height: 40 }}>
              Ban
            </Button>
          </Stack>
        </Section>
      )}
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

/**
 * PalDefender's own ban list, when that optional integration is on. It includes
 * bans made in-game, by its anti-cheat and by other tools, which the official
 * REST API can't list.
 */
function PalDefenderBans({ onOpen }: { onOpen: (userId: string) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data: status } = useApi<PalDefenderStatus>('/paldefender/status');
  const enabled = !!status?.enabled;
  const { data, error, loading, reload } = useApi<{ bans: PalDefenderBan[] }>('/paldefender/banlist', { enabled });
  const [lift, setLift] = useState<PalDefenderBan | null>(null);

  if (!enabled) return null;

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <DataTable
        rows={data?.bans ?? []}
        rowKey={(b) => `${b.kind}:${b.id}`}
        empty={<EmptyState icon={PeopleOutlinedIcon} title="No active bans in PalDefender" />}
        columns={[
          { key: 'kind', header: 'Type', render: (b) => <Chip label={b.kind === 'ip' ? 'Address' : 'Player'} variant="outlined" /> },
          { key: 'id', header: 'Who', render: (b) => (b.kind === 'user' ? <PlayerName name={b.id} userId={b.id} onOpen={onOpen} /> : <Mono>{b.id}</Mono>) },
          { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
          { key: 'by', header: 'Banned by', render: (b) => (b.bannedBy ? `${b.bannedBy}${b.bannedVia ? ` (${b.bannedVia})` : ''}` : (b.bannedVia ?? '—')) },
          { key: 'at', header: 'When', nowrap: true, render: (b) => (b.bannedAt ? formatDateTime(b.bannedAt) : '—') },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (b) =>
              can('players.ban') && (
                <Button size="small" variant="outlined" onClick={() => setLift(b)}>
                  Unban
                </Button>
              ),
          },
        ]}
      />
    );
  }

  return (
    <Section title={data ? `PalDefender ban list (${data.bans.length})` : 'PalDefender ban list'} disablePadding>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
        Straight from PalDefender, so it includes bans made in-game, by its anti-cheat and by other tools. Unbanning here only changes PalDefender’s list; to fully
        unban someone banned from PalOps, use Unban in the first list above.
      </Typography>
      {body}
      <ConfirmDialog
        open={!!lift}
        title={`Unban ${lift?.id ?? ''} in PalDefender?`}
        message={lift?.kind === 'ip' ? 'Accounts on this address can connect again unless PalOps also bans it.' : 'They can connect again unless the game’s own ban list or a PalOps address ban still stops them.'}
        confirmLabel="Unban"
        onClose={() => setLift(null)}
        onConfirm={async () => {
          try {
            await api.post(lift!.kind === 'ip' ? '/paldefender/unbanip' : '/paldefender/unban', lift!.kind === 'ip' ? { ip: lift!.id } : { userId: lift!.id });
            notify(`${lift!.id} was unbanned in PalDefender`, 'success');
            reload();
          } catch (err) {
            notify(errorMessage(err), 'error');
          }
        }}
      />
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
