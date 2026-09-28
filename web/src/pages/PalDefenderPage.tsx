import Autocomplete from '@mui/material/Autocomplete';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { PD_MESSAGE_TYPES, type PdGuild, type PdGuildSummary, type PalDefenderStatus, type Player } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { EmptyState, ErrorState, KeyValue, Loading, Mono, PageHeader, Section } from '../components/common';
import { useToast } from '../components/Toast';
import { formatMapPoint } from '../components/world';
import { useApi } from '../hooks/useApi';

/** Guilds and bases, summoning, messages and tools from the optional PalDefender integration. */
export function PalDefenderPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: status, loading } = useApi<PalDefenderStatus>('/paldefender/status');
  const tabs = [
    { id: 'guilds', label: 'Guilds and bases' },
    ...(can('paldefender.manage') ? [{ id: 'summon', label: 'Summon' }] : []),
    ...(can('server.broadcast') || can('players.kick') ? [{ id: 'messages', label: 'Messages' }] : []),
    ...(can('paldefender.manage') ? [{ id: 'tools', label: 'Tools' }] : []),
  ];
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'guilds';

  if (loading && !status) return <Loading />;
  if (!status?.enabled) {
    return (
      <>
        <PageHeader title="Not available" />
        <Section>
          <EmptyState title="This integration isn’t switched on">
            {can('server.connection') ? (
              <>
                Optional integrations are turned on in{' '}
                <Link component={RouterLink} to="/settings?tab=integrations">
                  Settings
                </Link>
                .
              </>
            ) : (
              'An owner can switch on optional integrations in Settings.'
            )}
          </EmptyState>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="PalDefender" description={`PalDefender ${status.version ?? ''} · bans, player inventories and pals are on the Players page`} />
      <Tabs value={tab} onChange={(_, v: string) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>
      {tab === 'guilds' && <Guilds />}
      {tab === 'summon' && <Summon />}
      {tab === 'messages' && <Messages />}
      {tab === 'tools' && <Tools />}
    </>
  );
}

// ---- Guilds and bases ----

function Guilds() {
  const { data, error, loading, reload } = useApi<{ guilds: PdGuildSummary[] }>('/paldefender/guilds', { pollMs: 60000 });
  const [open, setOpen] = useState<PdGuildSummary | null>(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  return (
    <Section title={`Guilds (${data?.guilds.length ?? 0})`} disablePadding>
      <DataTable
        rows={data?.guilds ?? []}
        rowKey={(g) => g.id}
        empty={<EmptyState title="No guilds" />}
        columns={[
          {
            key: 'name',
            header: 'Guild',
            render: (g) => (
              <Link component="button" underline="hover" onClick={() => setOpen(g)} sx={{ fontWeight: 600, textAlign: 'left' }}>
                {g.name}
              </Link>
            ),
          },
          { key: 'level', header: 'Level', render: (g) => g.level ?? '—' },
          { key: 'admin', header: 'Leader', render: (g) => g.admin?.name || '—' },
          { key: 'members', header: 'Members', render: (g) => g.memberCount },
          { key: 'camps', header: 'Bases', render: (g) => g.campCount },
        ]}
      />
      <GuildDialog guild={open} onClose={() => setOpen(null)} onChanged={reload} />
    </Section>
  );
}

function GuildDialog({ guild, onClose, onChanged }: { guild: PdGuildSummary | null; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ guild: PdGuild }>(`/paldefender/guilds/${encodeURIComponent(guild?.id ?? '')}`, { enabled: !!guild });
  const [toDelete, setToDelete] = useState<PdGuild['camps'][number] | null>(null);
  const g = data?.guild;

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else if (g) {
    body = (
      <Stack spacing={2}>
        <KeyValue
          items={[
            ['Level', g.level ?? '—'],
            ['Leader', g.admin?.name || '—'],
            !!g.storage && ['Guild storage', `${g.storage.used}/${g.storage.max} slots`],
            !!g.currentResearch && ['Researching', <Mono>{g.currentResearch}</Mono>],
          ]}
        />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Members ({g.members.length})
        </Typography>
        <DataTable
          rows={g.members}
          rowKey={(m) => m.uid || m.name}
          columns={[
            { key: 'name', header: 'Player', render: (m) => m.name },
            { key: 'status', header: 'Status', render: (m) => m.status ?? '—' },
          ]}
        />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Bases ({g.camps.length})
        </Typography>
        <DataTable
          rows={g.camps}
          rowKey={(c) => c.id}
          empty={<Typography color="text.secondary">No bases</Typography>}
          columns={[
            { key: 'pos', header: 'Position', nowrap: true, render: (c) => (c.mapPos ? formatMapPoint(c.mapPos) : '—') },
            { key: 'level', header: 'Level', render: (c) => c.level ?? '—' },
            { key: 'state', header: 'State', render: (c) => c.state ?? '—' },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (c) =>
                can('paldefender.manage') && (
                  <Button size="small" color="error" variant="outlined" onClick={() => setToDelete(c)}>
                    Delete base
                  </Button>
                ),
            },
          ]}
        />
      </Stack>
    );
  }

  return (
    <>
      <Dialog open={!!guild} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{guild?.name}</DialogTitle>
        <DialogContent dividers>{body}</DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={!!toDelete}
        danger
        title={`Delete this base${toDelete?.mapPos ? ` at ${formatMapPoint(toDelete.mapPos)}` : ''}?`}
        message={`This removes the base of ${guild?.name ?? 'the guild'} from the world: its buildings, storage, items and worker pals. PalDefender writes an archive of what it removed, but PalOps can’t restore it.`}
        confirmLabel="Delete base"
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            const res = await api.post<{ summary: string | null; archive: string | null }>(`/paldefender/bases/${encodeURIComponent(toDelete!.id)}/delete`, { confirm: true });
            notify(`Base deleted${res.archive ? ` (archived: ${res.archive})` : ''}`, 'success');
            await reload();
            onChanged();
          } catch (err) {
            notify(errorMessage(err), 'error');
          }
        }}
      />
    </>
  );
}

