import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link as RouterLink, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { DiscordButton } from '../auth/discord';
import { Brand } from '../components/Brand';
import { useApi } from '../hooks/useApi';
import { AccountPage } from './AccountPage';
import { HomePage } from './HomePage';
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

/** The public website for the server, meant as its main site. */
export default function SiteApp() {
  const session = usePlayerSession();
  const server = useApi<PublicServer>('/public/server', { pollMs: 30000 });
  const name = server.data?.name ?? 'Palworld server';
  useEffect(() => {
    if (server.data?.name) document.title = server.data.name;
  }, [server.data?.name]);

  return (
    <BrowserRouter>
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Container>
            <Toolbar disableGutters sx={{ gap: 2 }}>
              <Box component={RouterLink} to="/" sx={{ color: 'inherit', textDecoration: 'none', minWidth: 0, flexShrink: 1 }}>
                <Brand name={name} />
              </Box>
              <Stack component="nav" direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, ml: 2 }}>
                <Button color="inherit" component={RouterLink} to="/">
                  Home
                </Button>
                <Button color="inherit" href="/#join">
                  How to join
                </Button>
                {server.data?.showOnlinePlayers && (
                  <Button color="inherit" href="/#players">
                    Players
                  </Button>
                )}
                {server.data?.discordInvite && (
                  <Button color="inherit" href={server.data.discordInvite} target="_blank" rel="noreferrer">
                    Discord
                  </Button>
                )}
              </Stack>
              <Box sx={{ flexGrow: 1 }} />
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

        <Box component="main" sx={{ flexGrow: 1 }}>
          <Routes>
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
              <Link href="/panel" variant="body2" color="text.secondary">
                Staff panel
              </Link>
            </Stack>
          </Container>
        </Box>
      </Box>
    </BrowserRouter>
  );
}
