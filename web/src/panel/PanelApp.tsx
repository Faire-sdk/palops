import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Permission } from '../api/types';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { ToastProvider } from '../components/Toast';
import { Layout } from '../components/Layout';
import { EmptyState, Loading } from '../components/ui';
import { LoginPage, ResetPasswordPage, SetupPage } from '../pages/AuthPages';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { ConfigurationPage } from '../pages/ConfigurationPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LogsPage } from '../pages/LogsPage';
import { PlayersPage } from '../pages/PlayersPage';
import { ServerPage } from '../pages/ServerPage';
import { SettingsPage } from '../pages/SettingsPage';

function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <EmptyState icon="alert" title="You don’t have access to this page" />;
}

function PanelRoutes() {
  const { session, loading, options } = useAuth();

  if (loading) return <Loading label="Starting PalOps…" />;

  if (!session) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={options.setupRequired ? <SetupPage /> : <LoginPage />} />
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
          element={<Guard permission="console.view"><ComingSoonPage title="Console" icon="console" description="The Palworld REST API has no console. Commands will come with RCON support or PalOps running on the game machine." /></Guard>}
        />
        <Route path="server" element={<Guard permission="server.control"><ServerPage /></Guard>} />
        <Route path="configuration" element={<Guard permission="config.view"><ConfigurationPage /></Guard>} />
        <Route path="logs" element={<Guard permission="audit.view"><LogsPage /></Guard>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** The staff panel, served under /panel. */
export default function PanelApp() {
  return (
    <BrowserRouter basename="/panel">
      <ToastProvider>
        <AuthProvider>
          <PanelRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
