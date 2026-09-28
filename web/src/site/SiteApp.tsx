import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { DiscordLogo } from '../auth/discord';
import { useApi } from '../hooks/useApi';
import { AccountPage } from './AccountPage';
import { HomePage } from './HomePage';
import type { PlayerProfile, PublicServer } from './types';
import './site.css';

export interface PlayerSession {
  profile: PlayerProfile | null;
  loading: boolean;
  setProfile: (p: PlayerProfile | null) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

function usePlayerSession(): PlayerSession {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<PlayerProfile>('/site/me')
      .then(setProfile)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async () => {
    const { url } = await api.post<{ url: string }>('/auth/discord/authorize', { intent: 'player' });
    window.location.assign(url);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/site/logout').catch(() => undefined);
    setProfile(null);
  }, []);

  return { profile, loading, setProfile, signIn, signOut };
}

/** The public website for the server, meant as its main site. */
export default function SiteApp() {
  const session = usePlayerSession();
  const server = useApi<PublicServer>('/public/server', { pollMs: 30000 });
  useEffect(() => {
    if (server.data?.name) document.title = server.data.name;
  }, [server.data?.name]);

  return (
    <BrowserRouter>
      <div className="site">
        <header className="site-header">
          <div className="site-container site-header-inner">
            <Link to="/" className="site-brand">
              <span className="brand-mark">P</span>
              <span>{server.data?.name ?? 'Palworld server'}</span>
            </Link>
            <nav className="site-nav">
              <NavLink to="/" end>
                Home
              </NavLink>
              <a href="/#join">How to join</a>
              {server.data?.showOnlinePlayers && <a href="/#players">Players</a>}
              {server.data?.discordInvite && (
                <a href={server.data.discordInvite} target="_blank" rel="noreferrer">
                  Discord
                </a>
              )}
            </nav>
            <div className="site-header-actions">
              {session.profile ? (
                <Link to="/account" className="btn btn-secondary">
                  {session.profile.character?.name ?? session.profile.account.discord.username ?? 'My account'}
                </Link>
              ) : (
                server.data?.playerLogin && (
                <button className="btn btn-discord-inline" onClick={() => session.signIn()} disabled={session.loading}>
                  <DiscordLogo size={16} /> Sign in
                </button>
                )
              )}
            </div>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/account" element={<AccountPage session={session} enabled={server.data?.playerLogin ?? true} />} />
            <Route path="*" element={<HomePage server={server} session={session} />} />
          </Routes>
        </main>

        <footer className="site-footer">
          <div className="site-container site-footer-inner">
            <span className="muted">© {new Date().getFullYear()} {server.data?.name ?? 'Palworld server'}. Not affiliated with Pocketpair.</span>
            <a href="/panel" className="muted">
              Staff panel
            </a>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
