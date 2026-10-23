import BrightnessAutoOutlinedIcon from '@mui/icons-material/BrightnessAutoOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useColorScheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { useState } from 'react';

const MODES = [
  { mode: 'light', label: 'Light', icon: LightModeOutlinedIcon },
  { mode: 'dark', label: 'Dark', icon: DarkModeOutlinedIcon },
  { mode: 'system', label: 'Match my device', icon: BrightnessAutoOutlinedIcon },
] as const;

/** Light, dark or the device's setting. MUI remembers the choice in this browser. */
export function ThemeModeButton() {
  const { mode, setMode } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = MODES.find((m) => m.mode === (mode ?? 'system')) ?? MODES[2];

  return (
    <>
      <Tooltip title="Theme">
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={`Theme: ${current.label}`}
          aria-haspopup="menu"
          aria-expanded={anchor ? 'true' : undefined}
        >
          <current.icon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {MODES.map((m) => (
          <MenuItem
            key={m.mode}
            selected={m.mode === current.mode}
            onClick={() => {
              setMode(m.mode);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <m.icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{m.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
