import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { authErrorMessage, DiscordButton, DiscordLogo, discordAvatarUrl } from '../auth/discord';
import { KeyValue, Loading, Mono } from '../components/common';
import { formatDateTime, formatDuration } from '../format';
import { Link as RouterLink } from 'react-router-dom';
import type { PlayerSession } from './SiteApp';
import type { PlayerProfile } from './types';

export function AccountPage({ session, enabled }: { session: PlayerSession; enabled: boolean }) {
  const [params, setParams] = useSearchParams();
  const [error] = useState(() => authErrorMessage(params.get('auth_error')));
  useEffect(() => {
    if (params.has('auth_error')) setParams({}, { replace: true });
  }, [params, setParams]);

  if (session.loading) return <Loading />;

  if (!session.profile) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Card>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <Typography variant="h4" component="h1">
                Your character
              </Typography>
              <Typography color="text.secondary">Sign in with Discord to link your Palworld character and see your level and guild.</Typography>
              {error && <Alert severity="error">{error}</Alert>}
              {enabled ? (
                <DiscordButton size="large" onClick={() => session.signIn()}>
                  Sign in with Discord
                </DiscordButton>
              ) : (
                <Alert severity="info">Player sign-in isn’t set up on this server yet.</Alert>
              )}
              <Typography variant="body2" color="text.secondary">
                We only get your Discord username and avatar.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const { account, character } = session.profile;
  const avatar = discordAvatarUrl(account.discord);

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={2}>
        <Card>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, '&:last-child': { pb: 2 } }}>
            <Avatar src={avatar ?? undefined} sx={{ bgcolor: '#5865F2' }}>
              <DiscordLogo />
            </Avatar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">
                Signed in with Discord
              </Typography>
              <Typography noWrap sx={{ fontWeight: 600 }}>
                {account.discord.username ?? account.discord.id}
              </Typography>
            </Box>
            <Button onClick={() => session.signOut()}>Sign out</Button>
          </CardContent>
        </Card>

        {character ? <CharacterCard session={session} /> : <LinkCharacter onLinked={session.setProfile} />}
      </Stack>
    </Container>
  );
}

