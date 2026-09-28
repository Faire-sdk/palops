import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Loading } from './components/common';
import { theme } from './theme';

// Two apps in one build: the public server website at / and the staff panel at
// /panel. Each is its own chunk, so website visitors never download the panel.
const isPanel = window.location.pathname === '/panel' || window.location.pathname.startsWith('/panel/');
const App = isPanel ? lazy(() => import('./panel/PanelApp')) : lazy(() => import('./site/SiteApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      <Suspense fallback={<Loading />}>
        <App />
      </Suspense>
    </ThemeProvider>
  </StrictMode>,
);
