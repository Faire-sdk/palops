import AddIcon from '@mui/icons-material/Add';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { MapPoint, WorldMapData } from '../api/types';
import { palLabel, useGuildColor } from './world';

export type Layer = 'players' | 'bases' | 'basePals' | 'partyPals' | 'wildPals' | 'npcs';

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'bases', label: 'Bases' },
  { id: 'partyPals', label: 'Party pals' },
  { id: 'basePals', label: 'Base pals' },
  { id: 'wildPals', label: 'Wild pals' },
  { id: 'npcs', label: 'NPCs' },
];

interface View {
  cx: number;
  cy: number;
  /** Visible width in map units. */
  width: number;
}

const WORLD = 1000;
const GRID = 200;
const MIN_WIDTH = 40;
const MAX_WIDTH = 3000;

/** Fits a view around the given points, never smaller than the main island. */
function fit(points: MapPoint[]): View {
  const xs = [-WORLD, WORLD, ...points.map((p) => p.x)];
  const ys = [-WORLD, WORLD, ...points.map((p) => p.y)];
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: Math.max(maxX - minX, maxY - minY) * 1.05 };
}

/**
 * A live map drawn in in-game map coordinates (north up). There's no terrain
 * image: the game's map art isn't PalOps's to ship. Scroll or pinch to zoom,
 * drag to pan; markers keep their size at any zoom.
 */
