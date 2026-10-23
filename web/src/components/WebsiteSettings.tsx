import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { SiteSettings } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { contrast, HEX_COLOR } from '../color';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';
import { accentShades, DARK_BACKGROUNDS, LIGHT_BACKGROUNDS, PALOPS_PRIMARY } from '../theme';
import { ErrorState, Loading, Mono, Section } from './common';
import { useToast } from './Toast';

type Save = (input: Partial<Pick<SiteSettings, 'rules' | 'accentColor'>>) => Promise<SiteSettings | undefined>;

/** What staff set for the public website: its rules and its colour. */
export function WebsiteSettingsTab() {
  const notify = useToast();
  const { can } = useAuth();
  const canEdit = can('server.control');
  const { data, error, loading, reload } = useApi<{ settings: SiteSettings }>('/server/site');

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const save: Save = async (input) => {
    try {
      const saved = await api.put<{ settings: SiteSettings }>('/server/site', input);
      await reload();
      return saved.settings;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return undefined;
    }
  };

  return (
    <Stack spacing={2}>
      <RulesSection settings={data.settings} canEdit={canEdit} save={save} />
      <ColourSection settings={data.settings} canEdit={canEdit} save={save} />
    </Stack>
  );
}

/** The public website's rules. Nothing is shown there until staff write some. */
function RulesSection({ settings, canEdit, save }: { settings: SiteSettings; canEdit: boolean; save: Save }) {
  const notify = useToast();
  const [text, setText] = useState(settings.rules.join('\n'));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const rules = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const saved = await save({ rules });
    if (saved) {
      notify(rules.length ? 'Rules saved' : 'Rules removed from the website', 'success');
      setText(saved.rules.join('\n'));
    }
    setBusy(false);
  };

  return (
    <Section title="Server rules">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
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

/**
 * The server's own colour for its public website. The website uses a shade of
 * it that stays readable in light and dark mode, and this shows both.
 */
function ColourSection({ settings, canEdit, save }: { settings: SiteSettings; canEdit: boolean; save: Save }) {
  const notify = useToast();
  const [hex, setHex] = useState(settings.accentColor ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setHex(settings.accentColor ?? ''), [settings.accentColor]);

  const valid = HEX_COLOR.test(hex);
  const shades = valid ? accentShades(hex) : PALOPS_PRIMARY;

  const submit = async (accentColor: string | null) => {
    setBusy(true);
    const saved = await save({ accentColor });
    if (saved) notify(accentColor ? 'Website colour saved' : 'The website uses PalOps colours again', 'success');
    setBusy(false);
  };

  return (
    <Section title="Website colour">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit(hex.toLowerCase());
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Your server’s colour for buttons, links and highlights on the public website. The staff panel keeps PalOps colours. If a colour is
          too light or too dark to read, the website uses the nearest shade that is readable.
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box
            component="input"
            type="color"
            aria-label="Pick a colour"
            value={valid ? hex : PALOPS_PRIMARY.light}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHex(e.target.value)}
            disabled={!canEdit}
            sx={{ width: 44, height: 44, p: 0.5, border: 1, borderColor: 'divider', borderRadius: '8px', bgcolor: 'background.paper', cursor: 'pointer', flexShrink: 0 }}
          />
          <TextField
            label="Colour"
            placeholder="#2a6f97"
            value={hex}
            onChange={(e) => setHex(e.target.value.trim())}
            disabled={!canEdit}
            error={hex !== '' && !valid}
            helperText={hex === '' ? 'Empty: the website uses PalOps blue' : valid ? 'Six-digit hex colour' : 'Use a colour such as #2a6f97'}
            sx={{ maxWidth: 220 }}
            slotProps={{ htmlInput: { maxLength: 7, spellCheck: false } }}
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Preview mode="Light mode" shade={shades.light} chosen={valid ? hex : null} background={LIGHT_BACKGROUNDS.paper} text="rgba(0, 0, 0, 0.87)" />
          <Preview mode="Dark mode" shade={shades.dark} chosen={valid ? hex : null} background={DARK_BACKGROUNDS.paper} text="#ffffff" />
        </Stack>
        {canEdit && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" type="submit" loading={busy} disabled={!valid}>
              Save colour
            </Button>
            {settings.accentColor && (
              <Button variant="outlined" onClick={() => void submit(null)} disabled={busy}>
                Use PalOps colours
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

/** How the colour looks on the website in one mode: a button, a link, and the contrast it reaches. */
function Preview({ mode, shade, chosen, background, text }: { mode: string; shade: string; chosen: string | null; background: string; text: string }) {
  const buttonText = contrast('#ffffff', shade) >= 4.5 ? '#ffffff' : 'rgba(0, 0, 0, 0.87)';
  const adjusted = chosen !== null && chosen.toLowerCase() !== shade;
  return (
    <Box sx={{ flex: 1, p: 2, borderRadius: '8px', border: 1, borderColor: 'divider', bgcolor: background, color: text }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>
        {mode}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ px: 2, py: 1, borderRadius: '8px', bgcolor: shade, color: buttonText, fontWeight: 600, fontSize: 14 }}>Join the server</Box>
        <Box component="span" sx={{ color: shade, fontWeight: 600, textDecoration: 'underline' }}>
          All players
        </Box>
      </Stack>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        <Mono>{shade}</Mono>, {contrast(shade, background).toFixed(2)}:1 on the page
        {adjusted ? (mode === 'Light mode' ? ', darkened to stay readable' : ', lightened to stay readable') : ''}
      </Typography>
    </Box>
  );
}
