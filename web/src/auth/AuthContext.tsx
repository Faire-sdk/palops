import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, onUnauthorized } from '../api/client';
import type { AuthOptions, Permission, SessionInfo } from '../api/types';

type DiscordIntent = 'login' | 'setup' | 'link';

interface AuthState {
  session: SessionInfo | null;
  loading: boolean;
  options: AuthOptions;
  can: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<void>;
  completeSetup: (setupToken: string, username: string, password: string) => Promise<void>;
  /** Sends the browser to Discord; it comes back through the server's callback. */
  startDiscord: (intent: DiscordIntent, setupToken?: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEFAULT_OPTIONS: AuthOptions = { setupRequired: false, providers: { discord: false, password: true } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [options, setOptions] = useState<AuthOptions>(DEFAULT_OPTIONS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get<SessionInfo>('/auth/me'));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      setSession(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [opts] = await Promise.all([api.get<AuthOptions>('/auth/options').catch(() => DEFAULT_OPTIONS), refresh()]);
      setOptions(opts);
      setLoading(false);
    })();
    return onUnauthorized(() => setSession(null));
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    setSession(await api.post<SessionInfo>('/auth/login', { username, password }));
  }, []);

  const completeSetup = useCallback(async (setupToken: string, username: string, password: string) => {
    setSession(await api.post<SessionInfo>('/auth/setup', { setupToken, username, password }));
    setOptions((o) => ({ ...o, setupRequired: false }));
  }, []);

  const startDiscord = useCallback(async (intent: DiscordIntent, setupToken?: string) => {
    const { url } = await api.post<{ url: string }>('/auth/discord/authorize', { intent, setupToken });
    window.location.assign(url);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      options,
      can: (p) => !!session?.permissions.includes(p),
      login,
      completeSetup,
      startDiscord,
      refresh,
      logout,
    }),
    [session, loading, options, login, completeSetup, startDiscord, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