export function WorldMap({
  map,
  focus,
  onPlayer,
  onBase,
}: {
  map: WorldMapData;
  focus?: MapPoint | null;
  onPlayer?: (userId: string) => void;
  onBase?: (baseId: number) => void;
}) {
  const theme = useTheme();
  const guildColor = useGuildColor();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [layers, setLayers] = useState<Set<Layer>>(new Set(['players', 'bases', 'partyPals', 'basePals']));
  const allPoints = useMemo(() => [...map.players, ...map.bases].map((p) => p.at), [map]);
  const [view, setView] = useState<View>(() => (focus ? { cx: focus.x, cy: focus.y, width: 300 } : fit(allPoints)));
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    if (focus) setView({ cx: focus.x, cy: focus.y, width: 300 });
  }, [focus]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      // Hidden or not yet laid out: keep the last size instead of dividing by zero.
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const unitsPerPx = view.width / size.w;
  const height = size.h * unitsPerPx;
  // SVG y grows downward; map y grows north, so flip it.
  const viewBox = `${view.cx - view.width / 2} ${-view.cy - height / 2} ${view.width} ${height}`;
  const r = (px: number) => px * unitsPerPx;

  const zoom = (factor: number, anchor?: MapPoint) =>
    setView((v) => {
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v.width * factor));
      const k = width / v.width;
      const a = anchor ?? { x: v.cx, y: v.cy };
      return { width, cx: a.x + (v.cx - a.x) * k, cy: a.y + (v.cy - a.y) * k };
    });

  const toMapPoint = (clientX: number, clientY: number): MapPoint => {
    const rect = box.current!.getBoundingClientRect();
    return { x: view.cx + (clientX - rect.left - rect.width / 2) * unitsPerPx, y: view.cy - (clientY - rect.top - rect.height / 2) * unitsPerPx };
  };

  const onWheel = (e: WheelEvent) => zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, toMapPoint(e.clientX, e.clientY));

  useEffect(() => {
    // React's onWheel is passive; stop the page from scrolling while zooming the map.
    const el = box.current;
    const stop = (e: globalThis.WheelEvent) => e.preventDefault();
    el?.addEventListener('wheel', stop, { passive: false });
    return () => el?.removeEventListener('wheel', stop);
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      // Capture only once it's a drag, so a plain click still reaches the marker.
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    setView({ ...d.view, cx: d.view.cx - dx * unitsPerPx, cy: d.view.cy + dy * unitsPerPx });
  };
  const onPointerUp = () => {
    // Keep the flag briefly so a drag doesn't also count as a click on a marker.
    setTimeout(() => (drag.current = null), 0);
  };
  const click = (fn: () => void) => () => {
    if (!drag.current?.moved) fn();
  };

  const toggle = (layer: Layer) =>
    setLayers((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  const counts: Record<Layer, number> = {
    players: map.players.length,
    bases: map.bases.length,
    partyPals: map.pals.filter((p) => p.kind === 'OtomoPal').length,
    basePals: map.pals.filter((p) => p.kind === 'BaseCampPal').length,
    wildPals: map.pals.filter((p) => p.kind === 'WildPal').length,
    npcs: map.npcs.length,
  };

  const gridLines = [];
  for (let v = -3000; v <= 3000; v += GRID) {
    const major = v === 0;
    const stroke = major ? theme.vars!.palette.text.secondary : theme.vars!.palette.divider;
    gridLines.push(<line key={`x${v}`} x1={v} x2={v} y1={-3000} y2={3000} stroke={stroke} strokeWidth={r(major ? 1.5 : 1)} />);
    gridLines.push(<line key={`y${v}`} y1={-v} y2={-v} x1={-3000} x2={3000} stroke={stroke} strokeWidth={r(major ? 1.5 : 1)} />);
  }
  const pal = (kind: 'OtomoPal' | 'BaseCampPal' | 'WildPal') => map.pals.filter((p) => p.kind === kind);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {LAYERS.map((l) => (
          <Chip
            key={l.id}
            label={`${l.label} (${counts[l.id]})`}
            color={layers.has(l.id) ? 'primary' : 'default'}
            variant={layers.has(l.id) ? 'filled' : 'outlined'}
            onClick={() => toggle(l.id)}
          />
        ))}
      </Stack>
      <Box
        ref={box}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        sx={{
          position: 'relative',
          height: { xs: 420, md: 600 },
          borderRadius: 2,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
          touchAction: 'none',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <svg width="100%" height="100%" viewBox={viewBox} role="img" aria-label="World map">
          {gridLines}
          {layers.has('wildPals') &&
            pal('WildPal').map((p, i) => (
              <circle key={`w${i}`} cx={p.at.x} cy={-p.at.y} r={r(2.5)} fill={theme.vars!.palette.text.disabled}>
                <title>{`${palLabel(p)} · level ${p.level ?? '?'}`}</title>
              </circle>
            ))}
          {layers.has('npcs') &&
            map.npcs.map((n, i) => (
              <circle key={`n${i}`} cx={n.at.x} cy={-n.at.y} r={r(3)} fill={theme.vars!.palette.warning.main}>
                <title>{palLabel({ className: n.className })}</title>
              </circle>
            ))}
          {layers.has('basePals') &&
            pal('BaseCampPal').map((p, i) => (
              <circle key={`b${i}`} cx={p.at.x} cy={-p.at.y} r={r(3)} fill={theme.vars!.palette.secondary.main} opacity={0.8}>
                <title>{`${palLabel(p)} · level ${p.level ?? '?'}${p.guildName ? ` · ${p.guildName}` : ''}`}</title>
              </circle>
            ))}
          {layers.has('bases') &&
            map.bases.map((b) => (
              <g key={b.id} onClick={click(() => onBase?.(b.id))} style={{ cursor: onBase ? 'pointer' : undefined }}>
                <rect
                  x={b.at.x - r(8)}
                  y={-b.at.y - r(8)}
                  width={r(16)}
                  height={r(16)}
                  rx={r(3)}
                  fill={guildColor(b.guildId)}
                  stroke={theme.vars!.palette.background.paper}
                  strokeWidth={r(2)}
                />
                <title>{`${b.guildName ?? 'Base'} · ${b.workers} worker${b.workers === 1 ? '' : 's'}`}</title>
              </g>
            ))}
          {layers.has('partyPals') &&
            pal('OtomoPal').map((p, i) => (
              <circle key={`o${i}`} cx={p.at.x} cy={-p.at.y} r={r(4)} fill={theme.vars!.palette.primary.light} stroke={theme.vars!.palette.background.paper} strokeWidth={r(1)}>
                <title>{`${palLabel(p)} · level ${p.level ?? '?'}${p.owner ? ` · ${p.owner}’s pal` : ''}`}</title>
              </circle>
            ))}
          {layers.has('players') &&
            map.players.map((p) => (
              <g key={p.userId} onClick={click(() => onPlayer?.(p.userId))} style={{ cursor: onPlayer ? 'pointer' : undefined }}>
                <circle cx={p.at.x} cy={-p.at.y} r={r(7)} fill={guildColor(p.guildId)} stroke={theme.vars!.palette.background.paper} strokeWidth={r(2.5)} />
                <text
                  x={p.at.x + r(11)}
                  y={-p.at.y + r(4)}
                  fontSize={r(13)}
                  fontWeight={600}
                  fill={theme.vars!.palette.text.primary}
                  stroke={theme.vars!.palette.background.default}
                  strokeWidth={r(3)}
                  paintOrder="stroke"
                >
                  {p.name}
                </text>
                <title>{`${p.name} · level ${p.level ?? '?'}${p.guildName ? ` · ${p.guildName}` : ''}`}</title>
              </g>
            ))}
        </svg>
        <Stack
          spacing={0.5}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{ position: 'absolute', right: 8, top: 8, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 2 }}
        >
          <Tooltip title="Zoom in" placement="left">
            <IconButton size="small" onClick={() => zoom(1 / 1.5)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom out" placement="left">
            <IconButton size="small" onClick={() => zoom(1.5)}>
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Show everything" placement="left">
            <IconButton size="small" onClick={() => setView(fit(allPoints))}>
              <CenterFocusStrongOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box sx={{ position: 'absolute', left: 8, bottom: 8, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'background.paper', fontSize: 12, color: 'text.secondary' }}>
          Grid: {GRID} map units · center {Math.round(view.cx)}, {Math.round(view.cy)}
        </Box>
      </Box>
    </Stack>
  );
}
