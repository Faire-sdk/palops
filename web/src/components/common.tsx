import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type SvgIcon from '@mui/material/SvgIcon';
import type { ReactNode } from 'react';
import type { ServerState } from '../api/types';

export type IconComponent = typeof SvgIcon;

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: { sm: 'flex-end' } }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 26, sm: 32 } }}>
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }} useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

/** A card with a title row (and optional actions) above its content. Fills its Grid cell so rows line up. */
export function Section({ title, action, children, disablePadding, sx }: { title?: ReactNode; action?: ReactNode; children: ReactNode; disablePadding?: boolean; sx?: object }) {
  return (
    <Card sx={{ '.MuiGrid-root > &': { height: '100%' }, ...sx }}>
      {(title || action) && (
        <CardHeader
          title={title}
          action={action}
          slotProps={{ title: { variant: 'h6', component: 'h2', sx: { fontSize: 17 } }, action: { sx: { m: 0, alignSelf: 'center' } } }}
          sx={{ borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', gap: 1 }}
        />
      )}
      {disablePadding ? children : <CardContent>{children}</CardContent>}
    </Card>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Stack spacing={2} sx={{ py: 6, alignItems: 'center' }} role="status">
      <CircularProgress size={32} />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export function EmptyState({ title, children, icon: Icon = InboxOutlinedIcon }: { title: string; children?: ReactNode; icon?: IconComponent }) {
  return (
    <Stack spacing={1} sx={{ py: 5, px: 2, alignItems: 'center', textAlign: 'center' }}>
      <Icon sx={{ fontSize: 40, color: 'text.disabled' }} />
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {children && <Typography color="text.secondary">{children}</Typography>}
    </Stack>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Stack spacing={1} sx={{ py: 5, px: 2, alignItems: 'center', textAlign: 'center' }} role="alert">
      <ErrorOutlineOutlinedIcon color="error" sx={{ fontSize: 40 }} />
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        Couldn’t load this
      </Typography>
      <Typography color="text.secondary">{error.message}</Typography>
      {onRetry && (
        <Button startIcon={<RefreshIcon />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </Stack>
  );
}

/** Label/value pairs in two columns. */
export function KeyValue({ items }: { items: Array<[string, ReactNode] | false | null | undefined> }) {
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 1.25, m: 0 }}>
      {items.filter(Boolean).map((item) => {
        const [label, value] = item as [string, ReactNode];
        return (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" color="text.secondary">
              {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {value}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {label}
      </Typography>
      <Typography variant="h5" component="div">
        {value}
      </Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export const Mono = ({ children, muted }: { children: ReactNode; muted?: boolean }) => (
  <Box component="span" sx={{ fontFamily: 'ui-monospace, "Roboto Mono", Menlo, monospace', fontSize: '0.85em', color: muted ? 'text.secondary' : undefined }}>
    {children}
  </Box>
);

const STATES: Record<ServerState, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  online: { label: 'Online', color: 'success' },
  offline: { label: 'Offline', color: 'error' },
  error: { label: 'Error', color: 'warning' },
  unconfigured: { label: 'Not configured', color: 'default' },
};

export function ServerStateChip({ state }: { state: ServerState | undefined }) {
  const s = state ? STATES[state] : { label: 'Unknown', color: 'default' as const };
  return <Chip label={s.label} color={s.color} variant="outlined" icon={<Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'currentColor', ml: '8px !important' }} />} />;
}
