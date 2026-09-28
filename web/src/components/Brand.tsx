import Avatar from '@mui/material/Avatar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** The PalOps mark and name. */
export function Brand({ size = 'md', name = 'PalOps' }: { size?: 'md' | 'lg'; name?: string }) {
  const box = size === 'lg' ? 40 : 32;
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Avatar variant="rounded" sx={{ width: box, height: box, bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700, fontSize: box * 0.5 }}>
        P
      </Avatar>
      <Typography variant={size === 'lg' ? 'h5' : 'h6'} component="span" noWrap sx={{ fontWeight: 700 }}>
        {name}
      </Typography>
    </Stack>
  );
}
