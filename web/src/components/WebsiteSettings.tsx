import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { SiteSettings } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Mono, Section } from './common';
import { useToast } from './Toast';

/** The public website's rules. Nothing is shown there until staff write some. */
export function WebsiteSettingsTab() {
  const notify = useToast();
  const { can } = useAuth();
  const canEdit = can('server.control');
  const { data, error, loading, reload } = useApi<{ settings: SiteSettings }>('/server/site');
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && text === undefined) setText(data.settings.rules.join('\n'));
  }, [data, text]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data || text === undefined) return null;

  const save = async () => {
    setBusy(true);
    try {
      const rules = text.split('\n').map((line) => line.trim()).filter(Boolean);
      const saved = await api.put<{ settings: SiteSettings }>('/server/site', { rules });
      notify(rules.length ? 'Rules saved' : 'Rules removed from the website', 'success');
      setText(saved.settings.rules.join('\n'));
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const { settings } = data;
  return (
    <Section title="Server rules">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Shown on the website’s home page, one rule per line, in this order. Leave it empty and the website shows no rules section.
        </Typography>
        <TextField
          label="Rules"
          multiline
          minRows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canEdit}
          helperText={settings.updatedAt ? `Last changed ${formatDateTime(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}` : 'Not written yet'}
        />
        <Typography variant="body2" color="text.secondary">
          The join IP and Discord invite on the website come from <Mono>SITE_JOIN_ADDRESS</Mono> and <Mono>SITE_DISCORD_INVITE</Mono>.
        </Typography>
        {canEdit && (
          <div>
            <Button variant="contained" type="submit" loading={busy}>
              Save rules
            </Button>
          </div>
        )}
      </Stack>
    </Section>
  );
}
