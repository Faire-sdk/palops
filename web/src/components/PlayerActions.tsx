import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { IpBan, ModerationAction, PalDefenderResult, PlayerProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime, formatDuration } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { EmptyState, ErrorState, KeyValue, Loading, Mono } from './common';
import { useToast } from './Toast';
import { usePalDefender } from '../hooks/usePalDefender';
import { PalDefenderPlayerDialog } from './PalDefenderPlayer';
import { formatMapPoint, palLabel, SignalChip } from './world';

type Action = 'kick' | 'ban' | 'unban';

/**
 * The official API did the action; with PalDefender switched on the panel also
 * mirrors it there. Say so when that part failed, so it isn't a silent gap.
 */
export function warnIfPalDefenderFailed(notify: (message: string, tone?: 'warning') => void, result: PalDefenderResult | undefined) {
  if (result && !result.ok && result.message) notify(`${result.message}. The action itself worked; PalDefender’s own list wasn’t updated.`, 'warning');
}

const ACTION_COPY: Record<Action, { title: string; button: string; hint: string; done: string }> = {
  kick: { title: 'Kick', button: 'Kick player', hint: 'Shown to the player and kept in their history. They can rejoin right away.', done: 'kicked' },
  ban: { title: 'Ban', button: 'Ban player', hint: 'Shown to the player and kept in their history. They can’t rejoin until unbanned.', done: 'banned' },
  unban: { title: 'Unban', button: 'Unban player', hint: 'Kept in their history. They can join again straight away.', done: 'unbanned' },
};

