import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Permission, ServerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { discordAvatarUrl } from '../auth/discord';
import { useApi } from '../hooks/useApi';
import { usePalDefender } from '../hooks/usePalDefender';
import { Brand } from './Brand';
import { ServerStateChip, type IconComponent } from './common';

const DRAWER_WIDTH = 248;

const NAV: Array<{ to: string; label: string; icon: IconComponent; permission?: Permission; /** Only shown when the optional PalDefender integration is on. */ paldefender?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: DashboardOutlinedIcon, permission: 'server.view' },
  { to: '/players', label: 'Players', icon: PeopleOutlinedIcon, permission: 'players.view' },
  { to: '/bans', label: 'Bans', icon: GavelOutlinedIcon, permission: 'players.view' },
  { to: '/world', label: 'World', icon: MapOutlinedIcon, permission: 'players.view' },
  { to: '/paldefender', label: 'PalDefender', icon: ShieldOutlinedIcon, permission: 'world.view', paldefender: true },
  { to: '/console', label: 'Console', icon: TerminalIcon, permission: 'console.view' },
  { to: '/server', label: 'Server', icon: DnsOutlinedIcon, permission: 'server.control' },
  { to: '/configuration', label: 'Configuration', icon: TuneIcon, permission: 'config.view' },
  { to: '/logs', label: 'Logs', icon: DescriptionOutlinedIcon, permission: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: SettingsOutlinedIcon },
];

/** The panel's frame: navigation drawer, top app bar and the current page. */
export function Layout() {
  const { session, can, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: status } = useApi<ServerStatus>('/server/status', { pollMs: 15000 });
  const paldefender = usePalDefender();
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));
  const user = session?.user;
  const avatar = user?.discord ? discordAvatarUrl(user.discord) : null;

  const signOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const nav = (
    <>
      <Toolbar>
        <Brand />
      </Toolbar>
      <List sx={{ px: 1.5 }}>
        {NAV.filter((n) => (!n.permission || can(n.permission)) && (!n.paldefender || paldefender)).map((n) => (
          <ListItemButton
            key={n.to}
            component={NavLink}
            to={n.to}
            end={n.to === '/'}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 999,
              mb: 0.5,
              '&.active': { bgcolor: 'action.selected', color: 'primary.main', '& .MuiListItemIcon-root': { color: 'primary.main' } },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <n.icon />
            </ListItemIcon>
            <ListItemText primary={n.label} />
          </ListItemButton>
        ))}
      </List>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        color="inherit"
        sx={{ width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, ml: { md: `${DRAWER_WIDTH}px` }, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ display: { md: 'none' } }} aria-label="Open navigation">
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" component="div" noWrap sx={{ flexGrow: 1, fontSize: 18 }}>
            {current?.label}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography color="text.secondary" noWrap sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 220 }}>
              {status?.info?.name ?? status?.connection?.name ?? 'Server'}
            </Typography>
            <ServerStateChip state={status?.state} />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 1 }}>
            <Avatar src={avatar ?? undefined} sx={{ width: 32, height: 32, fontSize: 15 }}>
              {user?.username.slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {user?.username}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.role}
              </Typography>
            </Box>
            <Tooltip title="Sign out">
              <IconButton onClick={signOut} aria-label="Sign out">
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          {nav}
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
          {nav}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, sm: 3 }, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
