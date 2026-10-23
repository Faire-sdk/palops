import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { Base, GuildDetail, Guild, MapImage, MapPoint, MapRegion, WorkerPal, WorldMapData, WorldPerformance, WorldStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading, PageHeader, Section, Stat } from '../components/common';
import { DataTable } from '../components/DataTable';
import { MapImageDialog } from '../components/MapImageDialog';
import { PlayerProfileDialog } from '../components/PlayerActions';
import { useToast } from '../components/Toast';
import { WorldMap } from '../components/WorldMap';
import { formatMapPoint, GuildColorProvider, GuildDot, HpBar, palLabel, WorldStatusAlert } from '../components/world';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

const TABS = [
  { id: 'map', label: 'Map', staff: true },
  { id: 'guilds', label: 'Guilds', staff: false },
  { id: 'bases', label: 'Bases', staff: true },
  { id: 'performance', label: 'Lag hotspots', staff: true },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Guilds, bases, the live map and lag hotspots, from the server's world snapshot. */
export function WorldPage() {
  const { can } = useAuth();
  const notify = useToast();
  const staff = can('world.view');
  const tabs = TABS.filter((t) => staff || !t.staff);
  const [params, setParams] = useSearchParams();
  const tab: TabId = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]!.id;
  const [profile, setProfile] = useState<string | null>(null);
  const [guild, setGuild] = useState<string | null>(null);
  const [base, setBase] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { data: status } = useApi<WorldStatus>('/world/status', { pollMs: 20000 });
  const { data: guildList } = useApi<{ guilds: Guild[] }>('/world/guilds', { pollMs: 60000 });
  const guildIds = useMemo(() => guildList?.guilds.map((g) => g.guildId) ?? [], [guildList]);

  const focus = useMemo<MapPoint | null>(() => {
    const [x, y] = (params.get('focus') ?? '').split(',').map(Number);
    return Number.isFinite(x) && Number.isFinite(y) && params.has('focus') ? { x: x!, y: y! } : null;
  }, [params]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/world/refresh');
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <GuildColorProvider guildIds={guildIds}>
      <PageHeader
        title="World"
        description={status?.takenAt ? `Snapshot from ${formatDateTime(status.takenAt)}` : 'Guilds, bases and the live map from the server’s world data.'}
        actions={
          staff && (
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} loading={refreshing} loadingPosition="start">
              Refresh
            </Button>
          )
        }
      />
      <WorldStatusAlert status={status} />
      <Tabs value={tab} onChange={(_, v: TabId) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      {tab === 'map' && <MapTab focus={focus} onPlayer={setProfile} onBase={setBase} />}
      {tab === 'guilds' && <GuildsTab onOpen={setGuild} />}
      {tab === 'bases' && <BasesTab onOpen={setBase} />}
      {tab === 'performance' && <PerformanceTab onShow={(p) => setParams({ tab: 'map', focus: `${p.x},${p.y}` })} />}
      <GuildDialog guildId={guild} onClose={() => setGuild(null)} onPlayer={setProfile} onBase={setBase} />
      <BaseDialog baseId={base} onClose={() => setBase(null)} />
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} onOpen={setProfile} />
    </GuildColorProvider>
  );
}

const NO_IMAGES: MapImage[] = [];

