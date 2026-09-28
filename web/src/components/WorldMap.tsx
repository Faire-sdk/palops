import AddIcon from '@mui/icons-material/Add';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { MapImage, MapPoint, WorldMapData } from '../api/types';
import { GuildDot, palLabel, useGuildColor } from './world';

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

/** Pals and NPCs are only named once zoomed in this far (visible width in map units), or the map turns into a wall of text. */
const NAME_WIDTH = { partyPals: 260, npcs: 260, basePals: 110, wildPals: 90 } as const;

interface Place {
  label: string;
  group: 'Players' | 'Bases' | 'Guilds';
  at: MapPoint;
  /** Points to fit when the place spans several (a guild's bases and members). */
  around?: MapPoint[];
}

const WORLD = 1000;
const GRID = 200;
const MIN_WIDTH = 40;
const MAX_WIDTH = 3000;

export const mapImageUrl = (image: MapImage) => `/api/v1/world/map-image/file?v=${encodeURIComponent(image.updatedAt)}`;

/** Fits a view around the given points, never smaller than the main island. */
function fit(points: MapPoint[]): View {
  const xs = [-WORLD, WORLD, ...points.map((p) => p.x)];
  const ys = [-WORLD, WORLD, ...points.map((p) => p.y)];
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: Math.max(maxX - minX, maxY - minY) * 1.05 };
}

/**
 * A live map drawn in in-game map coordinates (north up), over the map image
 * an owner uploaded (PalOps doesn't ship the game's map art). Scroll to zoom,
 * drag to pan; markers keep their size at any zoom.
 */
