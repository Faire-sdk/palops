import type { PalDefenderStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useApi } from './useApi';

/** Whether the optional PalDefender integration is switched on. False until an owner enables it. */
export function usePalDefender(): boolean {
  const { can } = useAuth();
  const { data } = useApi<PalDefenderStatus>('/paldefender/status', { enabled: can('players.view') });
  return !!data?.enabled;
}
