import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { ScheduleSettings, ScheduleStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';
import { ErrorState, KeyValue, Loading, Section } from './common';
import { useToast } from './Toast';

type Form = Omit<ScheduleSettings, 'updatedAt'>;

const RESTART_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const WARN_MINUTES = [1, 2, 5, 10, 15, 30];
const SAVE_MINUTES = [5, 10, 15, 30, 60, 120];
const DEFAULT_MESSAGE = 'Scheduled restart in {minutes} minutes. Find a safe spot!';

/** The preset choices, plus the saved value if it was set to something else. */
const withValue = (options: number[], value: number) => [...new Set([...options, value])].sort((a, b) => a - b);

const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);

/** Scheduled restarts and world saves, run by the panel through the REST API. */
export function ScheduleSettingsSection() {
  const notify = useToast();
  const { can } = useAuth();
  const canEdit = can('server.control');
  const { data, error, loading, reload } = useApi<{ settings: ScheduleSettings; status: ScheduleStatus }>('/server/schedule', { pollMs: 30000 });
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !form) {
      const { updatedAt: _, ...settings } = data.settings;
      setForm(settings);
    }
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !form) return null;
  const { status } = data;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/server/schedule', form);
      notify('Schedule saved', 'success');
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });

  return (
    <Section title="Restarts and saves">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <KeyValue
          items={[
            ['Next restart', status.nextRestartAt ? formatDateTime(status.nextRestartAt) : 'Off'],
            ['Last restart', formatDateTime(status.lastRestartAt)],
            ['Next save', status.nextSaveAt ? formatDateTime(status.nextSaveAt) : 'Off'],
            ['Last save', formatDateTime(status.lastSaveAt)],
          ]}
        />
        {status.lastError && (
          <Alert severity="warning">
            {status.lastError.message} ({formatDateTime(status.lastError.at)})
          </Alert>
        )}

        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Restarts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Palworld uses more memory the longer it runs, so a regular restart keeps it smooth. PalOps saves the world, warns players with the game’s
          countdown and shuts the server down. The server must start again on its own: Docker’s restart policy or your service manager does that.
        </Typography>
        <FormControlLabel control={<Switch checked={form.restartEnabled} onChange={(e) => set('restartEnabled', e.target.checked)} disabled={!canEdit} />} label="Restart on a schedule" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="How often" value={form.restartEveryHours} onChange={(e) => set('restartEveryHours', Number(e.target.value))} disabled={!canEdit} sx={{ minWidth: 160 }}>
            {withValue(RESTART_HOURS, form.restartEveryHours).map((h) => (
              <MenuItem key={h} value={h}>
                {h === 24 ? 'Once a day' : every(h, 'hour')}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Starting at"
            type="time"
            value={form.restartAt}
            onChange={(e) => set('restartAt', e.target.value)}
            disabled={!canEdit}
            helperText={status.timeZone}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60 } }}
          />
          <TextField select label="Warn players" value={form.restartWarnMinutes} onChange={(e) => set('restartWarnMinutes', Number(e.target.value))} disabled={!canEdit} sx={{ minWidth: 160 }}>
            {withValue(WARN_MINUTES, form.restartWarnMinutes).map((m) => (
              <MenuItem key={m} value={m}>
                {m === 1 ? '1 minute before' : `${m} minutes before`}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <TextField
          label="Message to players"
          value={form.restartMessage}
          onChange={(e) => set('restartMessage', e.target.value)}
          disabled={!canEdit}
          placeholder={DEFAULT_MESSAGE}
          helperText="{minutes} becomes the warning time."
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />

        <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
          World saves
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Palworld autosaves on its own. A scheduled save is a safety net, so less progress is lost if the server crashes. Backups of the save
          folder are made on the game machine.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <FormControlLabel control={<Switch checked={form.saveEnabled} onChange={(e) => set('saveEnabled', e.target.checked)} disabled={!canEdit} />} label="Save on a schedule" sx={{ whiteSpace: 'nowrap' }} />
          <TextField select label="How often" value={form.saveEveryMinutes} onChange={(e) => set('saveEveryMinutes', Number(e.target.value))} disabled={!canEdit} sx={{ minWidth: 160 }}>
            {withValue(SAVE_MINUTES, form.saveEveryMinutes).map((m) => (
              <MenuItem key={m} value={m}>
                {m >= 60 ? every(m / 60, 'hour') : every(m, 'minute')}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {canEdit && (
          <div>
            <Button variant="contained" type="submit" loading={busy}>
              Save schedule
            </Button>
          </div>
        )}
      </Stack>
    </Section>
  );
}
