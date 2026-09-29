import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { IpBan, ModerationRecord, PalDefenderBan, PalDefenderResult, PalDefenderStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, Loading, Mono, PageHeader, Section } from '../components/common';
import { PalBanBans } from '../components/PalBan';
import { usePalDefender } from '../hooks/usePalDefender';
import { ExportButton, PlayerName } from '../components/PlayerBits';
import { DataTable } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModerationDialog, PlayerProfileDialog, warnIfPalDefenderFailed } from '../components/PlayerActions';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../format';
import { refreshAll, useApi } from '../hooks/useApi';

type Target = { action: 'kick' | 'ban' | 'unban'; userId: string; name: string; ip?: string | null };

/** Every ban in one place: players banned from the panel, banned IPs, and PalDefender's own list. */
export function BansPage() {
  const pd = usePalDefender();
  const [profile, setProfile] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  return (
    <>
      <PageHeader
        title="Bans"
        description={pd ? 'Players and IPs banned from the panel, and PalDefender’s own list.' : 'Players and IPs banned from the panel.'}
        actions={<ExportButton path="/players/bans/export.csv" />}
      />
      <Stack spacing={2}>
        <PalBanBans onOpen={setProfile} />
        <Bans onOpen={setProfile} onAction={setTarget} />
      </Stack>
      <PlayerProfileDialog userId={profile} onClose={() => setProfile(null)} onOpen={setProfile} />
      <ModerationDialog action={target?.action ?? null} userId={target?.userId ?? ''} name={target?.name ?? ''} ip={target?.ip} onClose={() => setTarget(null)} />
    </>
  );
}