// ---- Summon ----

function useSubmit() {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      await api.post(path, body);
      notify(done, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, submit };
}

function Summon() {
  const { busy, submit } = useSubmit();
  const [kind, setKind] = useState<'pal' | 'npc'>('pal');
  const [what, setWhat] = useState('');
  const [isTemplate, setIsTemplate] = useState(false);
  const [coords, setCoords] = useState({ x: '', y: '', z: '' });
  const [level, setLevel] = useState('');
  const [uncapturable, setUncapturable] = useState(false);
  const [disableAi, setDisableAi] = useState(false);
  const [noDamageMeter, setNoDamageMeter] = useState(false);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const base = { x: Number(coords.x), y: Number(coords.y), z: Number(coords.z), level: level ? Number(level) : undefined, uncapturable, disableAi };
    if (kind === 'npc') void submit('/paldefender/summon/npc', { ...base, npcId: what.trim() }, `Summoned ${what.trim()}`);
    else void submit('/paldefender/summon/pal', { ...base, disableDamageMeter: noDamageMeter, ...(isTemplate ? { palTemplate: what.trim() } : { palId: what.trim() }) }, `Summoned ${what.trim()}`);
  };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="Summon a pal or NPC">
          <Stack component="form" spacing={2} onSubmit={send}>
            <TextField select label="What" value={kind} onChange={(e) => setKind(e.target.value as 'pal' | 'npc')}>
              <MenuItem value="pal">Pal</MenuItem>
              <MenuItem value="npc">NPC</MenuItem>
            </TextField>
            <TextField
              label={kind === 'npc' ? 'NPC ID' : isTemplate ? 'Template file' : 'Pal ID'}
              placeholder={kind === 'npc' ? 'PIDF_Soldier_AssaultRifle' : isTemplate ? 'ArenaBoss.json' : 'Anubis'}
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              required
            />
            {kind === 'pal' && <FormControlLabel control={<Checkbox checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} />} label="Use a template file from PalDefender’s Pals/Templates folder" />}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <TextField key={axis} label={axis.toUpperCase()} type="number" required value={coords[axis]} onChange={(e) => setCoords({ ...coords, [axis]: e.target.value })} slotProps={{ htmlInput: { step: 'any' } }} />
              ))}
              <TextField label="Level" type="number" value={level} onChange={(e) => setLevel(e.target.value)} disabled={kind === 'pal' && isTemplate} slotProps={{ htmlInput: { min: 1, max: 100 } }} />
            </Stack>
            <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 2 }}>
              <FormControlLabel control={<Checkbox checked={uncapturable} onChange={(e) => setUncapturable(e.target.checked)} />} label="Can’t be captured" />
              <FormControlLabel control={<Checkbox checked={disableAi} onChange={(e) => setDisableAi(e.target.checked)} />} label="No AI" />
              {kind === 'pal' && <FormControlLabel control={<Checkbox checked={noDamageMeter} onChange={(e) => setNoDamageMeter(e.target.checked)} />} label="No damage meter" />}
            </Stack>
            <Stack direction="row">
              <Button variant="contained" type="submit" loading={busy}>
                Summon
              </Button>
            </Stack>
          </Stack>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Section title="Good to know">
          <Typography variant="body2" color="text.secondary" component="div">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Enter the X, Y and Z that PalDefender’s summon endpoints take. Its documentation’s example is 230, -486, 4097.</li>
              <li>Combine “can’t be captured” and “no AI” for a display or arena boss.</li>
              <li>Every summon is recorded in the audit log.</li>
            </ul>
          </Typography>
        </Section>
      </Grid>
    </Grid>
  );
}