export function WorldMap({
  map,
  focus,
  onPlayer,
  onBase,
  background,
}: {
  map: WorldMapData;
  background?: MapImage | null;
  focus?: MapPoint | null;
  onPlayer?: (userId: string) => void;
  onBase?: (baseId: number) => void;
}) {
  const theme = useTheme();
  const guildColor = useGuildColor();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [layers, setLayers] = useState<Set<Layer>>(new Set(['players', 'bases', 'partyPals', 'basePals']));
  const [names, setNames] = useState(true);
  const allPoints = useMemo(() => {
    const points = [...map.players, ...map.bases].map((p) => p.at);
    if (background) points.push({ x: background.bounds.left, y: background.bounds.top }, { x: background.bounds.right, y: background.bounds.bottom });
    return points;
  }, [map, background]);
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

  const guilds = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; points: MapPoint[] }>();
    for (const item of [...map.bases, ...map.players]) {
      if (!item.guildId) continue;
      const g = byId.get(item.guildId) ?? { id: item.guildId, name: item.guildName ?? 'Unknown guild', points: [] };
      g.points.push(item.at);
      byId.set(item.guildId, g);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [map]);
  /** Everything findable by name: players, bases and guilds. */
  const places = useMemo<Place[]>(
    () => [
      ...map.players.map((p): Place => ({ label: p.name, group: 'Players', at: p.at })),
      ...map.bases.map((b): Place => ({ label: `${b.guildName ?? 'Unknown guild'} base`, group: 'Bases', at: b.at })),
      ...guilds.map((g): Place => ({ label: g.name, group: 'Guilds', at: g.points[0]!, around: g.points })),
    ],
    [map, guilds],
  );

  const goTo = (place: Place) => {
    const points = place.around ?? [place.at];
    const xs = points.map((q) => q.x);
    const ys = points.map((q) => q.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Frame everything the place covers, but never closer than a base-sized view.
    setView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: Math.max(160, Math.max(maxX - minX, maxY - minY) * 1.5) });
  };

  const unitsPerPx = view.width / size.w;
  const height = size.h * unitsPerPx;
  // SVG y grows downward; map y grows north, so flip it.
  const viewBox = `${view.cx - view.width / 2} ${-view.cy - height / 2} ${view.width} ${height}`;
  const r = (px: number) => px * unitsPerPx;
  const label = (x: number, y: number, text: string, opts: { size?: number; weight?: number; muted?: boolean; dx?: number; dy?: number } = {}) => (
    <text
      x={x + r(opts.dx ?? 11)}
      y={-y + r(opts.dy ?? 4)}
      fontSize={r(opts.size ?? 13)}
      fontWeight={opts.weight ?? 600}
      fill={opts.muted ? theme.vars!.palette.text.secondary : theme.vars!.palette.text.primary}
      stroke={theme.vars!.palette.background.default}
      strokeWidth={r(3)}
      paintOrder="stroke"
      style={{ pointerEvents: 'none' }}
    >
      {text}
    </text>
  );
  const showNames = (layer: keyof typeof NAME_WIDTH) => names && view.width <= NAME_WIDTH[layer];

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
        <Chip label="Names" color={names ? 'primary' : 'default'} variant={names ? 'filled' : 'outlined'} onClick={() => setNames((n) => !n)} title="Show names next to markers. Pals and NPCs are named once you zoom in." />
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
        <Autocomplete
          size="small"
          options={places}
          groupBy={(o) => o.group}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.group === b.group && a.label === b.label && a.at.x === b.at.x && a.at.y === b.at.y}
          onChange={(_, value) => value && goTo(value)}
          renderInput={(params) => <TextField {...params} placeholder="Find a player, base or guild" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Find on the map' } }} />}
          sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}
        />
        {guilds.length > 0 && (
          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {guilds.map((g) => (
              <Chip
                key={g.id}
                size="small"
                variant="outlined"
                icon={<GuildDot guildId={g.id} />}
                label={g.name}
                onClick={() => goTo({ label: g.name, group: 'Guilds', at: g.points[0]!, around: g.points })}
                sx={{ '& .MuiChip-icon': { ml: 1, mr: -0.5 } }}
              />
            ))}
          </Stack>
        )}
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
          {background && (
            <image
              href={mapImageUrl(background)}
              x={background.bounds.left}
              y={-background.bounds.top}
              width={background.bounds.right - background.bounds.left}
              height={background.bounds.top - background.bounds.bottom}
              preserveAspectRatio="none"
            />
          )}
          <g opacity={background ? 0.35 : 1}>{gridLines}</g>
          {layers.has('wildPals') &&
            pal('WildPal').map((p, i) => (
              <g key={`w${i}`}>
                <circle cx={p.at.x} cy={-p.at.y} r={r(2.5)} fill={theme.vars!.palette.text.disabled}>
                  <title>{`${palLabel(p)} · level ${p.level ?? '?'}`}</title>
                </circle>
                {showNames('wildPals') && label(p.at.x - r(4), p.at.y, `${palLabel(p)} Lv ${p.level ?? '?'}`, { size: 11, weight: 400, muted: true })}
              </g>
            ))}
          {layers.has('npcs') &&
            map.npcs.map((n, i) => (
              <g key={`n${i}`}>
                <circle cx={n.at.x} cy={-n.at.y} r={r(3)} fill={theme.vars!.palette.warning.main}>
                  <title>{palLabel({ className: n.className })}</title>
                </circle>
                {showNames('npcs') && label(n.at.x - r(3), n.at.y, palLabel({ className: n.className }), { size: 11, weight: 400, muted: true })}
              </g>
            ))}
          {layers.has('basePals') &&
            pal('BaseCampPal').map((p, i) => (
              <g key={`b${i}`}>
                <circle cx={p.at.x} cy={-p.at.y} r={r(3)} fill={theme.vars!.palette.secondary.main} opacity={0.8}>
                  <title>{`${palLabel(p)} · level ${p.level ?? '?'}${p.guildName ? ` · ${p.guildName}` : ''}`}</title>
                </circle>
                {showNames('basePals') && label(p.at.x - r(3), p.at.y, `${palLabel(p)} Lv ${p.level ?? '?'}`, { size: 11, weight: 400 })}
              </g>
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
                {names && label(b.at.x, b.at.y, `${b.guildName ?? 'Base'}${view.width <= 400 ? ` · ${b.workers} worker${b.workers === 1 ? '' : 's'}` : ''}`, { size: 12, dx: -8, dy: 24 })}
                <title>{`${b.guildName ?? 'Base'} · ${b.workers} worker${b.workers === 1 ? '' : 's'}`}</title>
              </g>
            ))}
          {layers.has('partyPals') &&
            pal('OtomoPal').map((p, i) => (
              <g key={`o${i}`}>
                <circle cx={p.at.x} cy={-p.at.y} r={r(4)} fill={theme.vars!.palette.primary.light} stroke={theme.vars!.palette.background.paper} strokeWidth={r(1)}>
                  <title>{`${palLabel(p)} · level ${p.level ?? '?'}${p.owner ? ` · ${p.owner}’s pal` : ''}`}</title>
                </circle>
                {showNames('partyPals') && label(p.at.x - r(2), p.at.y, `${palLabel(p)}${p.owner ? ` (${p.owner}’s)` : ''}`, { size: 11, weight: 400 })}
              </g>
            ))}
          {layers.has('players') &&
            map.players.map((p) => (
              <g key={p.userId} onClick={click(() => onPlayer?.(p.userId))} style={{ cursor: onPlayer ? 'pointer' : undefined }}>
                <circle cx={p.at.x} cy={-p.at.y} r={r(7)} fill={guildColor(p.guildId)} stroke={theme.vars!.palette.background.paper} strokeWidth={r(2.5)} />
                {names && label(p.at.x, p.at.y, p.name)}
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