function Bans({ onOpen, onAction }: { onOpen: (userId: string) => void; onAction: (t: Target) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ bans: ModerationRecord[]; ipBans: IpBan[] }>('/players/bans');
  const [userId, setUserId] = useState('');
  const [ip, setIp] = useState('');
  const [ipReason, setIpReason] = useState('');
  const [busy, setBusy] = useState(false);

  const banIp = async () => {
    setBusy(true);
    try {
      const { ipBan, paldefender } = await api.post<{ ipBan: IpBan; paldefender?: PalDefenderResult }>('/players/ip-bans', { ip, reason: ipReason });
      notify(`${ipBan.ip} is banned`, 'success');
      warnIfPalDefenderFailed(notify, paldefender);
      setIp('');
      setIpReason('');
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const liftIpBan = async (ban: IpBan) => {
    try {
      const res = await api.delete<{ paldefender?: PalDefenderResult }>(`/players/ip-bans/${ban.id}`);
      notify(`${ban.ip} is no longer banned`, 'success');
      warnIfPalDefenderFailed(notify, res?.paldefender);
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <DataTable
        rows={data?.bans ?? []}
        rowKey={(b) => b.id}
        empty={<EmptyState icon={PeopleOutlinedIcon} title="No bans from the panel" />}
        columns={[
          { key: 'name', header: 'Player', render: (b) => <PlayerName name={b.playerName ?? b.playerUserId} userId={b.playerUserId} onOpen={onOpen} /> },
          { key: 'userId', header: 'Platform ID', render: (b) => <Mono>{b.playerUserId}</Mono> },
          { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
          { key: 'by', header: 'Banned by', render: (b) => b.actorUsername ?? '—' },
          { key: 'at', header: 'When', nowrap: true, render: (b) => formatDateTime(b.createdAt) },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (b) =>
              can('players.ban') && (
                <Button size="small" variant="outlined" onClick={() => onAction({ action: 'unban', userId: b.playerUserId, name: b.playerName ?? b.playerUserId })}>
                  Unban
                </Button>
              ),
          },
        ]}
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Section title={data ? `Bans (${data.bans.length})` : 'Bans'} disablePadding>
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
          Only bans made from PalOps are listed. The REST API can’t read bans made in-game or through a shared ban list.
        </Typography>
        {body}
      </Section>
      {can('players.ip') && (
        <Section title={data ? `IP bans (${data.ipBans.length})` : 'IP bans'} disablePadding>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
            The game can only ban platform IDs, so PalOps enforces these itself: anyone who connects from a banned IP is kicked within about 20 seconds.
          </Typography>
          {data && (
            <DataTable
              rows={data.ipBans}
              rowKey={(b) => b.id}
              empty={<EmptyState title="No IP bans" />}
              columns={[
                { key: 'ip', header: 'IP', render: (b) => <Mono>{b.ip}</Mono> },
                {
                  key: 'player',
                  header: 'From player',
                  render: (b) => (b.playerUserId ? <PlayerName name={b.playerName ?? b.playerUserId} userId={b.playerUserId} onOpen={onOpen} /> : '—'),
                },
                { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
                { key: 'by', header: 'Banned by', render: (b) => b.actorUsername ?? '—' },
                { key: 'at', header: 'When', nowrap: true, render: (b) => formatDateTime(b.createdAt) },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (b) =>
                    can('players.ban') && (
                      <Button size="small" variant="outlined" onClick={() => void liftIpBan(b)}>
                        Lift
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </Section>
      )}
      {can('players.ip') && <PalDefenderBans onOpen={onOpen} />}
      {can('players.ban') && can('players.ip') && (
        <Section title="Ban an IP">
          <Stack
            component="form"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'flex-start' } }}
            onSubmit={(e) => {
              e.preventDefault();
              if (ip.trim()) void banIp();
            }}
          >
            <TextField
              label="IP or range"
              helperText="e.g. 203.0.113.7, or 203.0.113.0/24 for a whole range"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              required
              slotProps={{ htmlInput: { maxLength: 64 } }}
              sx={{ maxWidth: { sm: 300 } }}
            />
            <TextField label="Reason" placeholder="Optional" value={ipReason} onChange={(e) => setIpReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} sx={{ maxWidth: { sm: 300 } }} />
            <Button variant="contained" color="error" type="submit" loading={busy} sx={{ height: 40 }}>
              Ban
            </Button>
          </Stack>
        </Section>
      )}
      {can('players.ban') && (
        <Section title="Ban by platform ID">
          <Stack
            component="form"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'flex-start' } }}
            onSubmit={(e) => {
              e.preventDefault();
              if (userId.trim()) onAction({ action: 'ban', userId: userId.trim(), name: userId.trim() });
            }}
          >
            <TextField
              label="Platform ID"
              helperText="For someone who isn’t online, e.g. steam_76561198000000000"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              slotProps={{ htmlInput: { pattern: '[A-Za-z0-9_.:\\-]{1,80}' } }}
              sx={{ maxWidth: { sm: 420 } }}
            />
            <Button variant="contained" color="error" type="submit" sx={{ height: 40 }}>
              Ban
            </Button>
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

/**
 * PalDefender's own ban list, when that optional integration is on. It includes
 * bans made in-game, by its anti-cheat and by other tools, which the official
 * REST API can't list.
 */
function PalDefenderBans({ onOpen }: { onOpen: (userId: string) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const { data: status } = useApi<PalDefenderStatus>('/paldefender/status');
  const enabled = !!status?.enabled;
  const { data, error, loading, reload } = useApi<{ bans: PalDefenderBan[] }>('/paldefender/banlist', { enabled });
  const [lift, setLift] = useState<PalDefenderBan | null>(null);

  if (!enabled) return null;

  let body;
  if (loading && !data) body = <Loading />;
  else if (error && !data) body = <ErrorState error={error} onRetry={reload} />;
  else {
    body = (
      <DataTable
        rows={data?.bans ?? []}
        rowKey={(b) => `${b.kind}:${b.id}`}
        empty={<EmptyState icon={PeopleOutlinedIcon} title="No active bans in PalDefender" />}
        columns={[
          { key: 'kind', header: 'Type', render: (b) => <Chip label={b.kind === 'ip' ? 'IP' : 'Player'} variant="outlined" /> },
          { key: 'id', header: 'Who', render: (b) => (b.kind === 'user' ? <PlayerName name={b.id} userId={b.id} onOpen={onOpen} /> : <Mono>{b.id}</Mono>) },
          { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
          { key: 'by', header: 'Banned by', render: (b) => (b.bannedBy ? `${b.bannedBy}${b.bannedVia ? ` (${b.bannedVia})` : ''}` : (b.bannedVia ?? '—')) },
          { key: 'at', header: 'When', nowrap: true, render: (b) => (b.bannedAt ? formatDateTime(b.bannedAt) : '—') },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (b) =>
              can('players.ban') && (
                <Button size="small" variant="outlined" onClick={() => setLift(b)}>
                  Unban
                </Button>
              ),
          },
        ]}
      />
    );
  }

  return (
    <Section title={data ? `PalDefender ban list (${data.bans.length})` : 'PalDefender ban list'} disablePadding>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
        Straight from PalDefender, so it includes bans made in-game, by its anti-cheat and by other tools. Unbanning here only changes PalDefender’s list; to fully
        unban someone banned from PalOps, use Unban in the first list above.
      </Typography>
      {body}
      <ConfirmDialog
        open={!!lift}
        title={`Unban ${lift?.id ?? ''} in PalDefender?`}
        message={lift?.kind === 'ip' ? 'Accounts on this IP can connect again unless PalOps also bans it.' : 'They can connect again unless the game’s own ban list or a PalOps address ban still stops them.'}
        confirmLabel="Unban"
        onClose={() => setLift(null)}
        onConfirm={async () => {
          try {
            await api.post(lift!.kind === 'ip' ? '/paldefender/unbanip' : '/paldefender/unban', lift!.kind === 'ip' ? { ip: lift!.id } : { userId: lift!.id });
            notify(`${lift!.id} was unbanned in PalDefender`, 'success');
            reload();
          } catch (err) {
            notify(errorMessage(err), 'error');
          }
        }}
      />
    </Section>
  );
}

