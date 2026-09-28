import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ServerMetrics } from '../api/types';
import { formatDateTime, formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Section, Stat } from './common';

/** Small bar chart: one bar per item, scaled to the biggest, with a tooltip for each. */
export function Bars({ items, height = 72 }: { items: Array<{ label: string; value: number; tip: string }>; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height }}>
        {items.map((i) => (
          <Tooltip key={i.label} title={i.tip} arrow>
            <Box
              sx={{ flex: 1, minWidth: 0, height: `${Math.max(i.value > 0 ? 4 : 1, (i.value / max) * 100)}%`, bgcolor: i.value > 0 ? 'primary.main' : 'divider', borderRadius: '2px 2px 0 0', opacity: i.value > 0 ? 0.85 : 1 }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: '3px', mt: 0.5 }}>
        {items.map((i, n) => (
          <Typography key={i.label} variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, visibility: n % Math.ceil(items.length / 8) === 0 ? 'visible' : 'hidden' }}>
            {i.label}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/** Playtime per day, for the profile and the server metrics. */
export function DailyPlaytime({ daily }: { daily: Array<{ day: string; seconds: number; players?: number }> }) {
  return (
    <Bars
      items={daily.map((d) => ({
        label: d.day.slice(5),
        value: d.seconds,
        tip: `${d.day}: ${d.seconds ? formatDuration(d.seconds) : 'no playtime'}${d.players !== undefined ? ` · ${d.players} ${d.players === 1 ? 'player' : 'players'}` : ''}`,
      }))}
    />
  );
}

/** Playtime, visits and busy hours for the whole server, from the recorded visits. */
export function ServerActivity() {
  const { data, error, loading, reload } = useApi<ServerMetrics>('/players/metrics', { pollMs: 60000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const m = data!;
  return (
    <Section title="Activity">
      <Grid container spacing={3}>
        {(
          [
            ['Players (24 h)', m.uniquePlayers.day, `${m.uniquePlayers.week} this week · ${m.uniquePlayers.month} this month`],
            ['Playtime (7 days)', formatDuration(m.playtimeSeconds.week), `${formatDuration(m.playtimeSeconds.day)} in the last 24 h`],
            ['Average visit', m.averageSessionSeconds ? formatDuration(m.averageSessionSeconds) : '—', `${m.sessions30d} visits in 30 days`],
            ['Peak players online', m.peakConcurrent.count, m.peakConcurrent.at ? `${formatDateTime(m.peakConcurrent.at)} (30 days)` : 'No visits yet'],
            ['New players (7 days)', m.newPlayers7d, `${m.knownPlayers} players seen in total`],
          ] as const
        ).map(([label, value, hint]) => (
          <Grid key={label} size={{ xs: 6, md: 3, lg: 2.4 }}>
            <Stat label={label} value={value} hint={hint} />
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Playtime per day, last 14 days
          </Typography>
          <DailyPlaytime daily={m.daily} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Busiest hours, last 30 days (UTC)
          </Typography>
          <Bars items={m.busiestHours.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}`, value: h.seconds, tip: `${String(h.hour).padStart(2, '0')}:00 UTC: ${formatDuration(h.seconds)} of playtime` }))} />
        </Grid>
      </Grid>
    </Section>
  );
}
