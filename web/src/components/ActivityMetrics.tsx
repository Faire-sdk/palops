import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { useState, type KeyboardEvent } from 'react';
import type { ServerMetrics } from '../api/types';
import { formatDateTime, formatDuration } from '../format';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Section, Stat } from './common';

/** Small bar chart: one bar per item, scaled to the biggest; hover or the arrow keys show each value. */
export function Bars({ name, items, height = 72 }: { name: string; items: Array<{ label: string; value: number; tip: string }>; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  // The bar under the pointer or picked with the arrow keys; its value shows below the chart.
  const [active, setActive] = useState<number | null>(null);
  const last = items.length - 1;

  const onKeyDown = (e: KeyboardEvent) => {
    const from = active ?? last;
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  return (
    <Box
      role="group"
      tabIndex={0}
      aria-label={`${name}. Use the left and right arrow keys to read each bar.`}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((a) => a ?? last)}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
      sx={{ borderRadius: 1 }}
    >
      <Box aria-hidden sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height }}>
        {items.map((i, n) => (
          <Box
            key={i.label}
            onMouseEnter={() => setActive(n)}
            sx={{
              flex: 1,
              minWidth: 0,
              height: `${Math.max(i.value > 0 ? 4 : 1, (i.value / max) * 100)}%`,
              bgcolor: i.value > 0 ? 'primary.main' : 'divider',
              borderRadius: '2px 2px 0 0',
              opacity: i.value > 0 ? (active === null || active === n ? 0.85 : 0.45) : 1,
            }}
          />
        ))}
      </Box>
      <Box aria-hidden sx={{ display: 'flex', gap: '3px', mt: 0.5 }}>
        {items.map((i, n) => (
          <Typography key={i.label} variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, visibility: n % Math.ceil(items.length / 8) === 0 ? 'visible' : 'hidden' }}>
            {i.label}
          </Typography>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ minHeight: 20, mt: 0.5 }}>
        {active !== null ? items[active]?.tip : ''}
      </Typography>
    </Box>
  );
}

/** Playtime per day, for the profile and the server metrics. */
export function DailyPlaytime({ daily }: { daily: Array<{ day: string; seconds: number; players?: number }> }) {
  return (
    <Bars
      name="Playtime per day"
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
            ['Average visit', m.averageSessionSeconds ? formatDuration(m.averageSessionSeconds) : 'No visits yet', `${m.sessions30d} visits in 30 days`],
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
          <Bars name="Busiest hours" items={m.busiestHours.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}`, value: h.seconds, tip: `${String(h.hour).padStart(2, '0')}:00 UTC: ${formatDuration(h.seconds)} of playtime` }))} />
        </Grid>
      </Grid>
    </Section>
  );
}
