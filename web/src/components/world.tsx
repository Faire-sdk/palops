import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SignalKind, WorldStatus } from '../api/types';
import { formatDateTime } from '../format';

/** "SheepBall" -> "Sheep Ball". Pals only carry their internal species name. */
export const prettyClass = (className: string | null) => (className ? className.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') : null);

export const palLabel = (p: { name?: string | null; className: string | null }) => p.name || prettyClass(p.className) || 'Pal';

const GUILD_COLORS = ['#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#d81b60', '#6d4c41', '#3949ab', '#c0ca33'];
const NO_GUILD = '#78909c';

function hashColor(guildId: string): string {
  let h = 0x811c9dc5;
  for (const c of guildId) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return GUILD_COLORS[h % GUILD_COLORS.length]!;
}

const GuildColors = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * Hands out palette colors in guild-id order, so the first ten guilds never
 * share a color and a guild looks the same on the map and in every list.
 */
export function GuildColorProvider({ guildIds, children }: { guildIds: string[]; children: ReactNode }) {
  const key = [...guildIds].sort().join('|');
  const colors = useMemo(() => new Map(key ? key.split('|').map((id, i) => [id, GUILD_COLORS[i % GUILD_COLORS.length]!] as const) : []), [key]);
  return <GuildColors.Provider value={colors}>{children}</GuildColors.Provider>;
}

/** A stable color per guild, so a guild's players and bases match on the map. */
export function useGuildColor(): (guildId: string | null) => string {
  const colors = useContext(GuildColors);
  return (guildId) => (guildId ? (colors.get(guildId) ?? hashColor(guildId)) : NO_GUILD);
}

export function GuildDot({ guildId }: { guildId: string | null }) {
  const color = useGuildColor();
  return <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: color(guildId), mr: 1, flexShrink: 0 }} />;
}

export const formatMapPoint = (p: { x: number; y: number }) => `${Math.round(p.x)}, ${Math.round(p.y)}`;

const SIGNAL_LABELS: Record<SignalKind, string> = { movement: 'Movement', level: 'Level jump', shared_ip: 'Shared address' };

export function SignalChip({ kind }: { kind: SignalKind }) {
  return <Chip label={SIGNAL_LABELS[kind]} color={kind === 'shared_ip' ? 'info' : 'warning'} variant="outlined" />;
}

export function HpBar({ hp, maxHp }: { hp: number | null; maxHp: number | null }) {
  if (hp === null || !maxHp) return <>—</>;
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 90 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: pct < 35 ? 'error.main' : pct < 70 ? 'warning.main' : 'success.main' }} />
      </Box>
      <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', width: 32, textAlign: 'right' }}>
        {Math.round(pct)}%
      </Box>
    </Box>
  );
}

/**
 * Explains why world data is missing. The game-data endpoint is off unless the
 * server is started with -enable-gamedata-api.
 */
export function WorldStatusAlert({ status }: { status: WorldStatus | undefined }) {
  if (!status || status.state === 'ok') return null;
  if (status.state === 'pending') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Waiting for the first world snapshot. Use Refresh to read one now.
      </Alert>
    );
  }
  if (status.state === 'unconfigured') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Connect a Palworld server in Settings to see world data.
      </Alert>
    );
  }
  if (status.state === 'disabled') {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>World data is switched off on the server</AlertTitle>
        Guilds, bases, the map and cheat signals need the Palworld server started with <code>-enable-gamedata-api</code>. On Linux, add it to the
        PalServer.sh command (or the ExecStart line of your service). On Windows, add it to the PalServer.exe launch arguments. Then restart the server.
      </Alert>
    );
  }
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {status.message ?? 'World data is unavailable right now.'}
      {status.takenAt && ` Showing the snapshot from ${formatDateTime(status.takenAt)}.`}
    </Alert>
  );
}
