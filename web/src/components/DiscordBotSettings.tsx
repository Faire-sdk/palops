import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { BotCheck, ConsoleLevel, DiscordBotSettings, GatewayStatus } from '../api/types';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { ErrorState, Loading, Mono, Section } from './common';
import { useToast } from './Toast';

interface Form {
  enabled: boolean;
  applicationId: string;
  publicKey: string;
  botToken: string;
  guildId: string;
  publicInfo: boolean;
  eventsChannelId: string;
  logChannelId: string;
  logMinLevel: ConsoleLevel;
  notifyBans: boolean;
  notifySignals: boolean;
  notifyServer: boolean;
  notifyJoins: boolean;
  gatewayEnabled: boolean;
  presenceEnabled: boolean;
  statusChannelId: string;
}

const blank = (v: string) => v.trim() || null;

/** The optional Discord bot: slash commands and channel notifications. Owners only. */
export function DiscordBotSettingsTab() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ settings: DiscordBotSettings; gateway: GatewayStatus; interactionsUrl: string; commands: Array<{ name: string; description: string }> }>('/discord-bot/settings', { pollMs: 10000 });
  const [form, setForm] = useState<Form | null>(null);
  const [checks, setChecks] = useState<BotCheck[]>();
  const [busy, setBusy] = useState<'save' | 'test' | 'register' | 'send' | null>(null);

  useEffect(() => {
    const s = data?.settings;
    if (s && !form) {
      setForm({
        enabled: s.enabled,
        applicationId: s.applicationId ?? '',
        publicKey: s.publicKey ?? '',
        botToken: '',
        guildId: s.guildId ?? '',
        publicInfo: s.publicInfo,
        eventsChannelId: s.eventsChannelId ?? '',
        logChannelId: s.logChannelId ?? '',
        logMinLevel: s.logMinLevel,
        notifyBans: s.notifyBans,
        notifySignals: s.notifySignals,
        notifyServer: s.notifyServer,
        notifyJoins: s.notifyJoins,
        gatewayEnabled: s.gatewayEnabled,
        presenceEnabled: s.presenceEnabled,
        statusChannelId: s.statusChannelId ?? '',
      });
    }
  }, [data, form]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !form) return null;
  const s = data.settings;

  const text = (key: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const flag = (key: keyof Form, label: string, hint?: string) => (
    <FormControlLabel
      control={<Checkbox checked={form[key] as boolean} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />}
      label={
        <>
          {label}
          {hint && (
            <Typography variant="body2" color="text.secondary">
              {hint}
            </Typography>
          )}
        </>
      }
      sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
    />
  );
  const payload = () => ({
    ...form,
    applicationId: blank(form.applicationId),
    publicKey: blank(form.publicKey),
    botToken: form.botToken || undefined,
    guildId: blank(form.guildId),
    eventsChannelId: blank(form.eventsChannelId),
    logChannelId: blank(form.logChannelId),
    statusChannelId: blank(form.statusChannelId),
  });

  const run = async (kind: 'save' | 'test' | 'register' | 'send') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setChecks((await api.post<{ checks: BotCheck[] }>('/discord-bot/test', { botToken: form.botToken || undefined, guildId: blank(form.guildId), eventsChannelId: blank(form.eventsChannelId), logChannelId: blank(form.logChannelId), statusChannelId: blank(form.statusChannelId) })).checks);
      } else if (kind === 'register') {
        const res = await api.post<{ count: number }>('/discord-bot/register-commands');
        notify(`Registered ${res.count} slash commands on your server`, 'success');
        await reload();
      } else if (kind === 'send') {
        await api.post('/discord-bot/send-test');
        notify('Test message sent', 'success');
      } else {
        await api.put('/discord-bot/settings', payload());
        notify(form.enabled ? 'Discord bot saved and switched on' : 'Discord bot saved (switched off)', 'success');
        setChecks(undefined);
        setForm({ ...form, botToken: '' });
        await reload();
        refreshAll();
      }
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = () => void navigator.clipboard?.writeText(data.interactionsUrl).then(() => notify('Copied', 'success'));

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="Discord bot (optional)">
          <Stack
            component="form"
            spacing={2}
            onSubmit={(e) => {
              e.preventDefault();
              void run('save');
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Slash commands to check and moderate the server from Discord, plus channel notifications. PalOps works fully without it. Everyone who uses a command is matched to a panel user by
              their Discord ID (set in Settings → Users) and can do only what their role allows there.
            </Typography>
            <FormControlLabel control={<Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />} label="Use the Discord bot" />
            <TextField label="Application ID" value={form.applicationId} onChange={text('applicationId')} helperText="Developer Portal → General Information" />
            <TextField label="Public key" value={form.publicKey} onChange={text('publicKey')} helperText="Same page. Used to check that requests really come from Discord." slotProps={{ htmlInput: { maxLength: 64 } }} />
            <TextField
              label="Bot token"
              type="password"
              autoComplete="off"
              value={form.botToken}
              onChange={text('botToken')}
              helperText={s.hasToken ? 'A token is saved. Leave blank to keep it.' : 'Developer Portal → Bot → Reset Token. Encrypted here and never shown again.'}
            />
            <TextField label="Server ID" value={form.guildId} onChange={text('guildId')} helperText="Right-click your server with Developer Mode on → Copy Server ID. Commands only work here." />

            <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
              Live connection and status
            </Typography>
            {flag('gatewayEnabled', 'Keep a live connection to Discord', 'Needed for the bot’s status. It also lets slash commands work without a public web address (leave Interactions Endpoint URL empty in the portal).')}
            {flag('presenceEnabled', 'Show the server in the bot’s status', 'Online with “5/32 players”, or Do Not Disturb when the server is offline or restarting')}
            <TextField label="Status channel ID" value={form.statusChannelId} onChange={text('statusChannelId')} helperText="Optional: a channel renamed to “🟢 5/32 online”. The bot needs Manage Channels. Discord limits renames, so it updates at most every six minutes." />
            {s.enabled && form.gatewayEnabled && (
              <Alert severity={data.gateway.state === 'connected' ? 'success' : data.gateway.state === 'error' ? 'warning' : 'info'} icon={false}>
                Live connection: {data.gateway.state === 'connected' ? 'connected' : (data.gateway.message ?? data.gateway.state)}
              </Alert>
            )}

            <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
              Notifications
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Events channel ID" value={form.eventsChannelId} onChange={text('eventsChannelId')} helperText="Bans, signals and server status" />
              <TextField label="Log channel ID" value={form.logChannelId} onChange={text('logChannelId')} helperText="Game and PalDefender log lines (optional)" />
            </Stack>
            <Stack>
              {flag('notifyBans', 'Bans, unbans and kicks')}
              {flag('notifySignals', 'Cheat signals', 'Unusual movement, level jumps, base intrusions')}
              {flag('notifyServer', 'Server goes offline or comes back')}
              {flag('notifyJoins', 'Players joining and leaving', 'Can be chatty on a busy server')}
            </Stack>
            <TextField select label="Forward log lines from" value={form.logMinLevel} onChange={text('logMinLevel')} sx={{ maxWidth: 280 }} helperText="Needs the Console’s log files or PalServerLogger set up">
              <MenuItem value="error">Errors only</MenuItem>
              <MenuItem value="warn">Warnings and errors</MenuItem>
              <MenuItem value="info">Everything (very chatty)</MenuItem>
            </TextField>

            <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
              Who can use it
            </Typography>
            {flag('publicInfo', 'Anyone in the Discord server can use /status and /players', 'Everything else needs a linked panel account')}

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" type="submit" loading={busy === 'save'}>
                Save
              </Button>
              <Button variant="outlined" type="button" loading={busy === 'test'} onClick={() => run('test')} disabled={!form.botToken && !s.hasToken}>
                Test
              </Button>
              <Button variant="outlined" type="button" loading={busy === 'register'} onClick={() => run('register')} disabled={!s.hasToken || !s.guildId}>
                Register slash commands
              </Button>
              <Button variant="outlined" type="button" loading={busy === 'send'} onClick={() => run('send')} disabled={!s.hasToken || !s.eventsChannelId}>
                Send test message
              </Button>
            </Stack>
            {checks?.map((c) => (
              <Alert key={c.name} severity={c.ok ? 'success' : 'error'}>
                <strong>{c.name}</strong>
                {c.message ? ` · ${c.message}` : ''}
              </Alert>
            ))}
            {s.commandsRegisteredAt && (
              <Typography variant="body2" color="text.secondary">
                Slash commands last registered {formatDateTime(s.commandsRegisteredAt)}. Register again after PalOps adds commands.
              </Typography>
            )}
          </Stack>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Stack spacing={2}>
          <Section title="Setting it up">
            <Box component="ol" sx={{ pl: 2.5, mt: 0, '& li': { mb: 1 } }}>
              <li>
                In the{' '}
                <Link href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">
                  Developer Portal
                </Link>
                , open your application (the one used for sign-in works). Copy its <strong>Application ID</strong> and <strong>Public Key</strong> here.
              </li>
              <li>
                Under <strong>Bot</strong>, reset the token and paste it here. No privileged intents are needed.
              </li>
              <li>
                Invite it with the scopes <Mono>bot</Mono> and <Mono>applications.commands</Mono>, and the permissions View Channel and Send Messages.
              </li>
              <li>
                Save here <em>first</em>, then set <strong>Interactions Endpoint URL</strong> in the portal to:
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.5 }}>
                  <TextField size="small" value={data.interactionsUrl} slotProps={{ input: { readOnly: true, endAdornment: <InputAdornment position="end"><Tooltip title="Copy"><IconButton size="small" onClick={copy} aria-label="Copy URL"><ContentCopyIcon fontSize="small" /></IconButton></Tooltip></InputAdornment> } }} fullWidth />
                </Stack>
                Discord checks it straight away, so PalOps must be reachable there over HTTPS.
              </li>
              <li>Press <strong>Register slash commands</strong>, then <strong>Test</strong>. With the live connection on, you can skip step 4 and leave the Interactions Endpoint URL empty.</li>
            </Box>
          </Section>
          <Section title="Commands">
            <Stack spacing={0.75}>
              {data.commands.map((c) => (
                <Typography key={c.name} variant="body2">
                  <Mono>/{c.name}</Mono> <Typography component="span" variant="body2" color="text.secondary">{c.description}</Typography>
                </Typography>
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              Replies are private to whoever ran the command, actions are recorded in the audit log under the panel user’s name, and nothing the bot posts can ping anyone. The bot token is encrypted at rest.
            </Typography>
          </Section>
        </Stack>
      </Grid>
    </Grid>
  );
}
