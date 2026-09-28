import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { PalBanBan, PalBanPlayer, PalBanSettings, PalBanStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { DataTable } from './DataTable';
import { EmptyState, ErrorState, Loading, Mono, Section } from './common';
import { ExportButton, PlayerName } from './PlayerBits';
import { useToast } from './Toast';

interface Form {
  enabled: boolean;
  baseUrl: string;
  key: string;
  autoBan: boolean;
  sendEvents: boolean;
  checkJoins: boolean;
}

/** The optional PalBan Network integration: off until an owner switches it on. */
export function PalBanSettingsTab() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ settings: PalBanSettings | null; status: PalBanStatus }>('/palban/settings');
  const [form, setForm] = useState<Form>({ enabled: false, baseUrl: '', key: '', autoBan: false, sendEvents: true, checkJoins: true });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<{ serverName: string; integrationName: string; missingScopes: string[] }>();

  useEffect(() => {
    const s = data?.settings;
    if (s) setForm({ enabled: s.enabled, baseUrl: s.baseUrl, key: '', autoBan: s.autoBan, sendEvents: s.sendEvents, checkJoins: s.checkJoins });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const hasKey = !!data?.settings?.hasKey;
  const status = data?.status;
  const run = async (kind: 'save' | 'test') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setTest(await api.post('/palban/test', { baseUrl: form.baseUrl, key: form.key || undefined }));
      } else {
        await api.put('/palban/settings', { ...form, key: form.key || undefined });
        notify(form.enabled ? 'PalBan Network saved and switched on' : 'PalBan Network saved (switched off)', 'success');
        setTest(undefined);
        await reload();
        refreshAll();
      }
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="PalBan Network (optional)">
          <Stack
            component="form"
            spacing={2}
            onSubmit={(e) => {
              e.preventDefault();
              void run('save');
            }}
          >
            <Typography variant="body2" color="text.secondary">
              PalBan Network is a shared banlist for Palworld servers. Switch this on to compare your server’s PalBan banlist with what is banned in the game, see what other servers
              found about a player, and let PalBan know about joins and bans made here. Nothing is banned because another server did: reports are leads for your team.
            </Typography>
            <FormControlLabel control={<Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />} label="Use PalBan Network" />
            <TextField label="PalBan Network address" placeholder="https://palban.net" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required />
            <TextField
              label="Integration key"
              type="password"
              autoComplete="off"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              required={!hasKey}
              helperText={hasKey ? 'A key is saved. Leave blank to keep it.' : 'Made on your server’s Integrations tab in PalBan Network (choose “Another tool”). It’s shown once.'}
            />
            <FormControlLabel control={<Switch checked={form.checkJoins} onChange={(e) => setForm({ ...form, checkJoins: e.target.checked })} />} label="Look players up on the network when they join" />
            <FormControlLabel control={<Switch checked={form.sendEvents} onChange={(e) => setForm({ ...form, sendEvents: e.target.checked })} />} label="Tell PalBan about joins, leaves and bans (never addresses)" />
            <FormControlLabel
              control={<Switch checked={form.autoBan} onChange={(e) => setForm({ ...form, autoBan: e.target.checked })} />}
              label={
                <>
                  Ban in the game whatever is banned on my PalBan banlist
                  <Typography variant="body2" color="text.secondary">
                    Only bans on your own server’s PalBan list, which your team manages. Bans PalOps applied are lifted again when PalBan lifts them. Off by default: otherwise use
                    “Ban in game” on the Bans page, one at a time.
                  </Typography>
                </>
              }
              sx={{ alignItems: 'flex-start', '& .MuiSwitch-root': { mt: 0.5 } }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" type="submit" loading={busy === 'save'}>
                Save
              </Button>
              <Button variant="outlined" type="button" onClick={() => run('test')} loading={busy === 'test'} disabled={!form.baseUrl || (!form.key && !hasKey)}>
                Test key
              </Button>
            </Stack>
            {test && (
              <Alert severity={test.missingScopes.length ? 'warning' : 'success'}>
                Key for <strong>{test.serverName}</strong> ({test.integrationName}).
                {test.missingScopes.length ? ` Missing permissions: ${test.missingScopes.join(', ')}.` : ' It has the permissions PalOps uses.'}
              </Alert>
            )}
            {status?.enabled && (
              <Alert severity={status.error ? 'warning' : 'info'} icon={false}>
                {status.error
                  ? `Last problem: ${status.error}`
                  : status.lastSyncAt
                    ? `Connected to ${status.serverName ?? 'PalBan Network'}. Banlist read ${formatDateTime(status.lastSyncAt)}: ${status.bans.active} active of ${status.bans.total} bans.`
                    : 'Switched on. The banlist is read within a minute.'}
              </Alert>
            )}
          </Stack>
        </Section>
      </Grid>
    </Grid>
  );
}

