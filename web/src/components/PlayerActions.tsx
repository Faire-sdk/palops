import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { ModerationAction, PlayerProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { EmptyState, ErrorState, KeyValue, Loading, Mono } from './common';
import { useToast } from './Toast';
import { palLabel, SignalChip } from './world';

type Action = 'kick' | 'ban' | 'unban';

const ACTION_COPY: Record<Action, { title: string; button: string; hint: string; done: string }> = {
  kick: { title: 'Kick', button: 'Kick player', hint: 'Shown to the player and kept in their history. They can rejoin right away.', done: 'kicked' },
  ban: { title: 'Ban', button: 'Ban player', hint: 'Shown to the player and kept in their history. They can’t rejoin until unbanned.', done: 'banned' },
  unban: { title: 'Unban', button: 'Unban player', hint: 'Kept in their history. They can join again straight away.', done: 'unbanned' },
};

/** Kick, ban or unban one player, with a reason. */
export function ModerationDialog({ action, userId, name, onClose }: { action: Action | null; userId: string; name: string; onClose: () => void }) {
  const notify = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = action ? ACTION_COPY[action] : null;
  useEffect(() => {
    if (action) setReason('');
  }, [action, userId]);

  const submit = async () => {
    if (!action || !copy) return;
    setBusy(true);
    try {
      await api.post(`/players/${encodeURIComponent(userId)}/${action}`, { reason });
      notify(`${name} was ${copy.done}`, 'success');
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
            !!player && ['Level', player.level ?? '—'],
            !!player && ['Guild', player.guild ?? '—'],
            !!player && ['First seen', formatDateTime(player.firstSeenAt)],
            !!player && ['Last seen', formatDateTime(player.lastSeenAt)],
          ]}
        />
        {!player && <Alert severity="info">PalOps hasn’t seen this player online yet.</Alert>}

        {(can('players.kick') || can('players.ban')) && (
          <Stack direction="row" spacing={1}>
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
