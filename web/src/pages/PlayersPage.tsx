import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { KnownPlayer, ModerationRecord, Player } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ModerationDialog, PlayerProfileModal } from '../components/PlayerActions';
import { Table } from '../components/Table';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader } from '../components/ui';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All players' },
  { id: 'bans', label: 'Bans' },
] as const;
type Tab = (typeof TABS)[number]['id'];

type Target = { action: 'kick' | 'ban' | 'unban'; userId: string; name: string };

export function PlayersPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'online';
  const [profile, setProfile] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  return (
    <>
      <PageHeader title="Players" description="Who’s online, everyone the panel has seen, and bans made from the panel." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setParams({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'online' && <OnlinePlayers onOpen={setProfile} onAction={setTarget} />}
      {tab === 'all' && <AllPlayers onOpen={setProfile} />}
      {tab === 'bans' && <Bans onOpen={setProfile} onAction={setTarget} />}
      <PlayerProfileModal userId={profile} onClose={() => setProfile(null)} />
      <ModerationDialog action={target?.action ?? null} userId={target?.userId ?? ''} name={target?.name ?? ''} onClose={() => setTarget(null)} />
    </>
  );
}

function PlayerName({ name, userId, onOpen }: { name: string; userId: string; onOpen: (userId: string) => void }) {
  return (
    <button className="link-btn" onClick={() => onOpen(userId)}>
      {name}
    </button>
  );
}

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
    const offline = error instanceof ApiError && ['palworld_unreachable', 'palworld_not_configured'].includes(error.code);
    body = offline ? <EmptyState icon="server" title="Server unavailable">{error.message}</EmptyState> : <ErrorState error={error} onRetry={reload} />;
  } else {
    body = (
      <Table
        rows={players}
        rowKey={(p) => p.userId || p.playerId}
        empty={<EmptyState icon="players" title={query ? 'No matching players' : 'Nobody is online right now'} />}
        columns={[
          { key: 'name', header: 'Player', render: (p) => <PlayerName name={p.name} userId={p.userId} onOpen={onOpen} /> },
          { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
          { key: 'userId', header: 'Platform ID', render: (p) => <span className="mono">{p.userId}</span> },
          { key: 'buildings', header: 'Buildings', render: (p) => p.buildingCount ?? '—' },
          { key: 'ping', header: 'Ping', render: (p) => (p.ping !== null ? `${Math.round(p.ping)} ms` : '—') },
          {
            key: 'actions',
            header: '',
            className: 'actions-cell',
            render: (p) => (
              <div className="button-row">
                {can('players.kick') && (
                  <Button onClick={() => onAction({ action: 'kick', userId: p.userId, name: p.name })}>Kick</Button>
                )}
                {can('players.ban') && (
                  <Button variant="danger" onClick={() => onAction({ action: 'ban', userId: p.userId, name: p.name })}>
                    Ban
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    );
  }

  return (
    <Card
      title={data ? `Online (${data.players.length})` : 'Online'}
      actions={<Input placeholder="Search players…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />}
    >
      {body}
    </Card>
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
        <Table
          rows={data?.players ?? []}
          rowKey={(p) => p.id}
          empty={<EmptyState icon="players" title={search ? 'No matching players' : 'No players seen yet'}>{!search && 'Players are recorded once a minute while they’re online.'}</EmptyState>}
          columns={[
            {
              key: 'name',
              header: 'Player',
              render: (p) => (
                <span className="inline-row">
                  <PlayerName name={p.name} userId={p.userId} onOpen={onOpen} />
                  {p.online && <Badge tone="success">Online</Badge>}
                  {p.banned && <Badge tone="error">Banned</Badge>}
                </span>
              ),
            },
            { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
            { key: 'guild', header: 'Guild', render: (p) => p.guild ?? <span className="muted">—</span> },
            { key: 'userId', header: 'Platform ID', render: (p) => <span className="mono">{p.userId}</span> },
            { key: 'lastSeen', header: 'Last seen', render: (p) => <span className="nowrap">{formatDateTime(p.lastSeenAt)}</span> },
          ]}
        />
        {pages > 1 && (
          <div className="pager">
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="muted">
              Page {page + 1} of {pages}
            </span>
            <Button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <Card
      title={data ? `All players (${data.total})` : 'All players'}
      actions={
        <Input
          placeholder="Search name, ID or guild…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          aria-label="Search all players"
        />
      }
    >
      {body}
    </Card>
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
      <Table
        rows={data?.bans ?? []}
        rowKey={(b) => b.id}
        empty={<EmptyState icon="players" title="No bans from the panel" />}
        columns={[
          { key: 'name', header: 'Player', render: (b) => <PlayerName name={b.playerName ?? b.playerUserId} userId={b.playerUserId} onOpen={onOpen} /> },
          { key: 'userId', header: 'Platform ID', render: (b) => <span className="mono">{b.playerUserId}</span> },
          { key: 'reason', header: 'Reason', render: (b) => b.reason ?? <span className="muted">—</span> },
          { key: 'by', header: 'Banned by', render: (b) => b.actorUsername ?? '—' },
          { key: 'at', header: 'When', render: (b) => <span className="nowrap">{formatDateTime(b.createdAt)}</span> },
          {
            key: 'actions',
            header: '',
            className: 'actions-cell',
            render: (b) =>
              can('players.ban') && (
                <Button onClick={() => onAction({ action: 'unban', userId: b.playerUserId, name: b.playerName ?? b.playerUserId })}>Unban</Button>
              ),
          },
        ]}
      />
    );
  }

  return (
    <div className="grid">
      <Card title={data ? `Bans (${data.bans.length})` : 'Bans'}>
        <p className="muted small card-note">
          Only bans made from PalOps are listed. The REST API can’t read bans made in-game or through a shared ban list.
        </p>
        {body}
      </Card>
      {can('players.ban') && (
        <Card title="Ban by platform ID">
          <p className="muted small card-note">For someone who isn’t online, e.g. steam_76561198000000000.</p>
          <form
            className="inline-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (userId.trim()) onAction({ action: 'ban', userId: userId.trim(), name: userId.trim() });
            }}
          >
            <Input aria-label="Platform ID" placeholder="Platform ID" value={userId} onChange={(e) => setUserId(e.target.value)} pattern="[A-Za-z0-9_.:\-]{1,80}" required />
            <Button variant="danger" type="submit">
              Ban
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
