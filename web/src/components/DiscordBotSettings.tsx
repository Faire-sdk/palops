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
import { usePalDefender } from '../hooks/usePalDefender';
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
  joinOnLogin: boolean;
  verifiedRoleId: string;
  roleOwnerId: string;
  roleAdminId: string;
  roleModeratorId: string;
  syncNicknames: boolean;
  syncBans: boolean;
  relayEnabled: boolean;
  relayChannelId: string;
  relayToDiscord: boolean;
  relayToGame: boolean;
  relayPattern: string;
  relaySources: Array<'game' | 'paldefender'>;
  relayPrefix: string;
}

const blank = (v: string) => v.trim() || null;

/** The optional Discord bot: slash commands and channel notifications. Owners only. */
export function DiscordBotSettingsTab() {
  const notify = useToast();
  const pd = usePalDefender();
  const { data, error, loading, reload } = useApi<{ settings: DiscordBotSettings; gateway: GatewayStatus; interactionsUrl: string; commands: Array<{ name: string; description: string }> }>('/discord-bot/settings', { pollMs: 10000 });
  const [form, setForm] = useState<Form | null>(null);
  const [checks, setChecks] = useState<BotCheck[]>();
  const [sample, setSample] = useState('');
  const [patternResult, setPatternResult] = useState<{ matched: boolean; player: string | null; message: string | null; error: string | null }>();
  const [busy, setBusy] = useState<'save' | 'test' | 'register' | 'send' | 'roles' | null>(null);

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
        joinOnLogin: s.joinOnLogin,
        verifiedRoleId: s.verifiedRoleId ?? '',
        roleOwnerId: s.roleOwnerId ?? '',
        roleAdminId: s.roleAdminId ?? '',
        roleModeratorId: s.roleModeratorId ?? '',
        syncNicknames: s.syncNicknames,
        syncBans: s.syncBans,
        relayEnabled: s.relayEnabled,
        relayChannelId: s.relayChannelId ?? '',
        relayToDiscord: s.relayToDiscord,
        relayToGame: s.relayToGame,
        relayPattern: s.relayPattern ?? '',
        relaySources: s.relaySources,
        relayPrefix: s.relayPrefix,
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
    verifiedRoleId: blank(form.verifiedRoleId),
    roleOwnerId: blank(form.roleOwnerId),
    roleAdminId: blank(form.roleAdminId),
    roleModeratorId: blank(form.roleModeratorId),
    relayChannelId: blank(form.relayChannelId),
    relayPattern: blank(form.relayPattern),
  });

  const run = async (kind: 'save' | 'test' | 'register' | 'send' | 'roles') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setChecks((await api.post<{ checks: BotCheck[] }>('/discord-bot/test', { botToken: form.botToken || undefined, guildId: blank(form.guildId), eventsChannelId: blank(form.eventsChannelId), logChannelId: blank(form.logChannelId), statusChannelId: blank(form.statusChannelId) })).checks);
      } else if (kind === 'register') {
        const res = await api.post<{ count: number }>('/discord-bot/register-commands');
        notify(`Registered ${res.count} slash commands on your server`, 'success');
        await reload();
      } else if (kind === 'roles') {
        const r = await api.post<{ checked: number; synced: number; notInServer: number; failed: number }>('/discord-bot/sync-roles');
        notify(`Checked ${r.checked}: ${r.synced} synced, ${r.notInServer} not in the server${r.failed ? `, ${r.failed} failed (check the bot’s Manage Roles permission and that its role is above the roles it manages)` : ''}`, r.failed ? 'warning' : 'success');
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
              <TextField label="Log channel ID" value={form.logChannelId} onChange={text('logChannelId')} helperText={pd ? 'Game and PalDefender log lines (optional)' : 'Game log lines (optional)'} />
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
              Players and roles
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Players who sign in on the website and prove their character is theirs (an in-game code, or staff) get roles here. Only verified links are ever used, so a claimed name alone can never
              earn a role or get someone banned. The bot needs <strong>Manage Roles</strong> (and its own role must sit above the roles below), plus <strong>Manage Nicknames</strong> and <strong>Ban Members</strong> for those options.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Verified player role ID" value={form.verifiedRoleId} onChange={text('verifiedRoleId')} helperText="Given to players with a verified character" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Owner role ID" value={form.roleOwnerId} onChange={text('roleOwnerId')} />
              <TextField label="Admin role ID" value={form.roleAdminId} onChange={text('roleAdminId')} />
              <TextField label="Moderator role ID" value={form.roleModeratorId} onChange={text('roleModeratorId')} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Panel users get the role for their panel role (matched by the Discord ID on their panel account). Roles you leave blank are not touched, and neither are any other roles people have.
            </Typography>
            {flag('joinOnLogin', 'Add players to the Discord server when they sign in on the website', 'They’re asked to allow it when they sign in. The bot needs Create Invite. Nobody is added without agreeing.')}
            {flag('syncNicknames', 'Set members’ nicknames to their verified character name', 'The bot can’t change the server owner’s nickname')}
            {flag('syncBans', 'Keep bans in step', 'Banning a player in game also bans their verified Discord account, and banning or unbanning someone on Discord does the same to their verified character. Panel users are never banned on Discord this way.')}

            <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
              Chat relay
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Shows game chat in a Discord channel and Discord messages from that channel in the game. Palworld’s API can’t read chat, so game chat is picked out of the Console’s lines with a
              pattern: set up the Console’s log files (or PalServerLogger) first. Reading Discord messages needs <strong>Message Content Intent</strong> switched on in the Developer Portal (Bot page).
            </Typography>
            {flag('relayEnabled', 'Relay chat between the game and Discord')}
            <TextField label="Chat channel ID" value={form.relayChannelId} onChange={text('relayChannelId')} helperText="The channel for the relay. The bot needs View Channel, Send Messages and Read Message History." />
            <Stack>
              {flag('relayToDiscord', 'Game chat goes to Discord')}
              {flag('relayToGame', 'Discord messages go to the game', pd ? 'Shown to everyone in the game as a chat message (through PalDefender) or a server announcement' : 'Shown to everyone in the game as a server announcement')}
            </Stack>
            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="body2">Read game chat from:</Typography>
              {([['game', 'Game log'], ...(pd ? ([['paldefender', 'PalDefender log']] as const) : [])] as const).map(([id, label]) => (
                <FormControlLabel
                  key={id}
                  control={
                    <Checkbox
                      checked={form.relaySources.includes(id)}
                      onChange={(e) => setForm({ ...form, relaySources: e.target.checked ? [...new Set([...form.relaySources, id])] : form.relaySources.filter((x) => x !== id) })}
                    />
                  }
                  label={label}
                />
              ))}
            </Stack>
            <TextField label="Prefix in the game" value={form.relayPrefix} onChange={text('relayPrefix')} helperText="Shown as [Discord] Name: message. Lines starting with it are never sent back to Discord." sx={{ maxWidth: 280 }} slotProps={{ htmlInput: { maxLength: 20 } }} />
            <TextField
              label="Chat line pattern"
              value={form.relayPattern}
              onChange={text('relayPattern')}
              placeholder="Leave empty for the default"
              helperText="A regular expression with (?<player>…) and (?<message>…). The default assumes lines like [2026-09-28 12:00:00] [CHAT] <Name> message, which is a guess: check it against a real line below."
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' }, maxLength: 300 } }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
              <TextField label="Paste a real chat line from the Console to test" value={sample} onChange={(e) => setSample(e.target.value)} fullWidth />
              <Button
                variant="outlined"
                sx={{ height: 40, flexShrink: 0 }}
                disabled={!sample.trim()}
                onClick={async () => {
                  try {
                    setPatternResult(await api.post('/discord-bot/relay/test', { pattern: blank(form.relayPattern), line: sample }));
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Test
              </Button>
            </Stack>
            {patternResult && (
              <Alert severity={patternResult.error ? 'error' : patternResult.matched ? 'success' : 'warning'}>
                {patternResult.error ?? (patternResult.matched ? `Player “${patternResult.player}” said “${patternResult.message}”` : 'That line isn’t recognised as chat with this pattern.')}
              </Alert>
            )}

            <Typography variant="subtitle1" sx={{ fontWeight: 600, pt: 1 }}>
              Who can use commands
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
              <Button variant="outlined" type="button" loading={busy === 'roles'} onClick={() => run('roles')} disabled={!s.enabled}>
                Sync roles now
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
                Invite it with the scopes <Mono>bot</Mono> and <Mono>applications.commands</Mono>, and the permissions View Channels and Send Messages. Add Manage Roles, Manage Nicknames, Ban Members, Manage Channels and Create Invite only for the features you switch on.
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