function CharacterCard({ session }: { session: PlayerSession }) {
  const c = session.profile!.character!;
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, fontSize: 28, bgcolor: 'primary.main', color: 'primary.contrastText' }}>{c.name.slice(0, 1).toUpperCase()}</Avatar>
            <Box>
              <Typography variant="h4" component="h1">
                {c.name}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Chip label={c.online ? 'Online now' : 'Offline'} color={c.online ? 'success' : 'default'} variant="outlined" />
                {c.verified ? <Chip label="Verified" color="success" /> : <Chip label="Not verified yet" color="warning" variant="outlined" />}
              </Stack>
            </Box>
          </Stack>

          <Grid container spacing={2}>
            {[
              ['Level', c.level ?? '—'],
              ['Guild', c.guild ?? '—'],
              ['Time played', formatDuration(c.playtimeSeconds)],
              ['Visits', c.sessions],
            ].map(([label, value]) => (
              <Grid key={label as string} size={6}>
                <Card sx={{ bgcolor: 'action.hover', border: 0 }}>
                  <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                    <Typography variant="h5" component="div" sx={{ fontWeight: 700 }} noWrap>
                      {value}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {label}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <KeyValue
            items={[
              ['First seen', formatDateTime(c.firstSeenAt)],
              ['Last seen', c.online ? 'Now' : formatDateTime(c.lastSeenAt)],
              ['Platform ID', <Mono>{c.platformId}</Mono>],
            ]}
          />
          {!c.guild && (
            <Typography variant="body2" color="text.secondary">
              Guild info appears once the server reports it.
            </Typography>
          )}
          {c.verified ? (
            <Typography variant="body2" color="text.secondary">
              Verified by {c.verifiedBy}{c.verifiedAt ? ` on ${formatDateTime(c.verifiedAt)}` : ''}.
            </Typography>
          ) : (
            <VerifyCharacter session={session} />
          )}
          <FormControlLabel
            control={
              <Switch
                checked={session.profile!.privacy.showDiscord}
                onChange={async (e) => session.setProfile(await api.post<PlayerProfile>('/site/privacy', { showDiscord: e.target.checked }))}
              />
            }
            label="Show my Discord name on my public profile"
          />
          <Divider />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="outlined" component={RouterLink} to={`/players/${c.profileId}`}>
              View my public profile
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  session.setProfile(await api.post<PlayerProfile>('/site/unlink'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Not you? Unlink this character
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Proving the character is yours: a code sent in the game, or a request for staff to confirm. */
function VerifyCharacter({ session }: { session: PlayerSession }) {
  const c = session.profile!.character!;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'confirm' | 'request' | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string }>();
  const [sent, setSent] = useState(c.verification.codePending);

  const run = async (kind: 'send' | 'confirm' | 'request') => {
    setBusy(kind);
    setMessage(undefined);
    try {
      if (kind === 'send') {
        await api.post('/site/verify/code');
        setSent(true);
        setMessage({ severity: 'success', text: 'A code was sent to you in the game. Check your chat, then enter it below. It works for 10 minutes.' });
      } else if (kind === 'confirm') {
        session.setProfile(await api.post<PlayerProfile>('/site/verify/confirm', { code }));
      } else {
        session.setProfile(await api.post<PlayerProfile>('/site/verify/request'));
        setMessage({ severity: 'info', text: 'Thanks. Server staff will review your request.' });
      }
    } catch (err) {
      setMessage({ severity: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card sx={{ bgcolor: 'action.hover', border: 0 }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography sx={{ fontWeight: 600 }}>Verify that this is you</Typography>
          <Typography variant="body2" color="text.secondary">
            Anyone can claim a name, so PalOps only gives Discord roles and links your Discord account to your character once you’ve proved it’s yours.
          </Typography>
          {c.verification.inGameCode && (
            <Stack spacing={1}>
              <div>
                <Button variant="contained" onClick={() => run('send')} loading={busy === 'send'} disabled={!c.online}>
                  Send me a code in the game
                </Button>
                {!c.online && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Join the server with this character first.
                  </Typography>
                )}
              </div>
              {sent && (
                <Stack direction="row" spacing={1} component="form" onSubmit={(e) => (e.preventDefault(), void run('confirm'))}>
                  <TextField label="Code from the game" value={code} onChange={(e) => setCode(e.target.value)} slotProps={{ htmlInput: { maxLength: 16, autoComplete: 'off' } }} />
                  <Button variant="outlined" type="submit" loading={busy === 'confirm'} disabled={code.trim().length < 4}>
                    Verify
                  </Button>
                </Stack>
              )}
            </Stack>
          )}
          {c.verification.requestedAt ? (
            <Typography variant="body2" color="text.secondary">
              You asked staff to verify you on {formatDateTime(c.verification.requestedAt)}.
            </Typography>
          ) : (
            <div>
              <Button onClick={() => run('request')} loading={busy === 'request'}>
                {c.verification.inGameCode ? 'Or ask staff to verify me' : 'Ask staff to verify me'}
              </Button>
            </div>
          )}
          {message && <Alert severity={message.severity}>{message.text}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

function LinkCharacter({ onLinked }: { onLinked: (p: PlayerProfile) => void }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onLinked(await api.post<PlayerProfile>('/site/link', { query }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Stack component="form" spacing={2} onSubmit={submit}>
          <Typography variant="h5" component="h2">
            Link your character
          </Typography>
          <Typography color="text.secondary">
            Enter your in-game character name. If several players share it, use your platform ID (like <Mono>steam_7656…</Mono>). You need to have joined
            the server at least once.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Character name or platform ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
            slotProps={{ htmlInput: { minLength: 2, maxLength: 64 } }}
          />
          <div>
            <Button variant="contained" type="submit" loading={busy}>
              Link character
            </Button>
          </div>
        </Stack>
      </CardContent>
    </Card>
  );
}