/** Kick, ban or unban one player, with a reason. */
export function ModerationDialog({ action, userId, name, onClose }: { action: Action | null; userId: string; name: string; onClose: () => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const [reason, setReason] = useState('');
  const [banIp, setBanIp] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = action ? ACTION_COPY[action] : null;
  useEffect(() => {
    if (action) {
      setReason('');
      setBanIp(false);
    }
  }, [action, userId]);

  const submit = async () => {
    if (!action || !copy) return;
    setBusy(true);
    try {
      const res = await api.post<{ ipBan?: IpBan | null; ipSkipped?: string | null; paldefender?: PalDefenderResult }>(`/players/${encodeURIComponent(userId)}/${action}`, action === 'ban' ? { reason, banIp } : { reason });
      notify(`${name} was ${copy.done}${res?.ipBan ? ` and ${res.ipBan.ip} was banned` : ''}`, 'success');
      if (res?.ipSkipped) notify(res.ipSkipped, 'warning');
      warnIfPalDefenderFailed(notify, res?.paldefender);
      setReason('');
      refreshAll();
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!action} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {copy?.title} {name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField
            label="Reason"
            placeholder="Optional"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText={copy?.hint}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          {action === 'ban' && can('world.view') && (
            <FormControlLabel
              control={<Checkbox checked={banIp} onChange={(e) => setBanIp(e.target.checked)} />}
              label={
                <>
                  Also ban their IP address
                  <Typography variant="body2" color="text.secondary">
                    Bans the address they last connected from, so a new account there is banned too. Housemates and shared networks are caught as well.
                  </Typography>
                </>
              }
              sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
            />
          )}
          <Typography variant="body2" color="text.secondary">
            <Mono>{userId}</Mono>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color={action === 'unban' ? 'primary' : 'error'} onClick={submit} loading={busy}>
          {copy?.button}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Ban an IP address by hand. Any account seen connecting from it is banned. */
export function IpBanDialog({ ip, open, onClose }: { ip: string; open: boolean; onClose: () => void }) {
  const notify = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open, ip]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ paldefender?: PalDefenderResult }>('/players/ip-bans', { ip, reason });
      notify(`${ip} was banned`, 'success');
      warnIfPalDefenderFailed(notify, res?.paldefender);
      refreshAll();
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Ban address {ip}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Alert severity="warning">
            Every account seen on this address is banned, now and whenever it connects later. That includes housemates and anyone on a shared network. The panel checks
            about every 20 seconds, so a player can be on the server briefly before they’re removed.
          </Alert>
          <TextField
            label="Reason"
            placeholder="Optional"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="Kept with the ban and shown to the player as the ban message."
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={submit} loading={busy}>
          Ban address
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ACTION_CHIP: Record<ModerationAction, 'warning' | 'error' | 'success' | 'info'> = {
  kick: 'warning',
  ban: 'error',
  unban: 'success',
  note: 'info',
};

/** A player's details, moderation history and notes. */
export function PlayerProfileDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<PlayerProfile>(`/players/${encodeURIComponent(userId ?? '')}`, { enabled: !!userId });
  const [action, setAction] = useState<Action | null>(null);
  const [ipToBan, setIpToBan] = useState<string | null>(null);
  const [pdOpen, setPdOpen] = useState(false);
  const paldefender = usePalDefender();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const player = data?.userId === userId ? data?.player : undefined;
  const name = player?.name ?? userId ?? '';

  const addNote = async () => {
    if (!userId || !note.trim()) return;
    setSaving(true);
    try {
      await api.post(`/players/${encodeURIComponent(userId)}/notes`, { text: note });
      setNote('');
      await reload();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  let body;
  if ((loading && !data) || (data && data.userId !== userId)) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else if (data) {
    body = (
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1}>
          {player?.online ? <Chip label="Online" color="success" /> : <Chip label="Offline" variant="outlined" />}
          {data.banned && <Chip label="Banned" color="error" />}
        </Stack>
        <KeyValue
          items={[
            ['Platform ID', <Mono>{data.userId}</Mono>],
            !!player?.accountName && ['Account name', player.accountName],
            !!player?.playerId && ['Player UID', <Mono>{player.playerId}</Mono>],
            !!player && ['Level', player.level ?? '—'],
            !!player && ['Guild', player.guild ?? '—'],
            !!data.live && ['Current address', <Mono>{data.live.ip ?? '—'}</Mono>],
            !!data.live && ['Ping', data.live.ping !== null ? `${Math.round(data.live.ping)} ms` : '—'],
            !!data.live && ['Buildings', data.live.buildingCount ?? '—'],
            !!data.live?.position && ['Position', formatMapPoint(data.live.position)],
            !!player && ['First seen', formatDateTime(player.firstSeenAt)],
            !!player && ['Last seen', formatDateTime(player.lastSeenAt)],
          ]}
        />
        {!player && <Alert severity="info">PalOps hasn’t seen this player online yet.</Alert>}

        {data.activity.sessions > 0 && (
          <>
            <Divider />
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              Activity
            </Typography>
            <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(
                [
                  ['Playtime', formatDuration(data.activity.seconds)],
                  ['Visits', data.activity.sessions],
                  ['Average visit', formatDuration(data.activity.averageSeconds)],
                  ['Longest visit', formatDuration(data.activity.longestSeconds)],
                ] as const
              ).map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="h6" component="div">
                    {value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Recent visits:{' '}
              {data.activity.recent
                .slice(0, 5)
                .map((v) => `${formatDateTime(v.startedAt)} (${v.endedAt ? formatDuration(v.seconds) : 'now'})`)
                .join(' · ')}
            </Typography>
          </>
        )}

        {data.link && (
          <>
            <Divider />
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
                Discord
              </Typography>
              <Chip label={data.link.verified ? `Verified · ${data.link.verifiedBy === 'code' ? 'in-game code' : `by ${data.link.verifiedBy}`}` : data.link.requestedAt ? 'Verification requested' : 'Claimed, not verified'} color={data.link.verified ? 'success' : 'warning'} variant="outlined" />
            </Stack>
            <Typography>
              Linked to <strong>{data.link.discord.username ?? data.link.discord.id}</strong> <Mono muted>{data.link.discord.id}</Mono>
            </Typography>
            {!data.link.verified && <Typography variant="body2" color="text.secondary">A claim proves nothing: anyone can claim a name. Only verified links give Discord roles or carry bans.</Typography>}
            {can('players.ban') && (
              <Stack direction="row" spacing={1}>
                {!data.link.verified && (
                  <Button size="small" variant="outlined" onClick={async () => { try { await api.post(`/players/${encodeURIComponent(data.userId)}/link/verify`); notify('Link verified', 'success'); await reload(); } catch (err) { notify(errorMessage(err), 'error'); } }}>
                    Verify this link
                  </Button>
                )}
                <Button size="small" color="error" variant="outlined" onClick={async () => { try { await api.delete(`/players/${encodeURIComponent(data.userId)}/link`); notify('Link removed', 'success'); await reload(); } catch (err) { notify(errorMessage(err), 'error'); } }}>
                  Remove link
                </Button>
              </Stack>
            )}
          </>
        )}

        {(can('players.kick') || can('players.ban') || (paldefender && can('world.view') && player?.online)) && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {paldefender && can('world.view') && player?.online && (
              <Button variant="outlined" onClick={() => setPdOpen(true)} title="Inventory, pals, technologies and progression from PalDefender">
                PalDefender
              </Button>
            )}
            {can('players.kick') && player?.online && (
              <Button variant="outlined" onClick={() => setAction('kick')}>
                Kick
              </Button>
            )}
            {can('players.ban') &&
              (data.banned ? (
                <Button variant="outlined" onClick={() => setAction('unban')}>
                  Unban
                </Button>
              ) : (
                <Button variant="outlined" color="error" onClick={() => setAction('ban')}>
                  Ban
                </Button>
              ))}
          </Stack>
        )}

        {data.ips.length > 0 && (
          <>
            <Divider />
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              Addresses
            </Typography>
            <List dense disablePadding>
              {data.ips.map((i) => (
                <ListItem
                  key={i.ip}
                  disableGutters
                  alignItems="flex-start"
                  secondaryAction={
                    can('players.ban') && !i.banned ? (
                      <Button size="small" color="error" variant="outlined" onClick={() => setIpToBan(i.ip)}>
                        Ban address
                      </Button>
                    ) : undefined
                  }
                >
                  <ListItemText
                    slotProps={{ secondary: { component: 'div' } }}
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Mono>{i.ip}</Mono>
                        {i.banned && <Chip label="Banned" color="error" size="small" variant="outlined" />}
                      </Stack>
                    }
                    secondary={
                      <>
                        {`First seen ${formatDateTime(i.firstSeenAt)} · last seen ${formatDateTime(i.lastSeenAt)}`}
                        {i.sharedWith.length > 0 && (
                          <Box sx={{ color: 'warning.main' }}>Also used by {i.sharedWith.map((o) => o.name).join(', ')}</Box>
                        )}
                      </>
                    }
                    sx={{ pr: can('players.ban') && !i.banned ? 14 : 0 }}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

        {data.pals.length > 0 && (
          <>
            <Divider />
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              Pals seen with {name}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {data.pals.map((p) => (
                <Chip
                  key={p.instanceId}
                  label={`${palLabel(p)} · Lv ${p.level ?? '?'}`}
                  color={p.active ? 'primary' : 'default'}
                  variant={p.active ? 'filled' : 'outlined'}
                  title={p.active ? 'Out in the world now' : `Last seen ${formatDateTime(p.lastSeenAt)}`}
                />
              ))}
            </Stack>
          </>
        )}

        {data.signals.length > 0 && (
          <>
            <Divider />
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              Signals
            </Typography>
            <List dense disablePadding>
              {data.signals.map((s) => (
                <ListItem key={s.id} disableGutters alignItems="flex-start" sx={{ gap: 1.5, opacity: s.dismissedAt ? 0.6 : 1 }}>
                  <Box sx={{ mt: 0.5 }}>
                    <SignalChip kind={s.kind} />
                  </Box>
                  <ListItemText primary={s.summary} secondary={`${formatDateTime(s.createdAt)}${s.dismissedAt ? ` · dismissed by ${s.dismissedBy ?? 'someone'}` : ''}`} />
                </ListItem>
              ))}
            </List>
          </>
        )}

        <Divider />
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          History and notes
        </Typography>
        {can('players.note') && (
          <Stack direction="row" spacing={1} component="form" onSubmit={(e) => (e.preventDefault(), void addNote())}>
            <TextField label="Add a staff note" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
            <Button variant="outlined" type="submit" loading={saving} disabled={!note.trim()}>
              Add
            </Button>
          </Stack>
        )}
        {data.history.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <List dense disablePadding>
            {data.history.map((h) => (
              <ListItem key={h.id} disableGutters alignItems="flex-start" sx={{ gap: 1.5 }}>
                <Chip label={h.action} color={ACTION_CHIP[h.action]} variant="outlined" sx={{ mt: 0.5, minWidth: 64 }} />
                <ListItemText
                  primary={h.reason ?? 'No reason given'}
                  secondary={`${h.actorUsername ?? 'unknown'} · ${formatDateTime(h.createdAt)}`}
                  slotProps={{ primary: { color: h.reason ? 'text.primary' : 'text.secondary' } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
    );
  }

  return (
    <>
      <Dialog open={!!userId} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{name}</DialogTitle>
        <DialogContent dividers>{body}</DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      <PalDefenderPlayerDialog userId={pdOpen ? userId : null} name={name} onClose={() => setPdOpen(false)} />
      <IpBanDialog
        ip={ipToBan ?? ''}
        open={!!ipToBan}
        onClose={() => {
          setIpToBan(null);
          void reload();
        }}
      />
      <ModerationDialog
        action={action}
        userId={userId ?? ''}
        name={name}
        onClose={() => {
          setAction(null);
          void reload();
        }}
      />
    </>
  );
}
