import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { PalBanStatus, PalDefenderStatus } from '../api/types';
import { useApi } from '../hooks/useApi';
import { Loading, Section } from './common';
import { PalBanSettingsTab } from './PalBan';
import { PalDefenderSettingsTab } from './PalDefenderSettings';

/**
 * Optional integrations, off until an owner switches them on. An integration is
 * only named elsewhere in the panel once it's active; this is where an owner
 * finds and sets one up.
 */
export function IntegrationsSettingsTab() {
  const pd = useApi<PalDefenderStatus>('/paldefender/status');
  const pb = useApi<PalBanStatus>('/palban/status');
  const [open, setOpen] = useState<Set<string>>(new Set());
  if ((pd.loading && !pd.data) || (pb.loading && !pb.data)) return <Loading />;

  const items = [
    { id: 'paldefender', name: 'PalDefender', about: 'The anticheat plugin for Windows servers: bans, player inventories and pals, and more.', active: !!pd.data?.enabled, Form: PalDefenderSettingsTab },
    { id: 'palban', name: 'PalBan Network', about: 'A shared banlist that shares information about cheaters, with proof, between servers.', active: !!pb.data?.enabled, Form: PalBanSettingsTab },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Optional integrations. Each one is off until you switch it on here, and PalOps works fully without them.
      </Typography>
      {items.map((i) =>
        i.active || open.has(i.id) ? (
          <i.Form key={i.id} />
        ) : (
          <Section key={i.id} title={i.name}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">
                {i.about}
              </Typography>
              <Button variant="outlined" onClick={() => setOpen(new Set([...open, i.id]))} sx={{ flexShrink: 0 }}>
                Set up
              </Button>
            </Stack>
          </Section>
        ),
      )}
    </Stack>
  );
}
