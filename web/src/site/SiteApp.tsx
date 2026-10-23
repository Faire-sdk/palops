import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link as RouterLink, Route, Routes } from 'react-router-dom';
import { useSiteAccent } from '../accent';
import { api, ApiError } from '../api/client';
import { DiscordButton } from '../auth/discord';
import { Brand } from '../components/Brand';
import { SkipLink } from '../components/common';
import { ThemeModeButton } from '../components/ThemeModeButton';
import { useApi } from '../hooks/useApi';
import { AccountPage } from './AccountPage';
import { HomePage } from './HomePage';
import { PlayerProfilePage } from './PlayerProfilePage';
import { PlayersPage } from './PlayersPage';
import type { PlayerProfile, PublicServer } from './types';

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

interface SiteLink {
  label: string;
  /** A page of this site. */
  to?: string;
  /** Anything else: a section of the home page or the Discord invite. */
  href?: string;
  external?: boolean;
}

/** Phones: the header links behind a labelled Menu button instead of disappearing. */
function SiteMenu({ links }: { links: SiteLink[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <Box component="nav" aria-label="Site" sx={{ display: { md: 'none' } }}>
      <Button
        color="inherit"
        startIcon={<MenuIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? 'site-menu' : undefined}
      >
        Menu
      </Button>
      <Menu id="site-menu" anchorEl={anchor} open={!!anchor} onClose={close}>
        {links.map((l) =>
          l.to ? (
            <MenuItem key={l.label} component={RouterLink} to={l.to} onClick={close}>
              {l.label}
            </MenuItem>
          ) : (
            <MenuItem key={l.label} component="a" href={l.href} onClick={close} {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
              {l.label}
            </MenuItem>
          ),
        )}
      </Menu>
    </Box>
  );
}

/** The public website for the server, meant as its main site. */
export default function SiteApp() {
  const session = usePlayerSession();
  const server = useApi<PublicServer>('/public/server', { pollMs: 30000 });
  useSiteAccent(server.data ? server.data.accentColor : undefined);
  const name = server.data?.name ?? 'Palworld server';
  const links: SiteLink[] = [
    { label: 'Home', to: '/' },
    { label: 'How to join', href: '/#join' },
    ...(server.data?.showOnlinePlayers ? [{ label: 'Players', to: '/players' }] : []),
    ...(server.data?.discordInvite ? [{ label: 'Discord', href: server.data.discordInvite, external: true }] : []),
  ];
  useEffect(() => {
    if (server.data?.name) document.title = server.data.name;
  }, [server.data?.name]);

  return (
    <BrowserRouter>
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <SkipLink />
        <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Container>
            <Toolbar disableGutters sx={{ gap: { xs: 1, sm: 2 } }}>
              <Box
                component={RouterLink}
                to="/"
                sx={{ color: 'inherit', textDecoration: 'none', minWidth: 0, flexShrink: 1, display: 'flex', alignItems: 'center', '@media (pointer: coarse)': { minHeight: 44 } }}
              >
                <Brand name={name} />
              </Box>
              <Stack component="nav" aria-label="Site" direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, ml: 2 }}>
                {links.map((l) =>
                  l.to ? (
                    <Button key={l.label} color="inherit" component={RouterLink} to={l.to}>
                      {l.label}
                    </Button>
                  ) : (
                    <Button key={l.label} color="inherit" href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                      {l.label}
                    </Button>
                  ),
                )}
              </Stack>
              <Box sx={{ flexGrow: 1 }} />
              <SiteMenu links={links} />
              <ThemeModeButton />
              {session.profile ? (
                <Button variant="outlined" component={RouterLink} to="/account" sx={{ flexShrink: 0 }}>
                  {session.profile.character?.name ?? session.profile.account.discord.username ?? 'My account'}
                </Button>
              ) : (
                server.data?.playerLogin && (
                  <DiscordButton onClick={() => session.signIn()} disabled={session.loading} sx={{ flexShrink: 0 }}>
                    Sign in
                  </DiscordButton>
                )
              )}
            </Toolbar>
          </Container>
        </AppBar>

        <Box component="main" id="main" tabIndex={-1} sx={{ flexGrow: 1 }}>
          <Routes>
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/players/:id" element={<PlayerProfilePage />} />
            <Route path="/account" element={<AccountPage session={session} enabled={server.data?.playerLogin ?? true} />} />
            <Route path="*" element={<HomePage server={server} session={session} />} />
          </Routes>
        </Box>

        <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: 3, mt: 6 }}>
          <Container>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">
                © {new Date().getFullYear()} {name}. Not affiliated with Pocketpair.
              </Typography>
              <Link href="/panel" variant="body2" color="text.secondary" sx={{ alignSelf: 'flex-start', '@media (pointer: coarse)': { display: 'inline-flex', alignItems: 'center', minHeight: 44 } }}>
                Staff panel
              </Link>
            </Stack>
          </Container>
        </Box>
      </Box>
    </BrowserRouter>
  );
}
