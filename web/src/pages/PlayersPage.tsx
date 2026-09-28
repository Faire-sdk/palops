import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import type { Player } from '../api/types';
import { Table } from '../components/Table';
import { Card, EmptyState, ErrorState, Input, Loading, PageHeader } from '../components/ui';
import { useApi } from '../hooks/useApi';

export function PlayersPage() {
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
          { key: 'name', header: 'Player', render: (p) => <strong>{p.name}</strong> },
          { key: 'level', header: 'Level', render: (p) => p.level ?? '—' },
          { key: 'userId', header: 'Platform ID', render: (p) => <span className="mono">{p.userId}</span> },
          { key: 'playerId', header: 'Player ID', render: (p) => <span className="mono muted">{p.playerId}</span> },
          { key: 'ping', header: 'Ping', render: (p) => (p.ping !== null ? `${Math.round(p.ping)} ms` : '—') },
        ]}
      />
    );
  }

  return (
    <>
      <PageHeader title="Players" description="Players currently on the server. History, profiles and moderation come next." />
      <Card
        title={data ? `Online (${data.players.length})` : 'Online'}
        actions={<Input placeholder="Search players…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />}
      >
        {body}
      </Card>
    </>
  );
}
