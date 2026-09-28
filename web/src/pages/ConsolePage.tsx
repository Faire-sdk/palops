import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SearchIcon from '@mui/icons-material/Search';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../api/client';
import type { ConsoleLevel, ConsoleLine, ConsoleSource, LoggerStatus, TailStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Section } from '../components/common';
import { usePalDefender } from '../hooks/usePalDefender';

const SOURCES: Array<{ id: ConsoleSource; label: string }> = [
  { id: 'game', label: 'Game log' },
  { id: 'paldefender', label: 'PalDefender' },
  { id: 'panel', label: 'Panel events' },
];
const SOURCE_LABEL: Record<ConsoleSource, string> = { game: 'game', paldefender: 'PalDefender', panel: 'panel' };
/** How many lines the page keeps; older ones are still stored on the server. */
const MAX_LINES = 2000;
const INITIAL = 500;

type Live = 'connecting' | 'live' | 'reconnecting';

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour12: false });

/**
 * A view-only console: the game's and PalDefender's log files (when an owner
 * has pointed PalOps at them) plus what the panel itself sees. There is no
 * command box; RCON is deprecated by Palworld and the panel's own actions cover
 * what people usually type.
 */
export function ConsolePage() {
  const pd = usePalDefender();
  const sourceLabel = (source: ConsoleSource) => (source === 'paldefender' && !pd ? 'log' : SOURCE_LABEL[source]);
  const { can } = useAuth();
  const [sources, setSources] = useState<Set<ConsoleSource>>(new Set(['game', 'paldefender', 'panel']));
  const [level, setLevel] = useState<'all' | ConsoleLevel>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [tail, setTail] = useState<TailStatus[] | null>(null);
  const [logger, setLogger] = useState<LoggerStatus | null>(null);
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [live, setLive] = useState<Live>('connecting');
  const [buffered, setBuffered] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const pending = useRef<ConsoleLine[]>([]);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const sourceParam = useMemo(() => [...sources].sort().join(','), [sources]);
  const levelParam = level === 'all' ? '' : level;

  const matches = useCallback(
    (l: ConsoleLine) => sources.has(l.source) && (level === 'all' || level === 'info' || (level === 'warn' ? l.level !== 'info' : l.level === 'error')) && (!query || l.message.toLowerCase().includes(query.toLowerCase())),
    [sources, level, query],
  );

  // Load the recent history, then follow live from where it ends.
  useEffect(() => {
    let closed = false;
    let es: EventSource | undefined;
    pending.current = [];
    setBuffered(0);
    setLive('connecting');
    const params = new URLSearchParams({ limit: String(INITIAL) });
    if (sourceParam) params.set('sources', sourceParam);
    if (levelParam) params.set('level', levelParam);
    if (query) params.set('q', query);
    api
      .get<{ lines: ConsoleLine[]; sources: TailStatus[]; logger: LoggerStatus | null }>(`/console/lines?${params}`)
      .then((res) => {
        if (closed) return;
        setLines(res.lines);
        setTail(res.sources);
        setLogger(res.logger);
        const last = res.lines.at(-1)?.id ?? 0;
        const stream = new URLSearchParams({ after: String(last) });
        if (sourceParam) stream.set('sources', sourceParam);
        if (levelParam) stream.set('level', levelParam);
        es = new EventSource(`/api/v1/console/stream?${stream}`);
        es.onopen = () => setLive('live');
        es.onerror = () => setLive('reconnecting');
        es.addEventListener('line', (e) => {
          const line = JSON.parse((e as MessageEvent<string>).data) as ConsoleLine;
          if (query && !line.message.toLowerCase().includes(query.toLowerCase())) return;
          if (pausedRef.current) {
            pending.current.push(line);
            setBuffered(pending.current.length);
          } else {
            setLines((prev) => [...prev, line].slice(-MAX_LINES));
          }
        });
      })
      .catch(() => !closed && setLive('reconnecting'));
    return () => {
      closed = true;
      es?.close();
    };
  }, [sourceParam, levelParam, query]);

  const resume = () => {
    setPaused(false);
    if (pending.current.length) setLines((prev) => [...prev, ...pending.current].slice(-MAX_LINES));
    pending.current = [];
    setBuffered(0);
    setFollow(true);
  };

  // Stick to the newest line unless the reader has scrolled up.
  useEffect(() => {
    const el = box.current;
    if (el && follow && !paused) el.scrollTop = el.scrollHeight;
  }, [lines, follow, paused]);

  const onScroll = () => {
    const el = box.current;
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const download = () => {
    const text = lines.filter(matches).map((l) => `${l.at} [${sourceLabel(l.source)}] ${l.message}`).join('\n');
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `palops-console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (id: ConsoleSource) =>
    setSources((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size ? next : current;
    });

  const missing = tail?.filter((t) => t.state === 'missing') ?? [];
  const noFiles = tail !== null && tail.length === 0 && !logger;
  const visible = lines.filter(matches);

  return (
    <>
      <PageHeader title="Console" description={`A view-only feed of the server’s logs and what the panel sees. To act on the server, use Players, Server${pd ? ' and PalDefender' : ''}.`} />
      {noFiles && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Only panel events (joins, bans, signals, admin actions) are shown so far.{' '}
          {can('server.connection') ? (
            <>
              To see the game’s{pd ? ' and PalDefender’s' : ''} log file too, set its location in{' '}
              <Link component={RouterLink} to="/settings?tab=console">
                Settings → Console logs
              </Link>
              .
            </>
          ) : (
            `An owner can point PalOps at the game${pd ? ' and PalDefender' : ''} log file in Settings.`
          )}
        </Alert>
      )}
      {logger && logger.state !== 'connected' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          PalServerLogger isn’t connected: {logger.message ?? 'connecting…'}
        </Alert>
      )}
      {missing.map((t) => (
        <Alert key={t.source} severity="warning" sx={{ mb: 2 }}>
          The {sourceLabel(t.source)} log location can’t be read right now. Check that the server is running on this machine and the path still exists.
        </Alert>
      ))}
      <Section disablePadding>
        <Stack spacing={1.5} sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            {SOURCES.filter((s) => s.id !== 'paldefender' || pd).map((s) => (
              <Chip key={s.id} label={s.label} color={sources.has(s.id) ? 'primary' : 'default'} variant={sources.has(s.id) ? 'filled' : 'outlined'} onClick={() => toggle(s.id)} />
            ))}
            <Chip
              size="small"
              variant="outlined"
              color={live === 'live' ? 'success' : 'warning'}
              label={live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
              sx={{ ml: { sm: 'auto' } }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'Search the console', maxLength: 100 }, input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              fullWidth={false}
              sx={{ flex: '1 1 auto', minWidth: 0 }}
            />
            <TextField select label="Show" value={level} onChange={(e) => setLevel(e.target.value as 'all' | ConsoleLevel)} fullWidth={false} sx={{ flex: 'none', width: { sm: 210 } }}>
              <MenuItem value="all">Everything</MenuItem>
              <MenuItem value="warn">Warnings and errors</MenuItem>
              <MenuItem value="error">Errors only</MenuItem>
            </TextField>
            <Button variant="outlined" startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />} onClick={() => (paused ? resume() : setPaused(true))}>
              {paused ? `Resume${buffered ? ` (${buffered} new)` : ''}` : 'Pause'}
            </Button>
            <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={download} disabled={visible.length === 0}>
              Download
            </Button>
          </Stack>
        </Stack>
        <Box sx={{ position: 'relative' }}>
          <Box
            ref={box}
            onScroll={onScroll}
            role="log"
            aria-live="off"
            aria-label="Console output"
            sx={{ height: { xs: 420, md: 'calc(100vh - 380px)' }, minHeight: 320, overflow: 'auto', p: 1.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.6, bgcolor: 'action.hover' }}
          >
            {visible.length === 0 ? (
              <Typography color="text.secondary" sx={{ fontFamily: 'inherit' }}>
                {live === 'connecting' ? 'Loading…' : query || level !== 'all' ? 'No lines match.' : 'Nothing yet. Lines appear here as they happen.'}
              </Typography>
            ) : (
              visible.map((l) => (
                <Box key={l.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', color: l.level === 'error' ? 'error.main' : l.level === 'warn' ? 'warning.main' : 'text.primary' }}>
                  <Box component="span" sx={{ color: 'text.secondary', flexShrink: 0 }}>{time(l.at)}</Box>
                  <Box component="span" sx={{ width: 84, flexShrink: 0, color: l.source === 'paldefender' ? 'secondary.main' : l.source === 'panel' ? 'primary.main' : 'text.secondary' }}>{sourceLabel(l.source)}</Box>
                  <Box component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}>{l.message}</Box>
                </Box>
              ))
            )}
          </Box>
          {!follow && !paused && visible.length > 0 && (
            <Button size="small" variant="contained" startIcon={<VerticalAlignBottomIcon />} onClick={() => setFollow(true)} sx={{ position: 'absolute', right: 16, bottom: 16 }}>
              Latest
            </Button>
          )}
        </Box>
      </Section>
    </>
  );
}
