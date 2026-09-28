import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Permission, ServerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { discordAvatarUrl } from '../auth/discord';
import { useApi } from '../hooks/useApi';
import { Icon, type IconName } from './icons';
import { ServerStateBadge } from './ServerStateBadge';

const NAV: Array<{ to: string; label: string; icon: IconName; permission?: Permission }> = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', permission: 'server.view' },
  { to: '/players', label: 'Players', icon: 'players', permission: 'players.view' },
  { to: '/console', label: 'Console', icon: 'console', permission: 'console.view' },
  { to: '/server', label: 'Server', icon: 'server', permission: 'server.control' },
  { to: '/configuration', label: 'Configuration', icon: 'config', permission: 'config.view' },
  { to: '/logs', label: 'Logs', icon: 'logs', permission: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Layout() {
  const { session, can, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };
  const { data: status } = useApi<ServerStatus>('/server/status', { pollMs: 15000 });
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">P</span>
          <span>PalOps</span>
        </div>
        <nav>
          {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setNavOpen(false)}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{current?.label}</div>
          <div className="topbar-right">
            <div className="topbar-server">
              <span className="muted">{status?.info?.name ?? status?.connection?.name ?? 'Server'}</span>
              <ServerStateBadge state={status?.state} />
            </div>
            <div className="user-chip">
              {session?.user.discord && discordAvatarUrl(session.user.discord) ? (
                <img className="avatar-img" src={discordAvatarUrl(session.user.discord)!} alt="" />
              ) : (
                <span className="avatar">{session?.user.username.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="user-meta">
                <strong>{session?.user.username}</strong>
                <span className="muted">{session?.user.role}</span>
              </span>
            </div>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
