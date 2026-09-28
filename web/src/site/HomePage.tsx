import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { DiscordButton } from '../auth/discord';
import { Mono } from '../components/common';
import { formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import type { PlayerSession } from './SiteApp';
import type { PublicGuild, PublicPlayer, PublicServer } from './types';

interface Props {
  server: { data?: PublicServer; loading: boolean; error?: Error };
  session: PlayerSession;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
      {children}
    </Typography>
  );
}

export function HomePage({ server, session }: Props) {
  const s = server.data;
  const players = useApi<{ players: PublicPlayer[] }>('/public/players', { pollMs: 30000, enabled: !!s?.showOnlinePlayers });
  const guilds = useApi<{ guilds: PublicGuild[] }>('/public/guilds', { pollMs: 60000, enabled: !!s?.showOnlinePlayers });
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
      <Box
        component="section"
        sx={(theme) => ({
          py: { xs: 7, md: 11 },
          background: `radial-gradient(1000px 420px at 15% 0%, ${theme.alpha(theme.vars!.palette.primary.main, 0.22)}, transparent 70%), radial-gradient(700px 360px at 90% 10%, ${theme.alpha(theme.vars!.palette.secondary.main, 0.18)}, transparent 70%)`,
        })}
      >
        <Container>
          <Stack spacing={3} sx={{ maxWidth: 760 }}>
            <div>
              <Chip
                label={!s ? 'Checking server…' : online ? 'Server online' : 'Server offline'}
                color={!s ? 'default' : online ? 'success' : 'error'}
                variant="outlined"
              />
            </div>
            <Typography variant="h2" component="h1" sx={{ fontWeight: 700, fontSize: { xs: 38, md: 56 }, lineHeight: 1.1 }}>
              {s?.name ?? 'Palworld server'}
            </Typography>
            <Typography variant="h6" component="p" color="text.secondary" sx={{ fontWeight: 400 }}>
              {s?.description || 'A community Palworld server. Catch, build and explore with friends.'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {s?.joinAddress && (
                <Button variant="contained" size="large" onClick={copyAddress} startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}>
                  {copied ? 'Copied!' : `Join: ${s.joinAddress}`}
                </Button>
              )}
              {s?.discordInvite && (
                <DiscordButton size="large" href={s.discordInvite} target="_blank" rel="noreferrer">
                  Join our Discord
                </DiscordButton>
              )}
              {!session.profile && s?.playerLogin && (
                <Button variant="outlined" size="large" onClick={() => session.signIn()}>
                  Sign in to see your character
                </Button>
              )}
              {session.profile && (
                <Button variant="outlined" size="large" component={RouterLink} to="/account">
                  My character
                </Button>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container>
        <Grid container spacing={2} sx={{ mb: 6 }}>
          {[
            ['Players online', s?.players ? `${s.players.online} / ${s.players.max}` : '—'],
            ['In-game day', s?.inGameDays ?? '—'],
            ['Uptime', s?.uptimeSeconds != null ? formatDuration(s.uptimeSeconds) : '—'],
            ['Players seen', s?.knownPlayers ?? '—'],
          ].map(([label, value]) => (
            <Grid key={label as string} size={{ xs: 6, md: 3 }}>
              <Card>
                <CardContent>
                  <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
                    {value}
                  </Typography>
                  <Typography color="text.secondary">{label}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {s?.showOnlinePlayers && (
          <Box component="section" id="players" sx={{ mb: 6, scrollMarginTop: 80 }}>
            <SectionTitle>Online now</SectionTitle>
            {players.loading && !players.data ? (
              <CircularProgress size={28} />
            ) : players.data && players.data.players.length > 0 ? (
              <Grid container spacing={1.5}>
                {players.data.players.map((p) => (
                  <Grid key={p.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                    <Card>
                      <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'center', '&:last-child': { pb: 2 } }}>
                        <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>{p.name.slice(0, 1).toUpperCase()}</Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography noWrap sx={{ fontWeight: 600 }}>
                            {p.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {p.level != null ? `Level ${p.level}` : 'Level unknown'}
                            {p.guild ? ` · ${p.guild}` : ''}
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography color="text.secondary">{online ? 'Nobody is online right now. Be the first!' : 'The server is offline.'}</Typography>
            )}
          </Box>
        )}

        {s?.showOnlinePlayers && !!guilds.data?.guilds.length && (
          <Box component="section" id="guilds" sx={{ mb: 6, scrollMarginTop: 80 }}>
            <SectionTitle>Guilds</SectionTitle>
            <Grid container spacing={1.5}>
              {guilds.data.guilds.map((g) => (
                <Grid key={g.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                  <Card sx={{ height: '100%' }}>
                    <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography noWrap sx={{ fontWeight: 600 }}>
                          {g.name}
                        </Typography>
                        {g.online > 0 && <Chip label={`${g.online} online`} color="success" variant="outlined" />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {g.members} {g.members === 1 ? 'member' : 'members'} · {g.bases} {g.bases === 1 ? 'base' : 'bases'}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 6 }} component="section" id="join" sx={{ scrollMarginTop: 80 }}>
            <SectionTitle>How to join</SectionTitle>
            <List disablePadding>
              {[
                ['Open Palworld', 'Choose Join Multiplayer Game.'],
                ['Enter the address', s?.joinAddress ? <>Type <Mono>{s.joinAddress}</Mono> and connect.</> : 'It’s shared in our Discord.'],
                ['Sign in here with Discord', 'Link your character to see your level and guild on this site.'],
              ].map(([title, text], i) => (
                <ListItem key={i} disableGutters alignItems="flex-start" sx={{ gap: 2 }}>
                  <Avatar sx={{ width: 32, height: 32, fontSize: 15, bgcolor: 'primary.main', color: 'primary.contrastText', mt: 0.5 }}>{i + 1}</Avatar>
                  <ListItemText primary={title} secondary={text} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
                </ListItem>
              ))}
            </List>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }} component="section">
            <SectionTitle>Server rules</SectionTitle>
            <List disablePadding>
              {[
                'Be respectful. No harassment, hate speech or spam.',
                'No cheating, exploits or third-party tools that give an advantage.',
                'Don’t grief or raid bases outside of agreed PvP.',
                'Staff decisions are final; appeal on Discord.',
              ].map((rule) => (
                <ListItem key={rule} disableGutters sx={{ gap: 1.5 }}>
                  <CheckIcon color="primary" fontSize="small" />
                  <ListItemText primary={rule} />
                </ListItem>
              ))}
            </List>
          </Grid>
        </Grid>
      </Container>
    </>
  );
}
