import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../api/client';
import { PD_MESSAGE_TYPES, PD_RELICS, type PdItems, type PdPal, type PdPals, type PdProgression, type PdTechs } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../hooks/useApi';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable } from './DataTable';
import { EmptyState, ErrorState, KeyValue, Loading, Mono } from './common';
import { useToast } from './Toast';
import { formatMapPoint, prettyClass } from './world';

/** PalDefender only reads players who are online, so a 404 gets its own explanation. */
function PdData<T>({ path, children }: { path: string; children: (data: T) => ReactNode }) {
  const { data, error, loading, reload } = useApi<T>(path);
  if (loading && !data) return <Loading />;
  if (error && !data) {
    if (error instanceof ApiError && error.code === 'paldefender_not_found') {
      return <EmptyState title="Not available">{error.message}. PalDefender can only read players who are online right now.</EmptyState>;
    }
    return <ErrorState error={error} onRetry={reload} />;
  }
  return <>{data && children(data)}</>;
}

const palName = (p: PdPal) => p.nickname ?? prettyClass(p.palId) ?? p.palId;

function PalTable({ pals, limit = 300 }: { pals: PdPal[]; limit?: number }) {
  if (pals.length === 0) return <EmptyState title="None" />;
  return (
    <>
      <DataTable
        rows={pals.slice(0, limit)}
        rowKey={(p) => p.instanceId}
        columns={[
          {
            key: 'name',
            header: 'Pal',
            render: (p) => (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <span>{palName(p)}</span>
                {p.shiny && <Chip label="Shiny" size="small" color="warning" variant="outlined" />}
                {p.nickname && <Typography variant="caption" color="text.secondary">{prettyClass(p.palId)}</Typography>}
              </Stack>
            ),
          },
          { key: 'level', header: 'Lv', render: (p) => p.level ?? '—' },
          { key: 'gender', header: 'Gender', render: (p) => p.gender ?? '—' },
          { key: 'hp', header: 'HP', render: (p) => (p.hp !== null ? Math.round(p.hp) : '—') },
          { key: 'passives', header: 'Passives', render: (p) => (p.passives.length ? p.passives.join(', ') : '—') },
        ]}
      />
      {pals.length > limit && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
          Showing the first {limit} of {pals.length}.
        </Typography>
      )}
    </>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mt: 1 }}>
      {children}
    </Typography>
  );
}

function InventoryTab({ userId }: { userId: string }) {
  return (
    <PdData<PdItems> path={`/paldefender/players/${encodeURIComponent(userId)}/items`}>
      {(data) => (
        <Stack spacing={1}>
          {data.containers.map((c) => (
            <Box key={c.name}>
              <Heading>
                {c.name}
                {c.available && c.maxSlots !== null && (
                  <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                    {c.usedSlots ?? c.slots.length}/{c.maxSlots} slots
                  </Typography>
                )}
              </Heading>
              {!c.available ? (
                <Typography color="text.secondary">Not available</Typography>
              ) : (
                <DataTable
                  rows={c.slots}
                  rowKey={(s) => s.slot}
                  empty={<Typography color="text.secondary">Empty</Typography>}
                  columns={[
                    { key: 'slot', header: 'Slot', render: (s) => s.slot },
                    { key: 'item', header: 'Item', render: (s) => <Mono>{s.itemId}</Mono> },
                    { key: 'count', header: 'Count', render: (s) => s.count.toLocaleString() },
                  ]}
                />
              )}
            </Box>
          ))}
        </Stack>
      )}
    </PdData>
  );
}

function PalsTab({ userId }: { userId: string }) {
  return (
    <PdData<PdPals> path={`/paldefender/players/${encodeURIComponent(userId)}/pals`}>
      {(data) => (
        <Stack spacing={1}>
          <Heading>Party ({data.team.length})</Heading>
          <PalTable pals={data.team} />
          <Heading>Palbox ({data.palbox.length})</Heading>
          <PalTable pals={data.palbox} />
          {data.baseCamps.map((c, i) => (
            <Box key={c.id || i}>
              <Heading>
                Base {i + 1} ({c.pals.length} pals)
                <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                  {c.level !== null && `level ${c.level}`}
                  {c.mapPos && ` · ${formatMapPoint(c.mapPos)}`}
                </Typography>
              </Heading>
              <PalTable pals={c.pals} />
            </Box>
          ))}
        </Stack>
      )}
    </PdData>
  );
}

