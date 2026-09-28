import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DiscordLogo } from '../auth/discord';
import { Spinner } from '../components/ui';
import { formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import type { PlayerSession } from './SiteApp';
import type { PublicPlayer, PublicServer } from './types';

interface Props {
  server: { data?: PublicServer; loading: boolean; error?: Error };
  session: PlayerSession;
}

export function HomePage({ server, session }: Props) {
  const s = server.data;
  const players = useApi<{ players: PublicPlayer[] }>('/public/players', { pollMs: 30000, enabled: !!s?.showOnlinePlayers });
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!s?.joinAddress) return;
    await navigator.clipboard.writeText(s.joinAddress).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const online = s?.state === 'online';

  return (
    <>
      <section className="hero">
        <div className="site-container hero-inner">
          <span className={`status-pill ${online ? 'is-online' : s ? 'is-offline' : ''}`}>
            <span className="dot" />
            {!s ? 'Checking server…' : online ? 'Server online' : 'Server offline'}
          </span>
          <h1>{s?.name ?? 'Palworld server'}</h1>
          <p className="hero-lead">
            {s?.description || 'A community Palworld server. Catch, build and explore with friends.'}
          </p>
          <div className="hero-actions">
            {s?.joinAddress && (
              <button className="btn btn-primary btn-lg" onClick={copyAddress}>
                {copied ? 'Copied!' : `Join: ${s.joinAddress}`}
              </button>
            )}
            {s?.discordInvite && (
              <a className="btn btn-discord-inline btn-lg" href={s.discordInvite} target="_blank" rel="noreferrer">
                <DiscordLogo /> Join our Discord
              </a>
            )}
            {!session.profile && s?.playerLogin && (
              <button className="btn btn-secondary btn-lg" onClick={() => session.signIn()}>
                Sign in to see your character
              </button>
            )}
            {session.profile && (
              <Link className="btn btn-secondary btn-lg" to="/account">
                My character
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="site-container stats-row">
        <SiteStat label="Players online" value={s?.players ? `${s.players.online} / ${s.players.max}` : '—'} />
        <SiteStat label="In-game day" value={s?.inGameDays ?? '—'} />
        <SiteStat label="Uptime" value={s?.uptimeSeconds != null ? formatDuration(s.uptimeSeconds) : '—'} />
        <SiteStat label="Players seen" value={s?.knownPlayers ?? '—'} />
      </section>

      {s?.showOnlinePlayers && (
        <section className="site-container site-section" id="players">
          <h2>Online now</h2>
          {players.loading && !players.data ? (
            <Spinner />
          ) : players.data && players.data.players.length > 0 ? (
            <div className="player-grid">
              {players.data.players.map((p) => (
                <div key={p.name} className="player-card">
                  <div className="player-avatar">{p.name.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      {p.level != null ? `Level ${p.level}` : 'Level unknown'}
                      {p.guild ? ` · ${p.guild}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{online ? 'Nobody is online right now. Be the first!' : 'The server is offline.'}</p>
          )}
        </section>
      )}

      <section className="site-container site-section" id="join">
        <h2>How to join</h2>
        <ol className="join-steps">
          <li>
            <strong>Open Palworld</strong> and choose <em>Join Multiplayer Game</em>.
          </li>
          <li>
            <strong>Enter the address</strong> {s?.joinAddress ? <code>{s.joinAddress}</code> : 'shared in our Discord'} and connect.
          </li>
          <li>
            <strong>Sign in here with Discord</strong> and link your character to see your level and guild on this site.
          </li>
        </ol>
      </section>

      <section className="site-container site-section">
        <h2>Server rules</h2>
        <ul className="rules">
          <li>Be respectful. No harassment, hate speech or spam.</li>
          <li>No cheating, exploits or third-party tools that give an advantage.</li>
          <li>Don’t grief or raid bases outside of agreed PvP.</li>
          <li>Staff decisions are final; appeal on Discord.</li>
        </ul>
      </section>
    </>
  );
}

function SiteStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="site-stat">
      <div className="site-stat-value">{value}</div>
      <div className="site-stat-label">{label}</div>
    </div>
  );
}
