import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { ConsoleSettings, PathCheck, TailStatus } from '../api/types';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { ErrorState, Loading, Mono, Section } from './common';
import { useToast } from './Toast';

interface Form {
  tailEnabled: boolean;
  gameLogPath: string;
  paldefenderLogPath: string;
}

/** Where the Console page reads the game's and PalDefender's log files from. Owners only. */
export function ConsoleSettingsTab() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ settings: ConsoleSettings; sources: TailStatus[] }>('/console/settings', { pollMs: 10000 });
  const [form, setForm] = useState<Form>({ tailEnabled: false, gameLogPath: '', paldefenderLogPath: '' });
  const [checks, setChecks] = useState<PathCheck[]>();
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const s = data?.settings;
    if (s && !loaded) {
      setForm({ tailEnabled: s.tailEnabled, gameLogPath: s.gameLogPath ?? '', paldefenderLogPath: s.paldefenderLogPath ?? '' });
      setLoaded(true);
    }
  }, [data, loaded]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const payload = () => ({ tailEnabled: form.tailEnabled, gameLogPath: form.gameLogPath.trim() || null, paldefenderLogPath: form.paldefenderLogPath.trim() || null });

  const run = async (kind: 'save' | 'test') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setChecks((await api.post<{ checks: PathCheck[] }>('/console/settings/test', payload())).checks);
      } else {
        await api.put('/console/settings', payload());
        notify(form.tailEnabled ? 'Log tailing saved and switched on' : 'Log tailing saved (switched off)', 'success');
        setChecks(undefined);
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
        <Section title="Console log files">
          <Stack
            component="form"
            spacing={2}
            onSubmit={(e) => {
              e.preventDefault();
              void run('save');
            }}
          >
            <Typography variant="body2" color="text.secondary">
              The Console page always shows what the panel sees. To add the game’s own log and PalDefender’s log, point PalOps at where they’re written. This needs PalOps to run on the
              game machine (or to have the folders mounted).
            </Typography>
            <FormControlLabel control={<Switch checked={form.tailEnabled} onChange={(e) => setForm({ ...form, tailEnabled: e.target.checked })} />} label="Follow these log files" />
            <TextField
              label="Game log file or folder"
              value={form.gameLogPath}
              onChange={(e) => setForm({ ...form, gameLogPath: e.target.value })}
              placeholder="C:\PalServer\Pal\Saved\Logs"
              helperText="Palworld usually writes Pal.log in Pal/Saved/Logs"
            />
            <TextField
              label="PalDefender log folder"
              value={form.paldefenderLogPath}
              onChange={(e) => setForm({ ...form, paldefenderLogPath: e.target.value })}
              placeholder="C:\PalServer\Pal\Binaries\Win64\PalDefender\Logs"
              helperText="PalDefender’s docs place its logs in Pal/Binaries/Win64/PalDefender/Logs"
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" type="submit" loading={busy === 'save'}>
                Save
              </Button>
              <Button variant="outlined" type="button" loading={busy === 'test'} onClick={() => run('test')} disabled={!form.gameLogPath.trim() && !form.paldefenderLogPath.trim()}>
                Check paths
              </Button>
            </Stack>
            {checks?.map((c) => (
              <Alert key={c.source} severity={c.ok ? 'success' : 'error'}>
                {c.source === 'game' ? 'Game log' : 'PalDefender log'}: {c.ok ? `found a ${c.kind}` : c.message}
              </Alert>
            ))}
            {data?.settings.tailEnabled &&
              data.sources.map((s) => (
                <Alert key={s.source} severity={s.state === 'watching' ? 'info' : 'warning'} icon={false}>
                  {s.source === 'game' ? 'Game log' : 'PalDefender log'}:{' '}
                  {s.state === 'watching'
                    ? `following ${s.files} file${s.files === 1 ? '' : 's'}${s.lastLineAt ? ` · last line ${formatDateTime(s.lastLineAt)}` : ' · nothing new yet'}`
                    : 'can’t be read right now'}
                </Alert>
              ))}
          </Stack>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Section title="Good to know">
          <Typography variant="body2" color="text.secondary" component="div">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                It’s <strong>view only</strong>. Palworld has deprecated RCON, so there’s no command box; use the Players, Server and PalDefender pages instead.
              </li>
              <li>
                Only <Mono>.log</Mono>, <Mono>.txt</Mono> and <Mono>.out</Mono> files are read. Point at a folder to follow every one changed in the last day.
              </li>
              <li>PalOps never reads its own data folder, and lines are kept for a week.</li>
              <li>
                In Docker, mount the log folders read-only into the PalOps container and enter the path as the container sees it, e.g. <Mono>/logs/palworld</Mono>.
              </li>
              <li>Anyone who can see the Console (admins and owners) can read what these files contain, including player names and addresses PalDefender logs.</li>
            </ul>
          </Typography>
        </Section>
      </Grid>
    </Grid>
  );
}
