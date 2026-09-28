import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { PlayerProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Loading } from './ui';

type Action = 'kick' | 'ban' | 'unban';

const ACTION_COPY: Record<Action, { title: string; button: string; hint: string; done: string }> = {
  kick: { title: 'Kick', button: 'Kick player', hint: 'Shown to the player and kept in their history. They can rejoin right away.', done: 'kicked' },
  ban: { title: 'Ban', button: 'Ban player', hint: 'Shown to the player and kept in their history. They can’t rejoin until unbanned.', done: 'banned' },
  unban: { title: 'Unban', button: 'Unban player', hint: 'Kept in their history. They can join again straight away.', done: 'unbanned' },
};

/** Kick, ban or unban one player, with a reason. */
export function ModerationDialog({
  action,
  userId,
  name,
  onClose,
}: {
  action: Action | null;
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const notify = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const copy = ACTION_COPY[action];

  const submit = async () => {
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
    <Modal
      open
      title={`${copy.title} ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={action === 'unban' ? 'primary' : 'danger'} onClick={submit} loading={busy}>
            {copy.button}
          </Button>
        </>
      }
    >
      <div className="form">
        <Field label="Reason" hint={copy.hint}>
          <Input autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </Field>
        <p className="muted small mono">{userId}</p>
      </div>
    </Modal>
  );
}

const ACTION_BADGE: Record<string, 'neutral' | 'warning' | 'error' | 'success' | 'accent'> = {
  kick: 'warning',
  ban: 'error',
  unban: 'success',
  note: 'accent',
};

/** A player's details, moderation history and notes. */
export function PlayerProfileModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<PlayerProfile>(`/players/${encodeURIComponent(userId ?? '')}`, { enabled: !!userId });
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  if (!userId) return null;

  const player = data?.player;
  const name = player?.name ?? userId;

  const addNote = async () => {
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
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else if (data) {
    body = (
      <div className="form">
        <div className="inline-row">
          {player?.online ? <Badge tone="success">Online</Badge> : <Badge>Offline</Badge>}
          {data.banned && <Badge tone="error">Banned</Badge>}
        </div>
        <dl className="kv">
          <dt>Platform ID</dt>
          <dd className="mono">{userId}</dd>
          {player && (
            <>
              <dt>Level</dt>
              <dd>{player.level ?? '—'}</dd>
              <dt>Guild</dt>
              <dd>{player.guild ?? '—'}</dd>
              <dt>First seen</dt>
              <dd>{formatDateTime(player.firstSeenAt)}</dd>
              <dt>Last seen</dt>
              <dd>{formatDateTime(player.lastSeenAt)}</dd>
            </>
          )}
        </dl>
        {!player && <Alert tone="info">PalOps hasn’t seen this player online yet.</Alert>}

        <div className="button-row">
          {can('players.kick') && player?.online && (
            <Button variant="secondary" onClick={() => setAction('kick')}>
              Kick
            </Button>
          )}
          {can('players.ban') &&
            (data.banned ? (
              <Button variant="secondary" onClick={() => setAction('unban')}>
                Unban
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setAction('ban')}>
                Ban
              </Button>
            ))}
        </div>

        <h3>History and notes</h3>
        {can('players.note') && (
          <div className="inline-row">
            <Input
              aria-label="Add a staff note"
              placeholder="Add a staff note…"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && note.trim() && void addNote()}
            />
            <Button onClick={addNote} loading={saving} disabled={!note.trim()}>
              Add
            </Button>
          </div>
        )}
        {data.history.length === 0 ? (
          <EmptyState title="No history yet" />
        ) : (
          <ul className="history">
            {data.history.map((h) => (
              <li key={h.id}>
                <Badge tone={ACTION_BADGE[h.action]}>{h.action}</Badge>
                <span>{h.reason ?? <span className="muted">No reason given</span>}</span>
                <span className="muted small">
                  {h.actorUsername ?? 'unknown'} · {formatDateTime(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <Modal open title={name} onClose={onClose}>
        {body}
      </Modal>
      <ModerationDialog
        action={action}
        userId={userId}
        name={name}
        onClose={() => {
          setAction(null);
          void reload();
        }}
      />
    </>
  );
}
