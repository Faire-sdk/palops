import { Navigate, Route, Routes } from 'react-router-dom';
import type { Permission } from './api/types';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { EmptyState, Loading } from './components/ui';
import { LoginPage, ResetPasswordPage, SetupPage } from './pages/AuthPages';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { LogsPage } from './pages/LogsPage';
import { PlayersPage } from './pages/PlayersPage';
import { SettingsPage } from './pages/SettingsPage';

function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <EmptyState icon="alert" title="You don’t have access to this page" />;
}

export function App() {
  const { session, loading, setupRequired } = useAuth();

  if (loading) return <Loading label="Starting PalOps…" />;

  if (!session) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={setupRequired ? <SetupPage /> : <LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Guard permission="server.view"><DashboardPage /></Guard>} />
        <Route path="players" element={<Guard permission="players.view"><PlayersPage /></Guard>} />
        <Route
          path="console"
          element={<Guard permission="console.view"><ComingSoonPage title="Console" icon="console" description="Live server output and command execution are next on the roadmap." /></Guard>}
        />
        <Route
          path="server"
          element={<Guard permission="server.control"><ComingSoonPage title="Server" icon="server" description="Start, stop and restart controls will live here." /></Guard>}
        />
        <Route
          path="configuration"
          element={<Guard permission="config.view"><ComingSoonPage title="Configuration" icon="config" description="Editing PalWorldSettings.ini with validation and rollback is coming." /></Guard>}
        />
        <Route path="logs" element={<Guard permission="audit.view"><LogsPage /></Guard>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
