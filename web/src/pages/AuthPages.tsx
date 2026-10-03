import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage, DiscordButton } from '../auth/discord';
import { Brand } from '../components/Brand';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Brand size="lg" />
            <Box>
              <Typography variant="h5" component="h1">
                {title}
              </Typography>
              {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
            </Box>
            {children}
          </Stack>
        </CardContent>
      </Card>
    </Box>
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

/** Starts a Discord flow; shows its own error if starting fails. */
function DiscordSignIn({ label, onClick }: { label: string; onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      <DiscordButton
        size="large"
        fullWidth
        loading={busy}
        loadingPosition="start"
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await onClick();
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        {busy ? 'Redirecting to Discord…' : label}
      </DiscordButton>
    </>
  );
}

const OrDivider = ({ label }: { label: string }) => (
  <Divider>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
  </Divider>
);

/** Error handed back by the Discord callback, shown once and then removed from the URL. */
function useCallbackError() {
  const [params, setParams] = useSearchParams();
  const [message] = useState(() => authErrorMessage(params.get('auth_error'), params.get('discord_id')));
  useEffect(() => {
    if (params.has('auth_error')) setParams({}, { replace: true });
  }, [params, setParams]);
  return message;
}

export function LoginPage() {
  const { login, startDiscord, options } = useAuth();
  const callbackError = useCallbackError();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, onSubmit } = useSubmit(() => login(username, password));
  const { discord, password: passwordEnabled } = options.providers;

  return (
    <AuthCard title="Sign in" subtitle="Manage your Palworld server">
      {callbackError && <Alert severity="error">{callbackError}</Alert>}
      {discord && <DiscordSignIn label="Sign in with Discord" onClick={() => startDiscord('login')} />}
      {discord && passwordEnabled && <OrDivider label="or use a password" />}
      {passwordEnabled && (
        <Stack component="form" spacing={2} onSubmit={onSubmit}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Username" autoFocus={!discord} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button variant={discord ? 'outlined' : 'contained'} type="submit" size="large" loading={busy}>
            Sign in with password
          </Button>
        </Stack>
      )}
      <Typography variant="body2" color="text.secondary" align="center">
        {discord ? 'Need access? Ask a panel owner to add your Discord account.' : 'Forgot your password? Ask a panel owner for a reset link.'}
      </Typography>
      {options.providers.emergency && <EmergencySignIn />}
    </AuthCard>
  );
}

/** The owner's way in when Discord sign-in is broken (PANEL_EMERGENCY_PASSWORD). */
function EmergencySignIn() {
  const { emergencyLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const { error, busy, onSubmit } = useSubmit(() => emergencyLogin(password));

  if (!open) {
    return (
      <Typography variant="body2" align="center">
        <Link component="button" type="button" onClick={() => setOpen(true)}>
          Emergency sign-in
        </Link>
      </Typography>
    );
  }
  return (
    <Stack component="form" spacing={2} onSubmit={onSubmit}>
      <Divider />
      <Typography variant="body2" color="text.secondary">
        Signs you in as the owner with the emergency password from the server’s settings. Every use is recorded in the audit log.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField label="Emergency password" type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button variant="outlined" color="warning" type="submit" loading={busy}>
        Sign in as owner
      </Button>
    </Stack>
  );
}

export function SetupPage() {
  const { completeSetup, startDiscord, options } = useAuth();
  const callbackError = useCallbackError();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { error, busy, onSubmit } = useSubmit(async () => {
    if (!token.trim()) throw new Error('Enter the setup token first');
    if (password !== confirm) throw new Error('Passwords do not match');
    await completeSetup(token.trim(), username, password);
  });
  const { discord, password: passwordEnabled } = options.providers;

  return (
    <AuthCard title="Create the owner account" subtitle="First-time setup. The setup token is printed in the panel’s server log.">
      {callbackError && <Alert severity="error">{callbackError}</Alert>}
      <TextField label="Setup token" autoFocus value={token} onChange={(e) => setToken(e.target.value)} required />
      {discord && (
        <DiscordSignIn
          label="Continue with Discord"
          onClick={async () => {
            if (!token.trim()) throw new Error('Enter the setup token first');
            await startDiscord('setup', token.trim());
          }}
        />
      )}
      {discord && passwordEnabled && <OrDivider label="or create a password account" />}
      {passwordEnabled && (
        <Stack component="form" spacing={2} onSubmit={onSubmit}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Username" helperText="3-32 characters: letters, numbers, . - _" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <TextField label="Password" helperText="At least 10 characters" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button variant={discord ? 'outlined' : 'contained'} type="submit" size="large" loading={busy}>
            Create owner account
          </Button>
        </Stack>
      )}
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
        <Alert severity="success">Your password has been changed. You can sign in now.</Alert>
        <Button variant="contained" size="large" onClick={() => navigate('/')}>
          Go to sign in
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="New password" helperText="At least 10 characters" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <Button variant="contained" type="submit" size="large" loading={busy}>
          Set password
        </Button>
        <Link component={RouterLink} to="/" variant="body2">
          Back to sign in
        </Link>
      </Stack>
    </AuthCard>
  );
}
