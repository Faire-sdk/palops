import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, onUnauthorized } from '../api/client';
import type { Permission, SessionInfo } from '../api/types';

interface AuthState {
  session: SessionInfo | null;
  loading: boolean;
  setupRequired: boolean;
  can: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<void>;
  completeSetup: (setupToken: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setSession(await api.get<SessionInfo>('/auth/me'));
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
        const setup = await api.get<{ setupRequired: boolean }>('/auth/setup').catch(() => ({ setupRequired: false }));
        setSetupRequired(setup.setupRequired);
      } finally {
        setLoading(false);
      }
    })();
    return onUnauthorized(() => setSession(null));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setSession(await api.post<SessionInfo>('/auth/login', { username, password }));
  }, []);

  const completeSetup = useCallback(async (setupToken: string, username: string, password: string) => {
    setSession(await api.post<SessionInfo>('/auth/setup', { setupToken, username, password }));
    setSetupRequired(false);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      setupRequired,
      can: (p) => !!session?.permissions.includes(p),
      login,
      completeSetup,
      logout,
    }),
    [session, loading, setupRequired, login, completeSetup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
