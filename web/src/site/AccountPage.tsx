import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { authErrorMessage, DiscordLogo, discordAvatarUrl } from '../auth/discord';
import { Alert, Badge, Button, Field, Input, Loading } from '../components/ui';
import { formatDateTime } from '../format';
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
      <div className="site-container site-narrow">
        <div className="site-card center">
          <h1>Your character</h1>
          <p className="muted">Sign in with Discord to link your Palworld character and see your level and guild.</p>
          {error && <Alert tone="error">{error}</Alert>}
          {enabled ? (
            <button className="btn btn-discord" onClick={() => session.signIn()}>
              <DiscordLogo /> Sign in with Discord
            </button>
          ) : (
            <Alert tone="info">Player sign-in isn’t set up on this server yet.</Alert>
          )}
          <p className="muted small">We only get your Discord username and avatar.</p>
        </div>
      </div>
    );
  }

  const { account, character } = session.profile;
  const avatar = discordAvatarUrl(account.discord);

  return (
    <div className="site-container site-narrow">
      <div className="site-card">
        <div className="account-head">
          {avatar ? <img className="account-avatar" src={avatar} alt="" /> : <div className="account-avatar"><DiscordLogo size={22} /></div>}
          <div>
            <div className="muted small">Signed in with Discord</div>
            <strong>{account.discord.username ?? account.discord.id}</strong>
          </div>
          <Button variant="ghost" onClick={() => session.signOut()}>
            Sign out
          </Button>
        </div>
      </div>

      {character ? <CharacterCard session={session} /> : <LinkCharacter onLinked={session.setProfile} />}
    </div>
  );
}

function CharacterCard({ session }: { session: PlayerSession }) {
  const c = session.profile!.character!;
  const [busy, setBusy] = useState(false);
  return (
    <div className="site-card">
      <div className="character-head">
        <div className="player-avatar player-avatar-lg">{c.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h1>{c.name}</h1>
          <div className="character-badges">
            <Badge tone={c.online ? 'success' : 'neutral'}>
              <span className="dot" /> {c.online ? 'Online now' : 'Offline'}
            </Badge>
            {!c.verified && <Badge tone="warning">Unverified link</Badge>}
          </div>
        </div>
      </div>
      <div className="character-stats">
        <div>
          <div className="site-stat-value">{c.level ?? '—'}</div>
          <div className="site-stat-label">Level</div>
        </div>
        <div>
          <div className="site-stat-value">{c.guild ?? '—'}</div>
          <div className="site-stat-label">Guild</div>
        </div>
      </div>
      <dl className="kv">
        <dt>First seen</dt>
        <dd>{formatDateTime(c.firstSeenAt)}</dd>
        <dt>Last seen</dt>
        <dd>{c.online ? 'Now' : formatDateTime(c.lastSeenAt)}</dd>
        <dt>Platform ID</dt>
        <dd className="mono">{c.platformId}</dd>
      </dl>
      {!c.guild && <p className="muted small">Guild info appears once the server reports it.</p>}
      <div>
        <Button
          variant="ghost"
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
      </div>
    </div>
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
    <div className="site-card">
      <h2>Link your character</h2>
      <p className="muted">
        Enter your in-game character name. If several players share it, use your platform ID (like <code>steam_7656…</code>).
        You need to have joined the server at least once.
      </p>
      <form className="form" onSubmit={submit}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Character name or platform ID">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} required minLength={2} maxLength={64} />
        </Field>
        <div>
          <Button variant="primary" type="submit" loading={busy}>
            Link character
          </Button>
        </div>
      </form>
    </div>
  );
}
