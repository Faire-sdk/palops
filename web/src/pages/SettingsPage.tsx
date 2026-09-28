import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ROLES, type AdapterKind, type Role, type ServerConnection, type ServerStatus, type User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ServerStateBadge } from '../components/ServerStateBadge';
import { Table } from '../components/Table';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select } from '../components/ui';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

export function SettingsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { id: 'account', label: 'Account' },
    ...(can('server.connection') ? [{ id: 'connection', label: 'Server connection' }] : []),
    ...(can('users.manage') ? [{ id: 'users', label: 'Users' }] : []),
  ];
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'account';

  return (
    <>
      <PageHeader title="Settings" />
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setParams({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'account' && <AccountSettings />}
      {tab === 'connection' && <ConnectionSettings />}
      {tab === 'users' && <UserSettings />}
    </>
  );
}

function AccountSettings() {
  const { session } = useAuth();
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
    <div className="grid grid-2">
      <Card title="Profile">
        <dl className="kv">
          <dt>Username</dt>
          <dd>{session?.user.username}</dd>
          <dt>Role</dt>
          <dd>
            <Badge tone="accent">{session?.user.role}</Badge>
          </dd>
          <dt>Last sign-in</dt>
          <dd>{formatDateTime(session?.user.lastLoginAt ?? null)}</dd>
        </dl>
      </Card>
      <Card title="Change password">
        <form className="form" onSubmit={submit}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <div>
            <Button variant="primary" type="submit" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
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
    <div className="grid grid-2">
      <Card title="Palworld server">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void run('save');
          }}
        >
          <Field label="Display name">
            <Input value={form.name} onChange={set('name')} required maxLength={64} />
          </Field>
          <Field label="Connection type">
            <Select value={form.adapter} onChange={set('adapter')}>
              <option value="rest">Palworld REST API</option>
              <option value="mock">Mock server (for testing the panel)</option>
            </Select>
          </Field>
          {!isMock && (
            <>
              <div className="row">
                <Field label="Host" hint="IP or hostname of the Palworld server">
                  <Input value={form.host} onChange={set('host')} placeholder="127.0.0.1" required />
                </Field>
                <Field label="REST API port">
                  <Input type="number" min={1} max={65535} value={form.port} onChange={set('port')} required />
                </Field>
              </div>
              <Field label="Username">
                <Input value={form.username} onChange={set('username')} required />
              </Field>
              <Field
                label="Admin password"
                hint={data?.connection?.hasPassword ? 'A password is saved. Leave blank to keep it.' : 'The AdminPassword from PalWorldSettings.ini'}
              >
                <Input type="password" autoComplete="off" value={form.password} onChange={set('password')} />
              </Field>
            </>
          )}
          <div className="button-row">
            <Button variant="primary" type="submit" loading={busy === 'save'}>
              Save
            </Button>
            <Button type="button" onClick={() => run('test')} loading={busy === 'test'}>
              Test connection
            </Button>
          </div>
          {test && (
            <Alert tone={test.state === 'online' ? 'success' : 'error'}>
              <ServerStateBadge state={test.state} />{' '}
              {test.state === 'online' ? `Connected to ${test.info?.name} (${test.info?.version})` : test.error?.message}
            </Alert>
          )}
        </form>
      </Card>
      <Card title="Setting up the REST API">
        <ol className="steps">
          <li>
            In <code>PalWorldSettings.ini</code>, set <code>RESTAPIEnabled=True</code> and an <code>AdminPassword</code>.
          </li>
          <li>
            Note <code>RESTAPIPort</code> (default <code>8212</code>) and restart the server.
          </li>
          <li>Keep that port private: allow it only from the panel’s host, never from the internet.</li>
        </ol>
        <p className="muted small">The password is encrypted at rest and never sent back to the browser.</p>
      </Card>
    </div>
  );
}

function UserSettings() {
  const { session } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ users: User[] }>('/users');
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<User | null>(null);
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

  const issueReset = async (user: User) => {
    try {
      const { token } = await api.post<{ token: string }>(`/users/${user.id}/password-reset`);
      setResetLink(`${window.location.origin}/reset-password?token=${encodeURIComponent(token)}`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Card title="Panel users" actions={<Button variant="primary" onClick={() => setCreating(true)}>Add user</Button>}>
      <Table
        rows={data?.users ?? []}
        rowKey={(u) => u.id}
        columns={[
          { key: 'username', header: 'Username', render: (u) => <strong>{u.username}</strong> },
          {
            key: 'role',
            header: 'Role',
            render: (u) => (
              <Select value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })} aria-label={`Role for ${u.username}`}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            ),
          },
          { key: 'status', header: 'Status', render: (u) => (u.disabled ? <Badge tone="error">Disabled</Badge> : <Badge tone="success">Active</Badge>) },
          { key: 'last', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAt) },
          {
            key: 'actions',
            header: '',
            className: 'actions-cell',
            render: (u) => (
              <div className="button-row">
                <Button onClick={() => issueReset(u)}>Reset link</Button>
                {u.id !== session?.user.id &&
                  (u.disabled ? (
                    <Button onClick={() => update(u, { disabled: false })}>Enable</Button>
                  ) : (
                    <Button variant="danger" onClick={() => setDisabling(u)}>
                      Disable
                    </Button>
                  ))}
              </div>
            ),
          },
        ]}
      />
      <CreateUserModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      <ConfirmDialog
        open={!!disabling}
        title="Disable user"
        danger
        confirmLabel="Disable"
        message={<p>{disabling?.username} will be signed out and won’t be able to sign in until re-enabled.</p>}
        onConfirm={() => (disabling ? update(disabling, { disabled: true }) : undefined)}
        onClose={() => setDisabling(null)}
      />
      <Modal open={!!resetLink} title="Password reset link" onClose={() => setResetLink(undefined)}>
        <p>Share this link privately. It works once and expires in one hour.</p>
        <Input readOnly value={resetLink ?? ''} onFocus={(e) => e.target.select()} />
      </Modal>
    </Card>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const notify = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/users', { username, password, role });
      notify(`Created ${username}`, 'success');
      setUsername('');
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
    <Modal open={open} title="Add user" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </Field>
        <Field label="Temporary password" hint="At least 10 characters. Ask them to change it after signing in.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <div className="button-row end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create user
          </Button>
        </div>
      </form>
    </Modal>
  );
}
