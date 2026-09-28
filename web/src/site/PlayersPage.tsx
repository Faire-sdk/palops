import SearchIcon from '@mui/icons-material/Search';
import VerifiedIcon from '@mui/icons-material/Verified';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/common';
import { formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import type { DirectoryPlayer } from './types';

const SORTS = [
  { id: 'recent', label: 'Recently active' },
  { id: 'playtime', label: 'Most playtime' },
  { id: 'level', label: 'Highest level' },
  { id: 'name', label: 'A to Z' },
] as const;
const PAGE = 24;

/** Everyone who has played on the server, with playtime, so players can find each other. */
export function PlayersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('recent');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => (setQuery(search.trim()), setPage(0)), 300);
    return () => clearTimeout(t);
  }, [search]);
  const path = `/public/players/known?sort=${sort}&limit=${PAGE}&offset=${page * PAGE}${query ? `&search=${encodeURIComponent(query)}` : ''}`;
  const { data, error, loading, reload } = useApi<{ players: DirectoryPlayer[]; total: number }>(path);

  return (
    <Container sx={{ py: 5 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 0.5 }}>
        Players
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {data ? `${data.total} ${data.total === 1 ? 'player has' : 'players have'} played here.` : 'Everyone who has played on the server.'}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { sm: 'center' } }}>
        <TextField
          placeholder="Search by name or guild"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 300 } }}
          slotProps={{ htmlInput: { 'aria-label': 'Search players' }, input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {SORTS.map((s) => (
            <Chip key={s.id} label={s.label} color={sort === s.id ? 'primary' : 'default'} variant={sort === s.id ? 'filled' : 'outlined'} onClick={() => (setSort(s.id), setPage(0))} />
          ))}
        </Stack>
      </Stack>
      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data && data.players.length > 0 ? (
        <>
          <Grid container spacing={1.5}>
            {data.players.map((p) => (
              <Grid key={p.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card>
                  <CardActionArea component={RouterLink} to={`/players/${p.id}`}>
                    <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'center', '&:last-child': { pb: 2 } }}>
                      <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>{p.name.slice(0, 1).toUpperCase()}</Avatar>
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <Typography noWrap sx={{ fontWeight: 600 }}>
                            {p.name}
                          </Typography>
                          {p.verified && <VerifiedIcon color="primary" sx={{ fontSize: 16 }} titleAccess="Verified" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {p.level != null ? `Level ${p.level}` : 'Level unknown'}
                          {p.guild ? ` · ${p.guild}` : ''}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {formatDuration(p.playtimeSeconds)} played
                        </Typography>
                      </Box>
                      {p.online && <Chip label="Online" color="success" variant="outlined" size="small" />}
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          {data.total > PAGE && (
            <Stack sx={{ alignItems: 'center', mt: 3 }}>
              <Pagination count={Math.ceil(data.total / PAGE)} page={page + 1} onChange={(_, v) => setPage(v - 1)} color="primary" />
            </Stack>
          )}
        </>
      ) : (
        <EmptyState title={query ? 'No matching players' : 'No players yet'} />
      )}
    </Container>
  );
}