/** Splits "A, B  C" into ids. */
const ids = (text: string) => text.split(/[\s,]+/).filter(Boolean);

function TechsTab({ userId }: { userId: string }) {
  const { can } = useAuth();
  const notify = useToast();
  const [filter, setFilter] = useState('');
  const [input, setInput] = useState('');
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState<'forget' | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/paldefender/players/${encodeURIComponent(userId)}/techs`;
  const { data, error, loading, reload } = useApi<PdTechs>(path);

  const run = async (action: 'learn' | 'forget') => {
    setBusy(true);
    try {
      const technology = all ? 'All' : ids(input);
      const res = await api.post<{ unlocked?: string[]; forgotten?: string[]; skipped: string[] }>(`/paldefender/players/${encodeURIComponent(userId)}/tech/${action}`, { technology });
      const done = res.unlocked ?? res.forgotten ?? [];
      notify(`${action === 'learn' ? 'Unlocked' : 'Forgot'} ${done.length} technolog${done.length === 1 ? 'y' : 'ies'}${res.skipped.length ? `, skipped ${res.skipped.length}` : ''}`, 'success');
      setInput('');
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) {
    return error instanceof ApiError && error.code === 'paldefender_not_found' ? <EmptyState title="Not available">PalDefender can only read players who are online right now.</EmptyState> : <ErrorState error={error} onRetry={reload} />;
  }
  if (!data) return null;
  const shown = data.unlocked.filter((t) => t.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Stack spacing={2}>
      <Typography>
        {data.unlockedCount} of {data.totalCount} technologies unlocked.
      </Typography>
      <TextField label="Filter unlocked" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {shown.slice(0, 400).map((t) => (
          <Chip key={t} label={t.replace(/^Technology_/, '')} size="small" variant="outlined" onClick={() => setInput((v) => (v ? `${v} ${t}` : t))} title="Click to add to the learn/forget box" />
        ))}
      </Stack>
      {can('paldefender.manage') && (
        <Stack spacing={1.5}>
          <Heading>Teach or make them forget</Heading>
          <TextField label="Technology IDs" placeholder="Technology_ElecBaton Technology_GrapplingGun" value={input} onChange={(e) => setInput(e.target.value)} disabled={all} helperText="Separate several with spaces or commas" />
          <FormControlLabel control={<Checkbox checked={all} onChange={(e) => setAll(e.target.checked)} />} label="All technologies" />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" disabled={busy || (!all && ids(input).length === 0)} onClick={() => run('learn')}>
              Learn
            </Button>
            <Button variant="outlined" color="error" disabled={busy || (!all && ids(input).length === 0)} onClick={() => (all ? setConfirm('forget') : run('forget'))}>
              Forget
            </Button>
          </Stack>
        </Stack>
      )}
      <ConfirmDialog
        open={confirm === 'forget'}
        title="Make them forget every technology?"
        message="They lose all unlocked technologies. They can be taught them again, but any use of the recipes in between is lost."
        confirmLabel="Forget all"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => run('forget')}
      />
    </Stack>
  );
}

const isScalar = (v: unknown): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v);

function ProgressionTab({ userId }: { userId: string }) {
  return (
    <PdData<PdProgression> path={`/paldefender/players/${encodeURIComponent(userId)}/progression`}>
      {({ progression }) => {
        const scalars = (group: unknown) => Object.entries((group ?? {}) as Record<string, unknown>).filter(([, v]) => isScalar(v)) as Array<[string, string | number | boolean]>;
        const summary: Array<[string, string]> = ['Player', 'Currencies', 'Bosses', 'Activities', 'Captures'].flatMap((g) => scalars(progression[g]).map(([k, v]): [string, string] => [`${g}: ${k}`, String(v)]));
        return (
          <Stack spacing={2}>
            <KeyValue items={summary} />
            <details>
              <summary style={{ cursor: 'pointer' }}>Everything PalDefender reports</summary>
              <Box component="pre" sx={{ m: 0, mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, overflow: 'auto', maxHeight: 360 }}>
                {JSON.stringify(progression, null, 2)}
              </Box>
            </details>
          </Stack>
        );
      }}
    </PdData>
  );
}

// ---- Give ----

type Row = Record<string, string>;

/** A list of small forms: one row per thing to give. */
function Rows({ fields, rows, onChange }: { fields: Array<{ key: string; label: string; type?: 'number'; width?: number }>; rows: Row[]; onChange: (rows: Row[]) => void }) {
  const blank = Object.fromEntries(fields.map((f) => [f.key, '']));
  return (
    <Stack spacing={1}>
      {rows.map((row, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          {fields.map((f) => (
            <TextField key={f.key} label={f.label} type={f.type} size="small" value={row[f.key]} onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [f.key]: e.target.value } : r)))} sx={{ flex: f.width ? undefined : 1, width: f.width }} />
          ))}
          <IconButton aria-label="Remove row" onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blank])}>
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      ))}
      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...rows, blank])}>
          Add another
        </Button>
      </Box>
    </Stack>
  );
}

const ITEM_FIELDS = [{ key: 'itemId', label: 'Item ID' }, { key: 'count', label: 'Count', type: 'number' as const, width: 110 }];
const PAL_FIELDS = [{ key: 'palId', label: 'Pal ID' }, { key: 'level', label: 'Level', type: 'number' as const, width: 100 }];
const EGG_FIELDS = [{ key: 'eggId', label: 'Egg item ID' }, { key: 'palId', label: 'Pal ID' }, { key: 'level', label: 'Level', type: 'number' as const, width: 90 }];
const RELIC_FIELDS = [{ key: 'relic', label: 'Relic' }, { key: 'count', label: 'Amount', type: 'number' as const, width: 110 }];

const int = (v: string) => (v.trim() === '' ? undefined : Number(v));
const filled = (rows: Row[], key: string) => rows.filter((r) => r[key]?.trim());

function GiveTab({ userId }: { userId: string }) {
  const notify = useToast();
  const [kind, setKind] = useState<'items' | 'pals' | 'eggs' | 'templates' | 'progression'>('items');
  const [items, setItems] = useState<Row[]>([{ itemId: '', count: '1' }]);
  const [pals, setPals] = useState<Row[]>([{ palId: '', level: '1' }]);
  const [eggs, setEggs] = useState<Row[]>([{ eggId: '', palId: '', level: '' }]);
  const [templates, setTemplates] = useState('');
  const [exp, setExp] = useState('');
  const [techPoints, setTechPoints] = useState('');
  const [ancientPoints, setAncientPoints] = useState('');
  const [relics, setRelics] = useState<Row[]>([{ relic: '', count: '' }]);
  const [busy, setBusy] = useState(false);

  const payload = (): Record<string, unknown> => {
    switch (kind) {
      case 'items':
        return { items: filled(items, 'itemId').map((r) => ({ itemId: r.itemId!.trim(), count: Number(r.count) })) };
      case 'pals':
        return { pals: filled(pals, 'palId').map((r) => ({ palId: r.palId!.trim(), level: Number(r.level) })) };
      case 'eggs':
        return { eggs: filled(eggs, 'eggId').map((r) => ({ eggId: r.eggId!.trim(), palId: r.palId?.trim() || undefined, level: int(r.level ?? '') })) };
      case 'templates':
        return { templates: ids(templates) };
      case 'progression':
        return {
          exp: int(exp),
          technologyPoints: int(techPoints),
          ancientTechnologyPoints: int(ancientPoints),
          relics: Object.fromEntries(filled(relics, 'relic').map((r) => [r.relic!, Number(r.count)])),
        };
    }
  };

  const give = async () => {
    setBusy(true);
    try {
      await api.post(`/paldefender/players/${encodeURIComponent(userId)}/give/${kind}`, payload());
      notify('Given', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => v && setKind(v)} sx={{ flexWrap: 'wrap' }}>
        {(['items', 'pals', 'eggs', 'templates', 'progression'] as const).map((k) => (
          <ToggleButton key={k} value={k} sx={{ textTransform: 'capitalize' }}>
            {k}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Alert severity="info">The player must be online. It goes straight into their inventory or Pal storage, and the action is recorded in the audit log.</Alert>
      {kind === 'items' && <Rows fields={ITEM_FIELDS} rows={items} onChange={setItems} />}
      {kind === 'pals' && <Rows fields={PAL_FIELDS} rows={pals} onChange={setPals} />}
      {kind === 'eggs' && (
        <>
          <Rows fields={EGG_FIELDS} rows={eggs} onChange={setEggs} />
          <Typography variant="body2" color="text.secondary">
            Eggs are given by Pal ID. To give one from a template file, use PalDefender’s API directly.
          </Typography>
        </>
      )}
      {kind === 'templates' && (
        <TextField label="Template file names" placeholder="starter_pengullet.json raid_reward_01.json" value={templates} onChange={(e) => setTemplates(e.target.value)} helperText="From PalDefender’s Pals/Templates folder. Separate several with spaces." />
      )}
      {kind === 'progression' && (
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField label="Experience" type="number" value={exp} onChange={(e) => setExp(e.target.value)} />
            <TextField label="Technology points" type="number" value={techPoints} onChange={(e) => setTechPoints(e.target.value)} />
            <TextField label="Ancient tech points" type="number" value={ancientPoints} onChange={(e) => setAncientPoints(e.target.value)} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Relics (one of: {PD_RELICS.join(', ')})
          </Typography>
          <Rows fields={RELIC_FIELDS} rows={relics} onChange={setRelics} />
        </Stack>
      )}
      <Box>
        <Button variant="contained" onClick={give} loading={busy}>
          Give
        </Button>
      </Box>
    </Stack>
  );
}

function MessageTab({ userId, name }: { userId: string; name: string }) {
  const notify = useToast();
  const [sendType, setSendType] = useState<string>('PlayerLogImportant');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post('/paldefender/message', { sendType, message, userIds: [userId] });
      notify(`Message sent to ${name}`, 'success');
      setMessage('');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack component="form" spacing={2} onSubmit={(e) => (e.preventDefault(), void send())}>
      <TextField select label="How it appears" value={sendType} onChange={(e) => setSendType(e.target.value)}>
        {PD_MESSAGE_TYPES.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField label="Message" value={message} onChange={(e) => setMessage(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} helperText="Only reaches them while they’re online. The token needs the matching REST.Messages.Send.* permission." />
      <Box>
        <Button variant="contained" type="submit" loading={busy} disabled={!message.trim()}>
          Send
        </Button>
      </Box>
    </Stack>
  );
}

/**
 * What PalDefender knows about one online player: inventory, pals, technologies
 * and progression, plus (for admins) giving things to them and (for
 * moderators) messaging them.
 */
export function PalDefenderPlayerDialog({ userId, name, onClose }: { userId: string | null; name: string; onClose: () => void }) {
  const { can } = useAuth();
  const tabs = [
    { id: 'items', label: 'Inventory' },
    { id: 'pals', label: 'Pals' },
    { id: 'techs', label: 'Technologies' },
    { id: 'progression', label: 'Progression' },
    ...(can('paldefender.manage') ? [{ id: 'give', label: 'Give' }] : []),
    ...(can('players.kick') ? [{ id: 'message', label: 'Message' }] : []),
  ];
  const [tab, setTab] = useState('items');
  const current = tabs.find((t) => t.id === tab)?.id ?? 'items';
  return (
    <Dialog open={!!userId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{name} · PalDefender</DialogTitle>
      <Tabs value={current} onChange={(_, v: string) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      <DialogContent sx={{ minHeight: 320 }}>
        {userId && (
          <>
            {current === 'items' && <InventoryTab userId={userId} />}
            {current === 'pals' && <PalsTab userId={userId} />}
            {current === 'techs' && <TechsTab userId={userId} />}
            {current === 'progression' && <ProgressionTab userId={userId} />}
            {current === 'give' && <GiveTab userId={userId} />}
            {current === 'message' && <MessageTab userId={userId} name={name} />}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