// ---- Messages ----

function Messages() {
  const { can } = useAuth();
  const { busy, submit } = useSubmit();
  const [alert, setAlert] = useState('');
  const [chat, setChat] = useState('');
  const [sendType, setSendType] = useState('PlayerChat');
  const [text, setText] = useState('');
  const [targets, setTargets] = useState<Player[]>([]);
  const { data: online } = useApi<{ players: Player[] }>('/players', { enabled: can('players.kick') });

  return (
    <Grid container spacing={2}>
      {can('server.broadcast') && (
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="To everyone">
            <Stack spacing={3}>
              <Stack component="form" spacing={1.5} onSubmit={(e) => (e.preventDefault(), void submit('/paldefender/alert', { message: alert }, 'Alert sent').then(() => setAlert('')))}>
                <TextField label="On-screen alert" value={alert} onChange={(e) => setAlert(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} helperText="A banner every player sees" />
                <Stack direction="row">
                  <Button variant="contained" type="submit" loading={busy} disabled={!alert.trim()}>
                    Send alert
                  </Button>
                </Stack>
              </Stack>
              <Stack component="form" spacing={1.5} onSubmit={(e) => (e.preventDefault(), void submit('/paldefender/broadcast', { message: chat }, 'Chat message sent').then(() => setChat('')))}>
                <TextField label="Chat message" value={chat} onChange={(e) => setChat(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} helperText="Appears in everyone’s chat" />
                <Stack direction="row">
                  <Button variant="outlined" type="submit" loading={busy} disabled={!chat.trim()}>
                    Send to chat
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Section>
        </Grid>
      )}
      {can('players.kick') && (
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="To specific players">
            <Stack component="form" spacing={1.5} onSubmit={(e) => (e.preventDefault(), void submit('/paldefender/message', { sendType, message: text, userIds: targets.map((t) => t.userId) }, `Sent to ${targets.length} player${targets.length === 1 ? '' : 's'}`).then(() => setText('')))}>
              <Autocomplete
                multiple
                options={online?.players ?? []}
                value={targets}
                onChange={(_, v) => setTargets(v)}
                getOptionLabel={(p) => p.name}
                isOptionEqualToValue={(a, b) => a.userId === b.userId}
                renderInput={(params) => <TextField {...params} label="Players (online now)" />}
              />
              <TextField select label="How it appears" value={sendType} onChange={(e) => setSendType(e.target.value)}>
                {PD_MESSAGE_TYPES.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Message" value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} />
              <Stack direction="row">
                <Button variant="contained" type="submit" loading={busy} disabled={!text.trim() || targets.length === 0}>
                  Send
                </Button>
              </Stack>
            </Stack>
          </Section>
        </Grid>
      )}
    </Grid>
  );
}

// ---- Tools ----

function Tools() {
  const { busy, submit } = useSubmit();
  return (
    <Section title="PalDefender configuration">
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Typography color="text.secondary">
          After editing PalDefender’s <Mono>Config.json</Mono> on the server, reload it here instead of restarting the game server.
        </Typography>
        <Button variant="outlined" loading={busy} onClick={() => void submit('/paldefender/reload-config', {}, 'PalDefender config reloaded')}>
          Reload config
        </Button>
        <Alert severity="info" icon={false}>
          The token needs <Mono>REST.Reload.Config</Mono> for this.
        </Alert>
      </Stack>
    </Section>
  );
}
