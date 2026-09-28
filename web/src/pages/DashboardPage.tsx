import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { ServerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { ServerStateBadge } from '../components/ServerStateBadge';
import { useToast } from '../components/Toast';
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Stat } from '../components/ui';
import { formatDateTime, formatDuration } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

export function DashboardPage() {
  const { can } = useAuth();
  const { data: status, error, loading, reload } = useApi<ServerStatus>('/server/status', { pollMs: 10000 });
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  if (loading && !status) return <Loading />;
  if (error && !status) return <ErrorState error={error} onRetry={reload} />;
  if (!status) return null;

  if (status.state === 'unconfigured') {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <EmptyState icon="server" title="No server connected yet">
            {can('server.connection') ? (
              <p>
                Add your Palworld server’s REST API details in <Link to="/settings?tab=connection">Settings</Link> to get started.
              </p>
            ) : (
              <p>Ask a panel owner to connect the Palworld server.</p>
            )}
          </EmptyState>
        </Card>
      </>
    );
  }

  const online = status.state === 'online';
  const m = status.metrics;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Last checked ${formatDateTime(status.checkedAt)}`}
        actions={
          <>
            <Button icon="refresh" onClick={() => api.get('/server/status?fresh=1').then(refreshAll)}>
              Refresh
            </Button>
            {can('server.broadcast') && (
              <Button variant="primary" icon="megaphone" disabled={!online} onClick={() => setBroadcastOpen(true)}>
                Broadcast
              </Button>
            )}
          </>
        }
      />

      {status.error && (
        <Alert tone={status.state === 'offline' ? 'warning' : 'error'}>
          {status.state === 'offline' ? 'The server is offline or unreachable. ' : ''}
          {status.error.message}
        </Alert>
      )}

      <div className="grid grid-3">
        <Card title="Server" actions={<ServerStateBadge state={status.state} />}>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{status.info?.name ?? status.connection?.name}</dd>
            <dt>Address</dt>
            <dd className="mono">{status.connection?.adapter === 'mock' ? 'mock server' : `${status.connection?.host}:${status.connection?.port}`}</dd>
            <dt>Version</dt>
            <dd>{status.info?.version ?? '—'}</dd>
            <dt>Uptime</dt>
            <dd>{m ? formatDuration(m.uptimeSeconds) : '—'}</dd>
            {status.info?.description && (
              <>
                <dt>Description</dt>
                <dd>{status.info.description}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card title="Players" actions={can('players.view') && <Link to="/players">View all</Link>}>
          <div className="stats">
            <Stat label="Online" value={m ? m.currentPlayers : '—'} hint={m ? `of ${m.maxPlayers} slots` : undefined} />
            <Stat label="In-game day" value={m?.inGameDays ?? '—'} />
            <Stat label="Base camps" value={m?.baseCampCount ?? '—'} />
          </div>
        </Card>

        <Card title="Performance">
          <div className="stats">
            <Stat label="Server FPS" value={m ? m.fps : '—'} />
            <Stat label="Frame time" value={m ? `${m.frameTimeMs.toFixed(1)} ms` : '—'} />
          </div>
          <p className="muted small">CPU and memory usage will appear once host monitoring is added.</p>
        </Card>
      </div>

      <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </>
  );
}

function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useToast();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.post('/server/announce', { message });
      notify('Message broadcast to all players', 'success');
      setMessage('');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Broadcast message"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!message.trim()}>
            Send
          </Button>
        </>
      }
    >
      <Field label="Message" hint={`${message.length}/200 · shown to everyone on the server`}>
        <Input autoFocus maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
    </Modal>
  );
}