function MapTab({ focus, onPlayer, onBase }: { focus: MapPoint | null; onPlayer: (id: string) => void; onBase: (id: number) => void }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<{ status: WorldStatus; map: WorldMapData | null }>('/world/map', { pollMs: 20000 });
  const { data: imageData } = useApi<{ regions: MapRegion[]; images: MapImage[] }>('/world/map-images');
  const [editing, setEditing] = useState(false);
  const images = imageData?.images ?? NO_IMAGES;
  const unaligned = images.filter((i) => !i.aligned).map((i) => imageData?.regions.find((r) => r.id === i.region)?.label ?? i.region);
  const editor = can('config.edit') && (
    <>
      <Button variant="outlined" startIcon={<ImageOutlinedIcon />} onClick={() => setEditing(true)}>
        {images.length > 0 ? 'Map images' : 'Add map images'}
      </Button>
      <MapImageDialog open={editing} onClose={() => setEditing(false)} regions={imageData?.regions ?? []} images={images} map={data?.map ?? null} />
    </>
  );
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data?.map) {
    return (
      <Section action={editor}>
        <EmptyState icon={MapOutlinedIcon} title="No world snapshot yet" />
      </Section>
    );
  }
  const map = data.map;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 9 }}>
        <Section disablePadding>
          <Box sx={{ p: 2 }}>
            {(editor || unaligned.length > 0) && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {images.length === 0
                    ? 'Upload pictures of the Palpagos Islands and World Tree maps to draw them under the markers.'
                    : unaligned.length > 0
                      ? unaligned.length === 1
                        ? `The ${unaligned[0]} map isn’t lined up yet, so markers may not match it.`
                        : `The ${unaligned.join(' and ')} maps aren’t lined up yet, so markers may not match them.`
                      : ''}
                </Typography>
                {editor}
              </Stack>
            )}
            <WorldMap map={map} focus={focus} onPlayer={onPlayer} onBase={onBase} backgrounds={images} />
            {map.truncated && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Only the first 3,000 wild pals are drawn.
              </Typography>
            )}
          </Box>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, lg: 3 }}>
        <Section title={`Players (${map.players.length})`} disablePadding>
          {map.players.length === 0 ? (
            <EmptyState title="Nobody is online" />
          ) : (
            <List dense>
              {map.players.map((p) => (
                <ListItemButton key={p.userId} onClick={() => onPlayer(p.userId)}>
                  <GuildDot guildId={p.guildId} />
                  <ListItemText primary={p.name} secondary={`Level ${p.level ?? '?'}${p.guildName ? ` · ${p.guildName}` : ''} · ${formatMapPoint(p.at)}`} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Section>
      </Grid>
    </Grid>
  );
}

function GuildsTab({ onOpen }: { onOpen: (guildId: string) => void }) {
  const { data, error, loading, reload } = useApi<{ guilds: Guild[] }>('/world/guilds');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Section title={`Guilds (${data?.guilds.length ?? 0})`} disablePadding>
      <DataTable
        rows={data?.guilds ?? []}
        rowKey={(g) => g.guildId}
        empty={<EmptyState title="No guilds yet">Guilds appear once the panel has read a world snapshot.</EmptyState>}
        columns={[
          {
            key: 'name',
            header: 'Guild',
            render: (g) => (
              <Stack direction="row" sx={{ alignItems: 'center' }}>
                <GuildDot guildId={g.guildId} />
                <Link component="button" underline="hover" onClick={() => onOpen(g.guildId)} sx={{ fontWeight: 600 }}>
                  {g.name}
                </Link>
              </Stack>
            ),
          },
          { key: 'members', header: 'Members', render: (g) => g.members },
          { key: 'online', header: 'Online', render: (g) => (g.online ? <Chip label={g.online} color="success" /> : 0) },
          { key: 'bases', header: 'Bases', render: (g) => g.bases },
          { key: 'seen', header: 'Last seen', nowrap: true, render: (g) => formatDateTime(g.lastSeenAt) },
        ]}
      />
    </Section>
  );
}

function BasesTab({ onOpen }: { onOpen: (baseId: number) => void }) {
  const { data, error, loading, reload } = useApi<{ bases: Base[] }>('/world/bases', { pollMs: 30000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const bases = data?.bases ?? [];
  const workers = bases.flatMap((b) => b.workers ?? []);
  const injured = workers.filter(isInjured).length;
  return (
    <Stack spacing={2}>
      <Section>
        <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Stat label="Bases" value={bases.length} />
          <Stat label="Worker pals" value={workers.length} />
          <Stat label="Injured workers" value={injured} hint="Below 35% HP" />
        </Stack>
      </Section>
      <Section title="Bases" disablePadding>
        <DataTable
          rows={bases}
          rowKey={(b) => b.id}
          empty={<EmptyState title="No bases yet">Pal Boxes appear once the panel has read a world snapshot.</EmptyState>}
          columns={[
            {
              key: 'guild',
              header: 'Guild',
              render: (b) => (
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <GuildDot guildId={b.guildId} />
                  <Link component="button" underline="hover" onClick={() => onOpen(b.id)} sx={{ fontWeight: 600 }}>
                    {b.guildName ?? b.guildId}
                  </Link>
                </Stack>
              ),
            },
            { key: 'at', header: 'Location', nowrap: true, render: (b) => formatMapPoint(b.location) },
            { key: 'workers', header: 'Workers', render: (b) => (b.workers ? b.workers.length : '—') },
            { key: 'level', header: 'Avg level', render: (b) => avgLevel(b.workers) },
            { key: 'injured', header: 'Injured', render: (b) => injuredChip(b.workers) },
            { key: 'seen', header: 'Last seen', nowrap: true, render: (b) => formatDateTime(b.lastSeenAt) },
          ]}
        />
      </Section>
    </Stack>
  );
}

const isInjured = (w: WorkerPal) => w.hp !== null && !!w.maxHp && w.hp / w.maxHp < 0.35;

function avgLevel(workers: WorkerPal[] | null) {
  const levels = (workers ?? []).map((w) => w.level).filter((l): l is number => l !== null);
  return levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : '—';
}

function injuredChip(workers: WorkerPal[] | null) {
  if (!workers) return '—';
  const n = workers.filter(isInjured).length;
  return n ? <Chip label={n} color="error" variant="outlined" /> : 0;
}

function WorkerTable({ workers }: { workers: WorkerPal[] | null }) {
  if (!workers) return <Typography color="text.secondary">Worker details need a fresh world snapshot.</Typography>;
  return (
    <DataTable
      rows={workers}
      rowKey={(w) => w.instanceId}
      empty={<EmptyState title="No worker pals seen here" />}
      columns={[
        { key: 'name', header: 'Pal', render: (w) => palLabel(w) },
        { key: 'level', header: 'Level', render: (w) => w.level ?? '—' },
        { key: 'hp', header: 'HP', render: (w) => <HpBar hp={w.hp} maxHp={w.maxHp} /> },
      ]}
    />
  );
}

function BaseDialog({ baseId, onClose }: { baseId: number | null; onClose: () => void }) {
  const { data } = useApi<{ bases: Base[] }>('/world/bases', { enabled: baseId !== null });
  const base = data?.bases.find((b) => b.id === baseId);
  return (
    <Dialog open={baseId !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{base ? `${base.guildName ?? 'Base'} base` : 'Base'}</DialogTitle>
      <DialogContent dividers>
        {!base ? (
          <Loading />
        ) : (
          <Stack spacing={2}>
            <Typography color="text.secondary">
              At {formatMapPoint(base.location)} · first seen {formatDateTime(base.firstSeenAt)}
            </Typography>
            <WorkerTable workers={base.workers} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function GuildDialog({ guildId, onClose, onPlayer, onBase }: { guildId: string | null; onClose: () => void; onPlayer: (id: string) => void; onBase: (id: number) => void }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<GuildDetail>(`/world/guilds/${encodeURIComponent(guildId ?? '')}`, { enabled: !!guildId });
  const current = data?.guild.guildId === guildId ? data : undefined;
  let body;
  if (loading || (data && !current)) body = <Loading />;
  else if (error && !current) body = <ErrorState error={error} onRetry={reload} />;
  else if (current) {
    body = (
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Stat label="Members" value={current.guild.members} />
          <Stat label="Online" value={current.guild.online} />
          <Stat label="Bases" value={current.guild.bases} />
        </Stack>
        <Box>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
            Members
          </Typography>
          <DataTable
            rows={current.members}
            rowKey={(m) => m.userId}
            empty={<EmptyState title="No known members" />}
            columns={[
              {
                key: 'name',
                header: 'Player',
                render: (m) => (
                  <Link component="button" underline="hover" onClick={() => onPlayer(m.userId)} sx={{ fontWeight: 600 }}>
                    {m.name}
                  </Link>
                ),
              },
              { key: 'level', header: 'Level', render: (m) => m.level ?? '—' },
              { key: 'online', header: 'Status', render: (m) => (m.online ? <Chip label="Online" color="success" /> : formatDateTime(m.lastSeenAt)) },
            ]}
          />
        </Box>
        {can('world.view') && (
          <Box>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              Bases
            </Typography>
            <DataTable
              rows={current.bases}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No bases seen" />}
              columns={[
                {
                  key: 'at',
                  header: 'Location',
                  render: (b) => (
                    <Link component="button" underline="hover" onClick={() => onBase(b.id)}>
                      {formatMapPoint(b.location)}
                    </Link>
                  ),
                },
                { key: 'workers', header: 'Workers', render: (b) => (b.workers ? b.workers.length : '—') },
                { key: 'injured', header: 'Injured', render: (b) => injuredChip(b.workers) },
              ]}
            />
          </Box>
        )}
      </Stack>
    );
  }
  return (
    <Dialog open={!!guildId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{current?.guild.name ?? 'Guild'}</DialogTitle>
      <DialogContent dividers>{body}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function PerformanceTab({ onShow }: { onShow: (p: MapPoint) => void }) {
  const { data, error, loading, reload } = useApi<WorldPerformance>('/world/performance?hours=24', { pollMs: 60000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const perf = data!;
  return (
    <Stack spacing={2}>
      <Section title="Lag hotspots" disablePadding>
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
          The busiest 500 m areas over the last 24 hours, with the server’s FPS while they were busy. A crowded area where FPS drops below average is a likely cause of
          lag, often a base with many pals. The FPS chart is on the{' '}
          <Link component={RouterLink} to="/">
            Dashboard
          </Link>
          .
        </Typography>
        <DataTable
          rows={perf.hotspots}
          rowKey={(h) => h.cell}
          empty={<EmptyState title="No data yet" />}
          columns={[
            { key: 'at', header: 'Area', nowrap: true, render: (h) => formatMapPoint(h.center) },
            { key: 'actors', header: 'Avg characters', render: (h) => h.avgActors },
            { key: 'players', header: 'Avg players', render: (h) => h.avgPlayers },
            {
              key: 'fps',
              header: 'Avg FPS when busy',
              render: (h) => (h.avgFps === null ? '—' : <Chip label={h.avgFps} color={h.avgFps < 30 ? 'error' : h.avgFps < 45 ? 'warning' : 'success'} variant="outlined" />),
            },
            {
              key: 'delta',
              header: 'vs average',
              render: (h) =>
                h.fpsVsAverage === null ? '—' : (
                  <Typography variant="body2" color={h.fpsVsAverage <= -3 ? 'error' : 'text.secondary'} sx={{ fontWeight: h.fpsVsAverage <= -3 ? 600 : 400 }}>
                    {h.fpsVsAverage > 0 ? '+' : ''}
                    {h.fpsVsAverage}
                  </Typography>
                ),
            },
            { key: 'samples', header: 'Snapshots', render: (h) => h.samples },
            {
              key: 'show',
              header: '',
              align: 'right',
              render: (h) => (
                <Button size="small" onClick={() => onShow(h.center)}>
                  Show on map
                </Button>
              ),
            },
          ]}
        />
      </Section>
    </Stack>
  );
}
