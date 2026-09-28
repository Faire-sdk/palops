import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const REFRESH_EVENT = 'palops:refresh';

/** Ask every mounted useApi hook to refetch (e.g. after saving settings). */
export const refreshAll = () => window.dispatchEvent(new Event(REFRESH_EVENT));

interface Options {
  /** Refetch on an interval (ms). Real-time push will replace this later. */
  pollMs?: number;
  enabled?: boolean;
}

export function useApi<T>(path: string, { pollMs, enabled = true }: Options = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(enabled);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    try {
      const result = await api.get<T>(path);
      if (current.current === path) {
        setData(result);
        setError(undefined);
      }
    } catch (err) {
      if (current.current === path) setError(err as Error);
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void load();
    const onRefresh = () => void load();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    const timer = pollMs
      ? setInterval(() => {
          if (document.visibilityState === 'visible') void load();
        }, pollMs)
      : undefined;
    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
      clearInterval(timer);
    };
  }, [load, pollMs, enabled]);

  return { data, error, loading, reload: load };
}
