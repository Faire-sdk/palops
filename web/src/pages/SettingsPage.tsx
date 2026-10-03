import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ROLES, type AdapterKind, type Role, type ServerConnection, type ServerStatus, type User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage, DiscordButton, DiscordLogo, discordAvatarUrl } from '../auth/discord';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ConsoleSettingsTab } from '../components/ConsoleSettings';
import { DiscordBotSettingsTab } from '../components/DiscordBotSettings';
import { IntegrationsSettingsTab } from '../components/IntegrationsSettings';
import { ErrorState, KeyValue, Loading, Mono, PageHeader, Section, ServerStateChip } from '../components/common';
import { DataTable } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { id: 'account', label: 'Account' },
    ...(can('server.connection') ? [{ id: 'connection', label: 'Server connection' }, { id: 'console', label: 'Console logs' }, { id: 'integrations', label: 'Integrations' }, { id: 'discord', label: 'Discord bot' }] : []),
    ...(can('users.manage') ? [{ id: 'users', label: 'Users' }] : []),
  ];
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'account';

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(_, v: string) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      {tab === 'account' && <AccountSettings />}
      {tab === 'connection' && <ConnectionSettings />}
      {tab === 'console' && <ConsoleSettingsTab />}
      {tab === 'discord' && <DiscordBotSettingsTab />}
      {tab === 'integrations' && <IntegrationsSettingsTab />}
      {tab === 'users' && <UserSettings />}
    </>
  );
}

function DiscordIdentity({ discord }: { discord: NonNullable<User['discord']> }) {
  const avatar = discordAvatarUrl(discord);
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Avatar src={avatar ?? undefined} sx={{ width: 36, height: 36, bgcolor: '#5865F2' }}>
        <DiscordLogo fontSize="small" />
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {discord.username ?? 'Not signed in yet'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <Mono>{discord.id}</Mono>
        </Typography>
      </Box>
    </Stack>
  );
}

