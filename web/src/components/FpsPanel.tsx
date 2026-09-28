import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useState } from 'react';
import type { WorldPerformance } from '../api/types';
import { useApi } from '../hooks/useApi';
import { EmptyState, ErrorState, Loading, Section, Stat } from './common';

/**
 * Server FPS over time with the average and lowest, from the world snapshots
 * the panel keeps for a week. For staff who can see world data.
 */
export function FpsPanel() {
  const [hours, setHours] = useState(24);
  const { data, error, loading, reload } = useApi<WorldPerformance>(`/world/performance?hours=${hours}`, { pollMs: 60000 });

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else if (data) {
    const known = data.timeline.map((t) => t.fps).filter((f): f is number => f !== null);
    const lowest = known.length ? Math.min(...known) : null;
    body = (
      <>
        <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
          <Stat label="Average FPS" value={data.avgFps ?? '—'} />
          <Stat label="Lowest FPS" value={lowest ?? '—'} />
          <Stat label="Snapshots" value={data.timeline.length} />
        </Stack>
        {data.timeline.length < 2 ? (
          <EmptyState title="Not enough snapshots yet">The graph fills in as the panel reads the world snapshot every 20 seconds. It needs world data switched on.</EmptyState>
        ) : (
          <FpsChart timeline={data.timeline} />
        )}
      </>
    );
  }

  return (
    <Section
      title="Server FPS and world size"
      action={
        <TextField select label="Period" value={hours} onChange={(e) => setHours(Number(e.target.value))} sx={{ minWidth: 140 }}>
          <MenuItem value={1}>Last hour</MenuItem>
          <MenuItem value={6}>Last 6 hours</MenuItem>
          <MenuItem value={24}>Last 24 hours</MenuItem>
          <MenuItem value={168}>Last 7 days</MenuItem>
        </TextField>
      }
    >
      {body}
    </Section>
  );
}

/** FPS (line) over characters in the world (shaded), as a plain SVG chart. */
function FpsChart({ timeline }: { timeline: WorldPerformance['timeline'] }) {
  const theme = useTheme();
  const W = 800;
  const H = 220;
  const pad = { l: 36, r: 12, t: 10, b: 24 };
  const maxFps = Math.max(60, ...timeline.map((t) => t.fps ?? 0));
  // Headroom so a steady world size doesn't fill the whole chart.
  const maxActors = Math.max(1, ...timeline.map((t) => t.actors)) * 1.6;
  const x = (i: number) => pad.l + (i / (timeline.length - 1)) * (W - pad.l - pad.r);
  const yFps = (v: number) => pad.t + (1 - v / maxFps) * (H - pad.t - pad.b);
  const yAct = (v: number) => pad.t + (1 - v / maxActors) * (H - pad.t - pad.b);
  const fpsPath = timeline.map((t, i) => (t.fps === null ? '' : `${i === 0 ? 'M' : 'L'}${x(i)},${yFps(t.fps)}`)).join(' ');
  const areaPath = `M${x(0)},${H - pad.b} ${timeline.map((t, i) => `L${x(i)},${yAct(t.actors)}`).join(' ')} L${x(timeline.length - 1)},${H - pad.b} Z`;
  const label = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${W} ${H}`} sx={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Server FPS over time">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={yFps(maxFps * f)} y2={yFps(maxFps * f)} stroke={theme.vars!.palette.divider} />
            <text x={pad.l - 6} y={yFps(maxFps * f) + 4} fontSize={11} textAnchor="end" fill={theme.vars!.palette.text.secondary}>
              {Math.round(maxFps * f)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={theme.vars!.palette.secondary.main} opacity={0.15} />
        <path d={fpsPath} fill="none" stroke={theme.vars!.palette.primary.main} strokeWidth={2} />
        <text x={pad.l} y={H - 6} fontSize={11} fill={theme.vars!.palette.text.secondary}>
          {label(timeline[0]!.at)}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize={11} textAnchor="end" fill={theme.vars!.palette.text.secondary}>
          {label(timeline[timeline.length - 1]!.at)}
        </text>
      </Box>
      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Typography variant="body2" color="primary">
          ━ Server FPS
        </Typography>
        <Typography variant="body2" color="secondary">
          ▆ Characters in the world
        </Typography>
      </Stack>
    </Box>
  );
}
