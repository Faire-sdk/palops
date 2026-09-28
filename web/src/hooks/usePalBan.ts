import type { PalBanStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useApi } from './useApi';

/** Whether the optional PalBan Network integration is switched on. False until an owner enables it. */
export function usePalBan(): boolean {
  const { can } = useAuth();
  const { data } = useApi<PalBanStatus>('/palban/status', { enabled: can('players.view') });
  return !!data?.enabled;
}
