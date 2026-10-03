import CloseIcon from '@mui/icons-material/Close';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { useMemo, useState, type ReactNode } from 'react';
import type { DiscordGuild, DiscordRole, WebsiteAccount } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { discordAvatarUrl, discordBannerUrl, discordGuildIconUrl } from '../auth/discord';
import { formatDateTime } from '../format';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Mono } from './common';
import { ConnectionChips, MemberChip } from './DiscordProfile';
import { PlayerName } from './PlayerBits';

interface AccountDetail {
  account: WebsiteAccount;
  communityServerId: string | null;
  roles: DiscordRole[];
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const count = (n: number) => n.toLocaleString();

/** A website user's Discord profile: picture, banner, character, community server roles, connections and servers. */
export function UserProfileDialog({ accountId, onClose, onOpenPlayer }: { accountId: number | null; onClose: () => void; onOpenPlayer: (userId: string) => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { data, error, loading, reload } = useApi<AccountDetail>(`/accounts/${accountId ?? 0}`, { enabled: accountId !== null });
  const detail = data?.account.id === accountId ? data : undefined;

  return (
    <Dialog open={accountId !== null} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen} scroll="body">
      <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, bgcolor: 'rgba(0,0,0,0.35)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' } }}>
        <CloseIcon />
      </IconButton>
      {!detail ? (
        <DialogContent>{loading || !error ? <Loading /> : <ErrorState error={error} onRetry={reload} />}</DialogContent>
      ) : (
        <ProfileBody detail={detail} onOpenPlayer={onOpenPlayer} />
      )}
    </Dialog>
  );
}

function ProfileBody({ detail, onOpenPlayer }: { detail: AccountDetail; onOpenPlayer: (userId: string) => void }) {
  const { can } = useAuth();
  const { account: a, roles, communityServerId } = detail;
  const d = a.discord;
  const profile = a.profile;
  const name = d.globalName ?? d.username ?? 'Unknown';
  const member = profile?.communityMember;

  return (
    <>
      <Box
        sx={{
          height: 120,
          bgcolor: d.accentColor !== null ? hex(d.accentColor) : 'primary.main',
          backgroundImage: d.banner ? `url(${discordBannerUrl(d.id, d.banner)})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <Box sx={{ px: 3, mt: -6 }}>
        <Avatar src={discordAvatarUrl(d, 128) ?? undefined} sx={{ width: 96, height: 96, border: 6, borderColor: 'background.paper', fontSize: 36 }}>
          {name.slice(0, 1).toUpperCase()}
        </Avatar>
        <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
          {name}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          {d.username && <Typography color="text.secondary">@{d.username}</Typography>}
          <Mono muted>{d.id}</Mono>
        </Stack>
      </Box>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2.5} divider={<Divider flexItem />}>
          <Block title="Character">
            {a.player ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                <PlayerName name={a.player.name ?? a.player.userId} userId={a.player.userId} onOpen={onOpenPlayer} />
                {a.player.level !== null && <Typography variant="body2" color="text.secondary">Level {a.player.level}</Typography>}
                <Chip
                  size="small"
                  variant="outlined"
                  color={a.verified ? 'success' : 'warning'}
                  label={a.verified ? `Verified${a.verifiedBy ? ` · ${a.verifiedBy === 'code' ? 'in-game code' : a.verifiedBy}` : ''}` : a.requestedAt ? 'Verification requested' : 'Claimed'}
                />
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No character linked yet.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              First signed in {formatDateTime(a.createdAt)}
              {a.lastLoginAt ? ` · last sign-in ${formatDateTime(a.lastLoginAt)}` : ''}
            </Typography>
          </Block>

          {communityServerId && (
            <Block title="Your Discord server">
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                <MemberChip profile={profile} />
                {member && member.joinedAt && (
                  <Typography variant="body2" color="text.secondary">
                    Joined {formatDateTime(member.joinedAt)}
                  </Typography>
                )}
              </Stack>
              {roles.length > 0 && (
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.25 }}>
                  {roles.map((r) => (
                    <Chip
                      key={r.id}
                      size="small"
                      variant="outlined"
                      label={r.name ?? `Role ${r.id}`}
                      icon={<Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: r.color ? hex(r.color) : 'text.disabled', ml: '8px !important' }} />}
                    />
                  ))}
                </Stack>
              )}
            </Block>
          )}

          <Block title="Connections">
            <ConnectionChips profile={profile} />
          </Block>

          {profile?.email && (
            <Block title="Email">
              <Typography variant="body2">
                {profile.email}
                {profile.emailVerified === false ? ' (not verified)' : ''}
              </Typography>
            </Block>
          )}

          {profile?.guilds ? (
            <Servers guilds={profile.guilds} communityServerId={communityServerId} />
          ) : (
            <Block title="Servers">
              <Typography variant="body2" color="text.secondary">
                {!can('accounts.private') ? 'Only admins and owners can see which servers someone is in.' : 'Shown after their next website sign-in.'}
              </Typography>
            </Block>
          )}
        </Stack>
        {profile && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>
            Servers and connections are from their last website sign-in, {formatDateTime(profile.updatedAt)}. Name and picture are looked up on Discord.
          </Typography>
        )}
      </DialogContent>
    </>
  );
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

/** Their Discord servers: the community server first, then ones they own or run, then the biggest. */
function Servers({ guilds, communityServerId }: { guilds: DiscordGuild[]; communityServerId: string | null }) {
  const [q, setQ] = useState('');
  const sorted = useMemo(() => {
    const rank = (g: DiscordGuild) => (g.id === communityServerId ? 0 : g.owner ? 1 : g.admin ? 2 : 3);
    return guilds.slice().sort((a, b) => rank(a) - rank(b) || (b.memberCount ?? 0) - (a.memberCount ?? 0) || a.name.localeCompare(b.name));
  }, [guilds, communityServerId]);
  const shown = q ? sorted.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())) : sorted;

  return (
    <Block
      title={`Servers (${guilds.length})`}
      action={guilds.length > 8 && <TextField size="small" placeholder="Filter servers" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 180 }} />}
    >
      {guilds.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Not in any servers.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ maxHeight: 360, overflowY: 'auto', mx: -1 }}>
          {shown.map((g) => (
            <ListItem key={g.id} sx={{ borderRadius: 1, ...(g.id === communityServerId ? { bgcolor: 'action.selected' } : {}) }}>
              <ListItemAvatar sx={{ minWidth: 52 }}>
                <Avatar variant="rounded" src={g.icon ? discordGuildIconUrl(g.id, g.icon) : undefined} sx={{ width: 40, height: 40, fontSize: 15 }}>
                  {initials(g.name)}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {g.name}
                    </Typography>
                    {g.id === communityServerId && <Chip size="small" color="primary" label="Your server" />}
                    {g.owner ? <Chip size="small" icon={<StarRoundedIcon />} color="warning" variant="outlined" label="Owner" /> : g.admin && <Chip size="small" variant="outlined" label="Admin" />}
                  </Stack>
                }
                secondary={g.memberCount != null ? `${count(g.memberCount)} members${g.onlineCount != null ? ` · ${count(g.onlineCount)} online` : ''}` : null}
              />
            </ListItem>
          ))}
          {shown.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
              No servers match.
            </Typography>
          )}
        </List>
      )}
    </Block>
  );
}

/** Discord's own fallback for servers without an icon: the first letter of each word. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join('');