/** The server's PalBan banlist next to the game's, with one-click banning in the game. */
export function PalBanBans({ onOpen }: { onOpen: (userId: string) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ enabled: boolean; status: PalBanStatus; bans: PalBanBan[]; onlyHere: Array<{ userId: string; name: string | null; reason: string | null; bannedAt: string }> }>('/palban/bans', { pollMs: 60000 });
  const [busy, setBusy] = useState<string | null>(null);

  if (!data?.enabled) return null;
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      notify(done, 'success');
      await reload();
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const { status } = data;
  return (
    <Stack spacing={2}>
      <Section
        title={`PalBan Network banlist (${status.bans.active} active)`}
        disablePadding
        action={
          can('players.ban') && (
            <Button size="small" variant="outlined" loading={busy === 'sync'} onClick={() => act('sync', () => api.post('/palban/sync'), 'Banlist read from PalBan Network')}>
              Read now
            </Button>
          )
        }
      >
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
          Your server’s own banlist on PalBan Network{status.serverName ? ` (${status.serverName})` : ''}
          {status.lastSyncAt ? `, read ${formatDateTime(status.lastSyncAt)}` : ''}. {status.notInGame > 0 ? `${status.notInGame} active ${status.notInGame === 1 ? 'ban isn’t' : 'bans aren’t'} banned in the game yet.` : 'Everything active is banned in the game.'}
        </Typography>
        {status.error && (
          <Alert severity="warning" sx={{ mx: 2, mt: 1 }}>
            {status.error}
          </Alert>
        )}
        <DataTable
          rows={data.bans}
          rowKey={(b) => b.id}
          empty={<EmptyState title="No bans read yet" />}
          columns={[
            { key: 'player', header: 'Player', render: (b) => (b.active || b.inGame ? <PlayerName name={b.playerName ?? b.gameId} userId={b.gameId} onOpen={onOpen} /> : (b.playerName ?? '—')) },
            { key: 'id', header: 'Game ID', render: (b) => <Mono>{b.gameId}</Mono> },
            { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
            { key: 'category', header: 'Category', render: (b) => (b.category ? b.category.charAt(0) + b.category.slice(1).toLowerCase().replace(/_/g, ' ') : '—') },
            { key: 'status', header: 'On PalBan', render: (b) => <Chip label={b.status.toLowerCase()} color={b.active ? 'error' : 'default'} variant="outlined" /> },
            {
              key: 'game',
              header: 'In the game',
              render: (b) => (b.inGame ? <Chip label={b.applied ? 'Banned by PalBan' : 'Banned'} color="success" variant="outlined" /> : b.active ? <Chip label="Not banned" color="warning" variant="outlined" /> : '—'),
            },
            { key: 'at', header: 'Banned', nowrap: true, render: (b) => (b.banDate ? formatDateTime(b.banDate) : '—') },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (b) =>
                can('players.ban') &&
                b.active &&
                !b.inGame && (
                  <Button size="small" variant="outlined" color="error" loading={busy === b.id} onClick={() => act(b.id, () => api.post(`/palban/bans/${encodeURIComponent(b.id)}/apply`), `${b.playerName ?? b.gameId} was banned in the game`)}>
                    Ban in game
                  </Button>
                ),
            },
          ]}
        />
      </Section>
      {can('players.ban') && (
        <Section title={`Banned here, not on PalBan (${data.onlyHere.length})`} disablePadding action={<ExportButton path="/palban/export.csv" label="Export for PalBan" />}>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
            Players banned in the game from PalOps who aren’t on your PalBan banlist. Export them as a CSV and import it on PalBan Network’s Banlist tab if you want them there.
          </Typography>
          <DataTable
            rows={data.onlyHere}
            rowKey={(b) => b.userId}
            empty={<EmptyState title="Nothing to add" />}
            columns={[
              { key: 'player', header: 'Player', render: (b) => <PlayerName name={b.name ?? b.userId} userId={b.userId} onOpen={onOpen} /> },
              { key: 'id', header: 'Game ID', render: (b) => <Mono>{b.userId}</Mono> },
              { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
              { key: 'at', header: 'Banned', nowrap: true, render: (b) => formatDateTime(b.bannedAt) },
            ]}
          />
        </Section>
      )}
    </Stack>
  );
}

/** What PalBan Network knows about a player, for a profile. Reports from other servers are leads, not a verdict. */
export function PalBanPlayerSection({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useApi<{ player: PalBanPlayer }>(`/palban/players/${encodeURIComponent(userId)}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert severity="warning">PalBan Network: {error.message}</Alert>;
  const p = data!.player;
  const n = p.network;
  return (
    <>
      <Divider />
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          PalBan Network
        </Typography>
        {p.localBanStatus === 'BANNED' && <Chip label="Banned on your PalBan list" color="error" />}
        {p.localBanStatus === 'PREVIOUSLY_BANNED' && <Chip label="Banned here before" color="warning" variant="outlined" />}
        {n.activeReportCount > 0 ? <Chip label={`${n.activeReportCount} active ${n.activeReportCount === 1 ? 'ban' : 'bans'} on ${n.serversReporting} other ${n.serversReporting === 1 ? 'server' : 'servers'}`} color="warning" /> : <Chip label="No reports from other servers" variant="outlined" />}
        <Button size="small" onClick={() => void reload()}>
          Refresh
        </Button>
      </Stack>
      {n.reports.length > 0 && (
        <Stack spacing={0.5}>
          {n.reports.map((r, i) => (
            <Typography key={i} variant="body2">
              <strong>{r.server}</strong>: {r.reason ?? 'No reason given'} · {r.status.toLowerCase()}
              {r.banDate ? ` · ${formatDateTime(r.banDate)}` : ''}
            </Typography>
          ))}
          <Typography variant="body2" color="text.secondary">
            Other servers’ bans are information to review with the player’s history, not proof. PalOps doesn’t ban anyone because of them.
          </Typography>
        </Stack>
      )}
      {p.detections.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Anticheat detections your integrations sent:{' '}
          {p.detections
            .slice(0, 3)
            .map((d) => `${d.type ?? 'unknown'}${d.severity ? ` (${d.severity.toLowerCase()})` : ''}${d.detectedAt ? ` ${formatDateTime(d.detectedAt)}` : ''}`)
            .join(' · ')}
        </Typography>
      )}
    </>
  );
}
