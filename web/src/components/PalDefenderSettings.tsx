import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { PalDefenderCheck, PalDefenderSettings, PalDefenderStatus } from '../api/types';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { ErrorState, Loading, Mono, Section } from './common';
import { useToast } from './Toast';

const TOKEN_FILE = `{
  "Name": "PalOps",
  "Token": "<a long random string>",
  "Permissions": [
    "REST.Version.Read",
    "REST.Players.Read",
    "REST.Banlist.Read",
    "REST.Punishments.Ban",
    "REST.Punishments.Unban",
    "REST.Punishments.BanIP",
    "REST.Punishments.UnbanIP",
    "REST.Guilds.Read",
    "REST.Guild.Read",
    "REST.Pals.Read",
    "REST.Items.Read",
    "REST.Techs.Read",
    "REST.Progression.Read"
  ]
}`;

interface Form {
  enabled: boolean;
  host: string;
  port: string;
  useTls: boolean;
  token: string;
}

/** The optional PalDefender integration: off until an owner switches it on. */
export function PalDefenderSettingsTab() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ settings: PalDefenderSettings | null; status: PalDefenderStatus }>('/paldefender/settings');
  const [form, setForm] = useState<Form>({ enabled: false, host: '127.0.0.1', port: '17993', useTls: false, token: '' });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<{ version: string | null; checks: PalDefenderCheck[] }>();

  useEffect(() => {
    const s = data?.settings;
    if (s) setForm({ enabled: s.enabled, host: s.host, port: String(s.port), useTls: s.useTls, token: '' });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const set = (key: 'host' | 'port' | 'token') => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const connection = () => ({ host: form.host, port: Number(form.port), useTls: form.useTls, token: form.token || undefined });

  const run = async (kind: 'save' | 'test') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setTest(await api.post('/paldefender/test', connection()));
      } else {
        await api.put('/paldefender/settings', { ...connection(), enabled: form.enabled });
        notify(form.enabled ? 'PalDefender integration saved and switched on' : 'PalDefender integration saved (switched off)', 'success');
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

  const status = data?.status;
  const hasToken = !!data?.settings?.hasToken;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="PalDefender (optional)">
          <Stack
            component="form"
            spacing={2}
            onSubmit={(e) => {
              e.preventDefault();
              void run('save');
            }}
          >
            <Typography variant="body2" color="text.secondary">
              PalOps works fully without PalDefender. Switch this on if your Windows server runs the{' '}
              <Link href="https://ultimeit.github.io/PalDefender/" target="_blank" rel="noopener noreferrer">
                PalDefender
              </Link>{' '}
              plugin and you want its ban list and native IP bans in the panel.
            </Typography>
            <FormControlLabel control={<Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />} label="Use PalDefender" />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Host" helperText="Where PalDefender’s REST API listens" value={form.host} onChange={set('host')} required />
              <TextField label="Port" type="number" value={form.port} onChange={set('port')} required sx={{ maxWidth: { sm: 160 } }} slotProps={{ htmlInput: { min: 1, max: 65535 } }} />
            </Stack>
            <FormControlLabel
              control={<Switch checked={form.useTls} onChange={(e) => setForm({ ...form, useTls: e.target.checked })} />}
              label="Connect over HTTPS (when PalDefender is behind a reverse proxy with TLS)"
            />
            <TextField
              label="API token"
              type="password"
              autoComplete="off"
              value={form.token}
              onChange={set('token')}
              required={!hasToken}
              helperText={hasToken ? 'A token is saved. Leave blank to keep it.' : 'The Token from a file in PalDefender/RESTAPI/Tokens'}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" type="submit" loading={busy === 'save'}>
                Save
              </Button>
              <Button variant="outlined" type="button" onClick={() => run('test')} loading={busy === 'test'} disabled={!form.host || (!form.token && !hasToken)}>
                Test connection
              </Button>
            </Stack>
            {test && (
              <Stack spacing={1}>
                {test.checks.map((c) => (
                  <Alert key={c.permission} severity={c.ok ? 'success' : 'error'}>
                    <strong>{c.name}</strong> <Mono>{c.permission}</Mono>
                    {c.ok ? (c.name === 'Version' && test.version ? ` · PalDefender ${test.version}` : '') : ` · ${c.message}`}
                  </Alert>
                ))}
                <Typography variant="body2" color="text.secondary">
                  Banning, giving and the other actions can’t be tested without doing them, so make sure the token has the permissions for the features you use (listed in the setup guide).
                </Typography>
              </Stack>
            )}
            {status?.enabled && (
              <Alert severity={status.error ? 'warning' : 'info'} icon={false}>
                {status.error
                  ? `Last sync failed: ${status.error}`
                  : status.lastSyncAt
                    ? `PalDefender ${status.version ?? ''} · player addresses last synced ${formatDateTime(status.lastSyncAt)}`
                    : 'Waiting for the first sync (runs every minute).'}
              </Alert>
            )}
          </Stack>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Section title="Setting it up">
          <Box component="ol" sx={{ pl: 2.5, mt: 0, '& li': { mb: 1 } }}>
            <li>
              In <Mono>Win64/PalDefender/RESTAPI/RESTConfig.json</Mono>, set <Mono>"Enabled": true</Mono> and restart the server. The API listens on port <Mono>17993</Mono>.
            </li>
            <li>
              Add a token file in <Mono>Win64/PalDefender/RESTAPI/Tokens/</Mono>. This gives PalOps the reads and bans; add more (give, summon, messages…) only for what you’ll use, see the setup guide:
              <Box component="pre" sx={{ m: 0, mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, overflowX: 'auto' }}>
                {TOKEN_FILE}
              </Box>
            </li>
            <li>Keep the port private. PalDefender’s API is meant for the same machine; for anything else, put a TLS reverse proxy in front.</li>
          </Box>
          <Typography variant="body2" color="text.secondary">
            When on, bans made in PalOps are also made in PalDefender (including IP bans), PalDefender’s ban list appears on the Players → Bans tab, player
            addresses (including offline players) are read from it, and a PalDefender page and player panel add inventories, pals, guilds and bases, giving, summoning and messages. The official REST API stays the source of truth: if PalDefender is unreachable, PalOps still bans
            and tells you PalDefender didn’t. The token is encrypted at rest and never sent back to the browser.
          </Typography>
        </Section>
      </Grid>
    </Grid>
  );
}
