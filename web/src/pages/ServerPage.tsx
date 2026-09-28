import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api/client';
import type { ServerStatus } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState, KeyValue, Loading, PageHeader, Section, ServerStateChip } from '../components/common';
import { useToast } from '../components/Toast';
import { formatDuration } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

const COUNTDOWNS = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
];

function ActionCard({ title, children, action, danger }: { title: string; children: ReactNode; action: ReactNode; danger?: boolean }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2.5, gap: 1.5, borderColor: danger ? 'error.main' : undefined }}>
      <Typography variant="h6" component="h2" sx={{ fontSize: 17 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ flexGrow: 1 }}>
        {children}
      </Typography>
      <div>{action}</div>
    </Card>
  );
}

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
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Status" action={<ServerStateChip state={status.state} />}>
            <KeyValue
              items={[
                ['Server', status.info?.name ?? status.connection?.name ?? '—'],
                ['Uptime', status.metrics ? formatDuration(status.metrics.uptimeSeconds) : '—'],
                ['Players', status.metrics ? `${status.metrics.currentPlayers} of ${status.metrics.maxPlayers}` : '—'],
              ]}
            />
            {!online && status.error && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {status.error.message}
              </Alert>
            )}
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ActionCard
            title="Save the world"
            action={
              <Button variant="contained" onClick={save} loading={saving} disabled={!online}>
                Save now
              </Button>
            }
          >
            Writes the world to disk now, without interrupting players. Palworld also autosaves on its own.
          </ActionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ActionCard
            title="Shut down"
            action={
              <Button variant="outlined" onClick={() => setShutdownOpen(true)} disabled={!online}>
                Schedule shutdown…
              </Button>
            }
          >
            Warns players with a countdown, saves the world and stops the server. It stays off until it’s started on the game machine (or restarted
            automatically by your service manager).
          </ActionCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ActionCard
            title="Force stop"
            danger
            action={
              <Button variant="outlined" color="error" onClick={() => setStopOpen(true)} disabled={!online}>
                Force stop
              </Button>
            }
          >
            Stops the server immediately <strong>without saving</strong>. Use only if it’s stuck; progress since the last save is lost.
          </ActionCard>
        </Grid>
      </Grid>

      <Alert severity="info">
        Starting a stopped server isn’t possible through the Palworld REST API. That needs PalOps on the game machine with access to its service
        manager, which is planned.
      </Alert>

      <ShutdownDialog open={shutdownOpen} onClose={() => setShutdownOpen(false)} />
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

function ShutdownDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Schedule a shutdown</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Countdown" value={waitSeconds} onChange={(e) => setWaitSeconds(Number(e.target.value))}>
            {COUNTDOWNS.map((c) => (
              <MenuItem key={c.seconds} value={c.seconds}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Message to players"
            helperText="Shown in game during the countdown."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Server shutting down in ${waitSeconds} seconds`}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={submit} loading={busy}>
          Shut down
        </Button>
      </DialogActions>
    </Dialog>
  );
}
