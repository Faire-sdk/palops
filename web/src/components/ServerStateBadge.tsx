import type { ServerState } from '../api/types';
import { Badge } from './ui';

const STATES: Record<ServerState, { label: string; tone: 'success' | 'error' | 'warning' | 'neutral' }> = {
  online: { label: 'Online', tone: 'success' },
  offline: { label: 'Offline', tone: 'error' },
  error: { label: 'Error', tone: 'warning' },
  unconfigured: { label: 'Not configured', tone: 'neutral' },
};

export function ServerStateBadge({ state }: { state: ServerState | undefined }) {
  const s = state ? STATES[state] : { label: 'Unknown', tone: 'neutral' as const };
  return (
    <Badge tone={s.tone}>
      <span className="dot" /> {s.label}
    </Badge>
  );
}
