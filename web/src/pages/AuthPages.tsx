import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Input } from '../components/ui';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-lg">
          <span className="brand-mark">P</span>
          <span>PalOps</span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, onSubmit } = useSubmit(() => login(username, password));

  return (
    <AuthCard title="Sign in" subtitle="Manage your Palworld server">
      <form className="form" onSubmit={onSubmit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Username">
          <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>
          Sign in
        </Button>
        <p className="muted small">Forgot your password? Ask a panel owner for a reset link.</p>
      </form>
    </AuthCard>
  );
}

export function SetupPage() {
  const { completeSetup } = useAuth();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { error, busy, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match');
    await completeSetup(token.trim(), username, password);
  });

  return (
    <AuthCard title="Create the owner account" subtitle="First-time setup. The setup token is printed in the panel’s server log.">
      <form className="form" onSubmit={onSubmit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Setup token">
          <Input autoFocus value={token} onChange={(e) => setToken(e.target.value)} required />
        </Field>
        <Field label="Username" hint="3-32 characters: letters, numbers, . - _">
          <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>
          Create owner account
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { error, busy, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('Passwords do not match');
    await api.post('/auth/reset', { token: params.get('token') ?? '', newPassword: password });
    setDone(true);
  });

  if (done) {
    return (
      <AuthCard title="Password updated">
        <Alert tone="success">Your password has been changed. You can sign in now.</Alert>
        <Button variant="primary" onClick={() => navigate('/')}>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="form" onSubmit={onSubmit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" hint="At least 10 characters">
          <Input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Confirm password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>
          Set password
        </Button>
        <Link className="small" to="/">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