function AccountSettings() {
  const { session, options, startDiscord, refresh } = useAuth();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [notice] = useState(() =>
    params.get('discord') === 'linked'
      ? { tone: 'success' as const, text: 'Discord account linked.' }
      : params.get('auth_error')
        ? { tone: 'error' as const, text: authErrorMessage(params.get('auth_error')) ?? '' }
        : null,
  );
  useEffect(() => {
    if (params.has('discord') || params.has('auth_error')) setParams({ tab: 'account' }, { replace: true });
  }, [params, setParams]);

  const user = session?.user;
  const canUnlink = !!user?.hasPassword && options.providers.password;

  const unlink = async () => {
    try {
      await api.post('/auth/discord/unlink');
      await refresh();
      notify('Discord account unlinked', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <>
      {notice && (
        <Alert severity={notice.tone} sx={{ mb: 2 }}>
          {notice.text}
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Profile">
            <KeyValue
              items={[
                ['Username', user?.username],
                ['Role', <Chip label={user?.role} color="primary" variant="outlined" />],
                ['Last sign-in', formatDateTime(user?.lastLoginAt ?? null)],
              ]}
            />
          </Section>
        </Grid>
        {(options.providers.discord || user?.discord) && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Discord">
              {user?.discord ? (
                <Stack spacing={2}>
                  <DiscordIdentity discord={user.discord} />
                  {canUnlink ? (
                    <div>
                      <Button variant="outlined" color="error" onClick={unlink}>
                        Unlink Discord
                      </Button>
                    </div>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Discord is how you sign in, so it can’t be unlinked.
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Typography color="text.secondary">Link your Discord account to sign in with Discord.</Typography>
                  <DiscordButton onClick={() => startDiscord('link').catch((e) => notify(errorMessage(e), 'error'))}>Link Discord</DiscordButton>
                </Stack>
              )}
            </Section>
          </Grid>
        )}
        {options.providers.password && user?.hasPassword && (
          <Grid size={{ xs: 12, md: 6 }}>
            <ChangePassword />
          </Grid>
        )}
      </Grid>
    </>
  );
}

function ChangePassword() {
  const notify = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (next !== confirm) return setError('New passwords do not match');
    setBusy(true);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      notify('Password changed. Other sessions were signed out.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Change password">
      <Stack component="form" spacing={2} onSubmit={submit}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <TextField label="New password" helperText="At least 10 characters" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <div>
          <Button variant="contained" type="submit" loading={busy}>
            Update password
          </Button>
        </div>
      </Stack>
    </Section>
  );
}

interface ConnectionForm {
  name: string;
  adapter: AdapterKind;
  host: string;
  port: string;
  username: string;
  password: string;
}

function ConnectionSettings() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ connection: ServerConnection | null }>('/server/connection');
  const [form, setForm] = useState<ConnectionForm>({ name: 'My Palworld Server', adapter: 'rest', host: '', port: '8212', username: 'admin', password: '' });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<ServerStatus>();

  useEffect(() => {
    const c = data?.connection;
    if (c) setForm({ name: c.name, adapter: c.adapter, host: c.host, port: String(c.port), username: c.username, password: '' });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const set = (key: keyof ConnectionForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const payload = () => ({ ...form, port: Number(form.port), password: form.password || undefined });

  const run = async (kind: 'save' | 'test') => {
    setBusy(kind);
    try {
      if (kind === 'test') {
        setTest(await api.post<ServerStatus>('/server/connection/test', payload()));
      } else {
        await api.put('/server/connection', payload());
        notify('Server connection saved', 'success');
        refreshAll();
      }
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const isMock = form.adapter === 'mock';

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="Palworld server">
          <Stack
            component="form"
            spacing={2}
            onSubmit={(e) => {
              e.preventDefault();
              void run('save');
            }}
          >
            <TextField label="Display name" value={form.name} onChange={set('name')} required slotProps={{ htmlInput: { maxLength: 64 } }} />
            <TextField select label="Connection type" value={form.adapter} onChange={set('adapter')}>
              <MenuItem value="rest">Palworld REST API</MenuItem>
              <MenuItem value="mock">Mock server (for testing the panel)</MenuItem>
            </TextField>
            {!isMock && (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Host" helperText="IP or hostname of the Palworld server" value={form.host} onChange={set('host')} placeholder="127.0.0.1" required />
                  <TextField
                    label="REST API port"
                    type="number"
                    value={form.port}
                    onChange={set('port')}
                    required
                    sx={{ maxWidth: { sm: 160 } }}
                    slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                  />
                </Stack>
                <TextField label="Username" value={form.username} onChange={set('username')} required />
                <TextField
                  label="Admin password"
                  type="password"
                  autoComplete="off"
                  value={form.password}
                  onChange={set('password')}
                  helperText={data?.connection?.hasPassword ? 'A password is saved. Leave blank to keep it.' : 'The AdminPassword from PalWorldSettings.ini'}
                />
              </>
            )}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" type="submit" loading={busy === 'save'}>
                Save
              </Button>
              <Button variant="outlined" type="button" onClick={() => run('test')} loading={busy === 'test'}>
                Test connection
              </Button>
            </Stack>
            {test && (
              <Alert severity={test.state === 'online' ? 'success' : 'error'} icon={false}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <ServerStateChip state={test.state} />
                  <span>{test.state === 'online' ? `Connected to ${test.info?.name} (${test.info?.version})` : test.error?.message}</span>
                </Stack>
              </Alert>
            )}
          </Stack>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Section title="Setting up the REST API">
          <Box component="ol" sx={{ pl: 2.5, mt: 0, '& li': { mb: 1 } }}>
            <li>
              In <Mono>PalWorldSettings.ini</Mono>, set <Mono>RESTAPIEnabled=True</Mono> and an <Mono>AdminPassword</Mono>.
            </li>
            <li>
              Note <Mono>RESTAPIPort</Mono> (default <Mono>8212</Mono>) and restart the server.
            </li>
            <li>Keep that port private: allow it only from the panel’s host, never from the internet.</li>
          </Box>
          <Typography variant="body2" color="text.secondary">
            The password is encrypted at rest and never sent back to the browser.
          </Typography>
        </Section>
      </Grid>
    </Grid>
  );
}

function UserSettings() {
  const { session, options } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ users: User[] }>('/users');
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [resetLink, setResetLink] = useState<string>();

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const update = async (user: User, changes: Partial<Pick<User, 'role' | 'disabled'>>) => {
    try {
      await api.patch(`/users/${user.id}`, changes);
      notify(`Updated ${user.username}`, 'success');
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const remove = async (user: User) => {
    try {
      await api.delete(`/users/${user.id}`);
      notify(`Deleted ${user.username}`, 'success');
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const issueReset = async (user: User) => {
    try {
      const { token } = await api.post<{ token: string }>(`/users/${user.id}/password-reset`);
      setResetLink(`${window.location.origin}/panel/reset-password?token=${encodeURIComponent(token)}`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Section
      title="Panel users"
      disablePadding
      action={
        <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setCreating(true)}>
          Add user
        </Button>
      }
    >
      <DataTable
        rows={data?.users ?? []}
        rowKey={(u) => u.id}
        columns={[
          { key: 'username', header: 'Username', render: (u) => <Typography sx={{ fontWeight: 600 }}>{u.username}</Typography> },
          {
            key: 'discord',
            header: 'Discord',
            render: (u) =>
              u.discord ? (
                <DiscordIdentity discord={u.discord} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Not linked
                </Typography>
              ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (u) => (
              <TextField
                select
                value={u.role}
                onChange={(e) => update(u, { role: e.target.value as Role })}
                sx={{ minWidth: 130 }}
                slotProps={{ htmlInput: { 'aria-label': `Role for ${u.username}` } }}
              >
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </TextField>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (u) => (u.disabled ? <Chip label="Disabled" color="error" variant="outlined" /> : <Chip label="Active" color="success" variant="outlined" />),
          },
          { key: 'last', header: 'Last sign-in', nowrap: true, render: (u) => formatDateTime(u.lastLoginAt) },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (u) => (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                {options.providers.password && (
                  <Button size="small" variant="outlined" onClick={() => issueReset(u)}>
                    Reset link
                  </Button>
                )}
                {u.id !== session?.user.id &&
                  (u.disabled ? (
                    <Button size="small" variant="outlined" onClick={() => update(u, { disabled: false })}>
                      Enable
                    </Button>
                  ) : (
                    <Button size="small" variant="outlined" color="error" onClick={() => setDisabling(u)}>
                      Disable
                    </Button>
                  ))}
                {u.id !== session?.user.id && (
                  <Button size="small" variant="contained" color="error" onClick={() => setDeleting(u)}>
                    Delete
                  </Button>
                )}
              </Stack>
            ),
          },
        ]}
      />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      <ConfirmDialog
        open={!!disabling}
        title="Disable user"
        danger
        confirmLabel="Disable"
        message={`${disabling?.username} will be signed out and won’t be able to sign in until re-enabled.`}
        onConfirm={() => (disabling ? update(disabling, { disabled: true }) : undefined)}
        onClose={() => setDisabling(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete user"
        danger
        confirmLabel="Delete"
        message={`${deleting?.username} will be signed out and removed from the panel for good. Their audit history stays. To let them back in, add them again.`}
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onClose={() => setDeleting(null)}
      />
      <Dialog open={!!resetLink} onClose={() => setResetLink(undefined)} maxWidth="sm" fullWidth>
        <DialogTitle>Password reset link</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>Share this link privately. It works once and expires in one hour.</Typography>
          <TextField value={resetLink ?? ''} onFocus={(e) => e.target.select()} slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Reset link' } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetLink(undefined)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { options } = useAuth();
  const notify = useToast();
  const [username, setUsername] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/users', {
        username,
        role,
        discordId: discordId.trim() || undefined,
        password: password || undefined,
      });
      notify(`Created ${username}`, 'success');
      setUsername('');
      setDiscordId('');
      setPassword('');
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { component: 'form', onSubmit: submit } as object }}>
      <DialogTitle>Add user</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Username" helperText="Their name inside the panel" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <TextField
            label="Discord user ID"
            helperText="In Discord, enable Developer Mode, right-click the user and choose Copy User ID. They can also try signing in; the panel will show them their ID."
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            placeholder="e.g. 80351110224678912"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          {options.providers.password && (
            <TextField
              label="Temporary password"
              helperText="Optional. At least 10 characters; ask them to change it after signing in."
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          Create user
        </Button>
      </DialogActions>
    </Dialog>
  );
}
