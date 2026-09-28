import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { ServerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, KeyValue, Loading, Mono, PageHeader, Section, ServerStateChip, Stat } from '../components/common';
import { useToast } from '../components/Toast';
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
        <Section>
          <EmptyState icon={DnsOutlinedIcon} title="No server connected yet">
            {can('server.connection') ? (
              <>
                Add your Palworld server’s REST API details in{' '}
                <Link component={RouterLink} to="/settings?tab=connection">
                  Settings
                </Link>{' '}
                to get started.
              </>
            ) : (
              'Ask a panel owner to connect the Palworld server.'
            )}
          </EmptyState>
        </Section>
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
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => api.get('/server/status?fresh=1').then(refreshAll)}>
              Refresh
            </Button>
            {can('server.broadcast') && (
              <Button variant="contained" startIcon={<CampaignOutlinedIcon />} disabled={!online} onClick={() => setBroadcastOpen(true)}>
                Broadcast
              </Button>
            )}
          </>
        }
      />

      {status.error && (
        <Alert severity={status.state === 'offline' ? 'warning' : 'error'} sx={{ mb: 2 }}>
          {status.state === 'offline' ? 'The server is offline or unreachable. ' : ''}
          {status.error.message}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Section title="Server" action={<ServerStateChip state={status.state} />}>
            <KeyValue
              items={[
                ['Name', status.info?.name ?? status.connection?.name],
                ['Address', <Mono>{status.connection?.adapter === 'mock' ? 'mock server' : `${status.connection?.host}:${status.connection?.port}`}</Mono>],
                ['Version', status.info?.version ?? '—'],
                ['Uptime', m ? formatDuration(m.uptimeSeconds) : '—'],
                !!status.info?.description && ['Description', status.info.description],
              ]}
            />
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Section
            title="Players"
            action={
              can('players.view') && (
                <Button component={RouterLink} to="/players" size="small">
                  View all
                </Button>
              )
            }
          >
            <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Stat label="Online" value={m ? m.currentPlayers : '—'} hint={m ? `of ${m.maxPlayers} slots` : undefined} />
              <Stat label="In-game day" value={m?.inGameDays ?? '—'} />
              <Stat label="Base camps" value={m?.baseCampCount ?? '—'} />
            </Stack>
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Section title="Performance">
            <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
              <Stat label="Server FPS" value={m ? m.fps : '—'} />
              <Stat label="Frame time" value={m ? `${m.frameTimeMs.toFixed(1)} ms` : '—'} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              CPU and memory usage will appear once host monitoring is added.
            </Typography>
          </Section>
        </Grid>
      </Grid>

      <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </>
  );
}

function BroadcastDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Broadcast message</DialogTitle>
      <DialogContent>
        <TextField
          label="Message"
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          helperText={`${message.length}/200 · shown to everyone on the server`}
          slotProps={{ htmlInput: { maxLength: 200 } }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={send} loading={busy} disabled={!message.trim()}>
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
