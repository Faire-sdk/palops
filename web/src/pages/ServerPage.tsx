import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { ServerStatus } from '../api/types';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ServerStateBadge } from '../components/ServerStateBadge';
import { useToast } from '../components/Toast';
import { Alert, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select } from '../components/ui';
import { formatDuration } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

const COUNTDOWNS = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
];

export function ServerPage() {
  const notify = useToast();
  const { data: status, error, loading, reload } = useApi<ServerStatus>('/server/status', { pollMs: 10000 });
  const [saving, setSaving] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);

  if (loading && !status) return <Loading />;
  if (error && !status) return <ErrorState error={error} onRetry={reload} />;
  if (!status) return null;
  const online = status.state === 'online';

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/server/save');
      notify('World saved', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Server" description="Save the world or shut the server down. Every action is recorded in the audit log." />
      <div className="grid grid-2">
        <Card title="Status" actions={<ServerStateBadge state={status.state} />}>
          <dl className="kv">
            <dt>Server</dt>
            <dd>{status.info?.name ?? status.connection?.name ?? '—'}</dd>
            <dt>Uptime</dt>
            <dd>{status.metrics ? formatDuration(status.metrics.uptimeSeconds) : '—'}</dd>
            <dt>Players</dt>
            <dd>{status.metrics ? `${status.metrics.currentPlayers} of ${status.metrics.maxPlayers}` : '—'}</dd>
          </dl>
          {!online && status.error && <Alert tone="warning">{status.error.message}</Alert>}
        </Card>

        <Card title="Save the world">
          <p className="muted">Writes the world to disk now, without interrupting players. Palworld also autosaves on its own.</p>
          <Button variant="primary" onClick={save} loading={saving} disabled={!online}>
            Save now
          </Button>
        </Card>

        <Card title="Shut down">
          <p className="muted">
            Warns players with a countdown, saves the world and stops the server. It stays off until it’s started on the game machine
            (or restarted automatically by your service manager).
          </p>
          <Button onClick={() => setShutdownOpen(true)} disabled={!online}>
            Schedule shutdown…
          </Button>
        </Card>

        <Card title="Force stop" className="danger-zone">
          <p className="muted">Stops the server immediately <strong>without saving</strong>. Use only if it’s stuck; progress since the last save is lost.</p>
          <Button variant="danger" onClick={() => setStopOpen(true)} disabled={!online}>
            Force stop
          </Button>
        </Card>
      </div>

      <Alert tone="info">
        Starting a stopped server isn’t possible through the Palworld REST API. That needs PalOps on the game machine with access to
        its service manager, which is planned.
      </Alert>

      <ShutdownModal open={shutdownOpen} onClose={() => setShutdownOpen(false)} />
      <ConfirmDialog
        open={stopOpen}
        danger
        title="Force stop the server?"
        confirmLabel="Force stop"
        message="Everyone is disconnected at once and anything since the last save is lost."
        onClose={() => setStopOpen(false)}
        onConfirm={async () => {
          try {
            await api.post('/server/stop');
            notify('Server stopped', 'success');
            refreshAll();
          } catch (err) {
            notify(errorMessage(err), 'error');
          }
        }}
      />
    </>
  );
}

function ShutdownModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useToast();
  const [waitSeconds, setWaitSeconds] = useState(60);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/server/shutdown', { waitSeconds, message });
      notify('Shutdown scheduled', 'success');
      setMessage('');
      refreshAll();
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
      title="Schedule a shutdown"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            Shut down
          </Button>
        </>
      }
    >
      <div className="form">
        <Field label="Countdown">
          <Select value={waitSeconds} onChange={(e) => setWaitSeconds(Number(e.target.value))}>
            {COUNTDOWNS.map((c) => (
              <option key={c.seconds} value={c.seconds}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Message to players" hint="Shown in game during the countdown.">
          <Input
            maxLength={200}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Server shutting down in ${waitSeconds} seconds`}
          />
        </Field>
      </div>
    </Modal>
  );
}
