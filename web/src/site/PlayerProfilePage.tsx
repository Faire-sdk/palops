import VerifiedIcon from '@mui/icons-material/Verified';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { discordAvatarUrl, DiscordLogo } from '../auth/discord';
import { EmptyState, ErrorState, Loading } from '../components/common';
import { formatDateTime, formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import { prettyClass } from '../components/world';
import type { PublicProfile } from './types';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card sx={{ bgcolor: 'action.hover', border: 0, height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography variant="h5" component="div" sx={{ fontWeight: 700 }} noWrap>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

/** A player's public page: level, playtime, pals, guild and (only if they chose) their Discord name. */
export function PlayerProfilePage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<PublicProfile>(`/public/players/${encodeURIComponent(id ?? '')}`, { pollMs: 60000 });

  if (loading && !data) return <Loading />;
  if (error && !data) {
    return (
      <Container sx={{ py: 5 }}>
        {error instanceof ApiError && error.status === 404 ? <EmptyState title="No player found" /> : <ErrorState error={error} onRetry={reload} />}
        <Button component={RouterLink} to="/players" sx={{ mt: 2 }}>
          All players
        </Button>
      </Container>
    );
  }
  if (!data) return null;
  const avatar = data.discord ? discordAvatarUrl(data.discord) : null;

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Button component={RouterLink} to="/players" size="small" sx={{ mb: 2 }}>
        ← All players
      </Button>
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={3}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ width: 72, height: 72, fontSize: 32, bgcolor: 'primary.main', color: 'primary.contrastText' }}>{data.name.slice(0, 1).toUpperCase()}</Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="h4" component="h1" noWrap>
                    {data.name}
                  </Typography>
                  {data.verified && <VerifiedIcon color="primary" titleAccess="Verified: this player has proved this character is theirs" />}
                </Stack>
                <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                  <Chip label={data.online ? 'Online now' : `Last seen ${formatDateTime(data.lastSeenAt)}`} color={data.online ? 'success' : 'default'} variant="outlined" />
                  {data.guild && <Chip label={data.guild} variant="outlined" />}
                </Stack>
              </Box>
            </Stack>

            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stat label="Level" value={data.level ?? '—'} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stat label="Time played" value={formatDuration(data.playtimeSeconds)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stat label="Visits" value={data.sessions} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Stat label="Longest visit" value={formatDuration(data.longestSessionSeconds)} />
              </Grid>
            </Grid>

            {data.pals.length > 0 && (
              <Box>
                <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                  Strongest pals
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {data.pals.map((p, i) => (
                    <Chip key={i} color={p.active ? 'primary' : 'default'} variant={p.active ? 'filled' : 'outlined'} label={`${p.name || prettyClass(p.className) || 'Pal'} · Lv ${p.level ?? '?'}`} />
                  ))}
                </Stack>
              </Box>
            )}

            {data.guildInfo && (
              <Box>
                <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                  Guild
                </Typography>
                <Typography sx={{ fontWeight: 600 }}>{data.guildInfo.name}</Typography>
                <Typography color="text.secondary">
                  {data.guildInfo.members} {data.guildInfo.members === 1 ? 'member' : 'members'} · {data.guildInfo.online} online · {data.guildInfo.bases} {data.guildInfo.bases === 1 ? 'base' : 'bases'}
                </Typography>
              </Box>
            )}

            {data.discord && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Avatar src={avatar ?? undefined} sx={{ bgcolor: '#5865F2', width: 32, height: 32 }}>
                  <DiscordLogo />
                </Avatar>
                <Typography>{data.discord.username ?? 'Discord user'}</Typography>
              </Stack>
            )}

            <Typography variant="body2" color="text.secondary">
              Playing since {formatDateTime(data.firstSeenAt)}. Playtime is counted from the moments the server has seen this player online, so it can be a little short.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
