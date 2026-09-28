import AddIcon from '@mui/icons-material/Add';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { MapImage, MapPoint, WorldMapData } from '../api/types';
import { palLabel, prettyClass, useGuildColor } from './world';

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
/** Pal and NPC names only show once zoomed in this far (visible width in map units), or they'd bury the map. */
const PAL_LABEL_WIDTH = 600;
const WILD_LABEL_WIDTH = 250;
const MAX_LABELS = 250;
const LABEL_PX = 12;

/** What the hover card shows for a marker. */
interface HoverInfo {
  title: string;
  lines: string[];
  hint?: string;
}

interface LabelCandidate {
  key: string;
  at: MapPoint;
  text: string;
  /** Distance from the marker's center to where the text starts, in pixels. */
  offsetPx: number;
  bold?: boolean;
  color?: string;
}

const levelText = (level: number | null) => `Level ${level ?? '?'}`;
const PAL_KIND: Record<'OtomoPal' | 'BaseCampPal' | 'WildPal', string> = { OtomoPal: 'Party pal', BaseCampPal: 'Base pal', WildPal: 'Wild pal' };

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
  const [showLabels, setShowLabels] = useState(true);
  const [hover, setHover] = useState<(HoverInfo & { x: number; y: number }) | null>(null);
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
      setHover(null);
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

  /** Shows the hover card next to the pointer while it's over a marker. */
  const hoverable = (info: HoverInfo) => ({
    onPointerEnter: (e: PointerEvent) => {
      if (drag.current?.moved) return;
      const rect = box.current!.getBoundingClientRect();
      setHover({ ...info, x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    onPointerLeave: () => setHover(null),
    'aria-label': [info.title, ...info.lines].join(', '),
  });

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

  // Names next to markers, most important first; a name that would overlap one
  // already placed is skipped (hover still shows it). Pal names wait until zoomed in.
  const labels = useMemo(() => {
    if (!showLabels) return [];
    const candidates: LabelCandidate[] = [];
    if (layers.has('players')) for (const p of map.players) candidates.push({ key: `lp${p.userId}`, at: p.at, text: p.name, offsetPx: 11, bold: true });
    if (layers.has('bases')) for (const b of map.bases) candidates.push({ key: `lb${b.id}`, at: b.at, text: b.guildName ?? 'Base', offsetPx: 11, color: guildColor(b.guildId) });
    if (view.width <= PAL_LABEL_WIDTH) {
      for (const [layer, kind] of [
        ['partyPals', 'OtomoPal'],
        ['basePals', 'BaseCampPal'],
      ] as const) {
        if (layers.has(layer)) map.pals.forEach((p, i) => p.kind === kind && candidates.push({ key: `l${kind}${i}`, at: p.at, text: palLabel(p), offsetPx: 6 }));
      }
    }
    if (view.width <= WILD_LABEL_WIDTH) {
      if (layers.has('npcs')) map.npcs.forEach((n, i) => candidates.push({ key: `ln${i}`, at: n.at, text: prettyClass(n.className) ?? 'NPC', offsetPx: 6 }));
      if (layers.has('wildPals')) map.pals.forEach((p, i) => p.kind === 'WildPal' && candidates.push({ key: `lw${i}`, at: p.at, text: palLabel(p), offsetPx: 5 }));
    }

    const px = view.width / size.w;
    const halfW = view.width / 2;
    const halfH = (size.h * px) / 2;
    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const out: LabelCandidate[] = [];
    for (const c of candidates) {
      if (Math.abs(c.at.x - view.cx) > halfW || Math.abs(c.at.y - view.cy) > halfH) continue;
      // Screen-space box for the text, in pixels from the view's top-left.
      const x1 = (c.at.x - (view.cx - halfW)) / px + c.offsetPx;
      const y1 = ((view.cy + halfH) - c.at.y) / px - LABEL_PX / 2 - 2;
      const box = { x1, y1, x2: x1 + c.text.length * LABEL_PX * 0.58, y2: y1 + LABEL_PX + 4 };
      if (placed.some((o) => box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1)) continue;
      placed.push(box);
      out.push(c);
      if (out.length >= MAX_LABELS) break;
    }
    return out;
    // guildColor is a fresh function each render but only depends on the guild ids in map.
  }, [showLabels, layers, map, view, size]);

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
        <Chip
          icon={<LabelOutlinedIcon />}
          label="Names"
          color={showLabels ? 'primary' : 'default'}
          variant={showLabels ? 'filled' : 'outlined'}
          onClick={() => setShowLabels((v) => !v)}
        />
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
          {/* Bases go under the pals, which crowd around the Pal Box. */}
          {layers.has('wildPals') &&
            pal('WildPal').map((p, i) => (
              <circle
                key={`w${i}`}
                cx={p.at.x}
                cy={-p.at.y}
                r={r(2.5)}
                fill={theme.vars!.palette.text.disabled}
                {...hoverable({ title: palLabel(p), lines: [PAL_KIND.WildPal, levelText(p.level)] })}
              />
            ))}
          {layers.has('npcs') &&
            map.npcs.map((n, i) => (
              <circle
                key={`n${i}`}
                cx={n.at.x}
                cy={-n.at.y}
                r={r(3)}
                fill={theme.vars!.palette.warning.main}
                {...hoverable({ title: prettyClass(n.className) ?? 'NPC', lines: ['NPC'] })}
              />
            ))}
          {layers.has('bases') &&
            map.bases.map((b) => (
              <g
                key={b.id}
                onClick={click(() => onBase?.(b.id))}
                style={{ cursor: onBase ? 'pointer' : undefined }}
                {...hoverable({
                  title: b.guildName ?? 'Base',
                  lines: ['Base', `${b.workers} worker${b.workers === 1 ? '' : 's'}`],
                  hint: onBase ? 'Click for the base’s workers' : undefined,
                })}
              >
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
              </g>
            ))}
          {layers.has('basePals') &&
            pal('BaseCampPal').map((p, i) => (
              <circle
                key={`b${i}`}
                cx={p.at.x}
                cy={-p.at.y}
                r={r(3)}
                fill={theme.vars!.palette.secondary.main}
                opacity={0.8}
                {...hoverable({ title: palLabel(p), lines: [PAL_KIND.BaseCampPal, levelText(p.level), ...(p.guildName ? [p.guildName] : [])] })}
              />
            ))}
          {layers.has('partyPals') &&
            pal('OtomoPal').map((p, i) => (
              <circle
                key={`o${i}`}
                cx={p.at.x}
                cy={-p.at.y}
                r={r(4)}
                fill={theme.vars!.palette.primary.light}
                stroke={theme.vars!.palette.background.paper}
                strokeWidth={r(1)}
                {...hoverable({ title: palLabel(p), lines: [PAL_KIND.OtomoPal, levelText(p.level), ...(p.owner ? [`${p.owner}’s pal`] : [])] })}
              />
            ))}
          {layers.has('players') &&
            map.players.map((p) => (
              <g
                key={p.userId}
                onClick={click(() => onPlayer?.(p.userId))}
                style={{ cursor: onPlayer ? 'pointer' : undefined }}
                {...hoverable({
                  title: p.name,
                  lines: ['Player', levelText(p.level), p.guildName ?? 'No guild'],
                  hint: onPlayer ? 'Click to open their profile' : undefined,
                })}
              >
                <circle cx={p.at.x} cy={-p.at.y} r={r(7)} fill={guildColor(p.guildId)} stroke={theme.vars!.palette.background.paper} strokeWidth={r(2.5)} />
              </g>
            ))}
          {showLabels && (
            <g pointerEvents="none" fontFamily={theme.typography.fontFamily}>
              {labels.map((l) => (
                <text
                  key={l.key}
                  x={l.at.x + r(l.offsetPx)}
                  y={-l.at.y + r(LABEL_PX / 3)}
                  fontSize={r(l.bold ? 13 : LABEL_PX)}
                  fontWeight={l.bold ? 600 : 500}
                  fill={l.color ?? theme.vars!.palette.text.primary}
                  stroke={theme.vars!.palette.background.default}
                  strokeWidth={r(3)}
                  paintOrder="stroke"
                >
                  {l.text}
                </text>
              ))}
            </g>
          )}
        </svg>
        {hover && (
          <Paper
            elevation={4}
            sx={{
              position: 'absolute',
              pointerEvents: 'none',
              px: 1.5,
              py: 1,
              maxWidth: 240,
              // Keep the card inside the map: flip to the other side near the right or bottom edge.
              left: hover.x + 260 > size.w ? undefined : hover.x + 14,
              right: hover.x + 260 > size.w ? size.w - hover.x + 14 : undefined,
              top: hover.y + 120 > size.h ? undefined : hover.y + 14,
              bottom: hover.y + 120 > size.h ? size.h - hover.y + 14 : undefined,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {hover.title}
            </Typography>
            {hover.lines.map((line, i) => (
              <Typography key={i} variant="body2" color="text.secondary">
                {line}
              </Typography>
            ))}
            {hover.hint && (
              <>
                <Divider sx={{ my: 0.5 }} />
                <Typography variant="caption" color="text.secondary">
                  {hover.hint}
                </Typography>
              </>
            )}
          </Paper>
        )}
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
