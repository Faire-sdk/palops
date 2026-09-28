import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

export function PlayerName({ name, userId, onOpen }: { name: string; userId: string; onOpen: (userId: string) => void }) {
  return (
    <Link component="button" underline="hover" onClick={() => onOpen(userId)} sx={{ fontWeight: 600, textAlign: 'left' }}>
      {name}
    </Link>
  );
}

/** Downloads a CSV from the API. The session cookie authorises it; the server names the file. */
export function ExportButton({ path, label = 'Export CSV' }: { path: string; label?: string }) {
  return (
    <Button component="a" href={`/api/v1${path}`} download size="small" variant="outlined" startIcon={<DownloadOutlinedIcon />}>
      {label}
    </Button>
  );
}
