import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { lazy, StrictMode, Suspense, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cachedSiteAccent, SetPrimaryContext } from './accent';
import { Loading } from './components/common';
import { createPalOpsTheme, PALOPS_PRIMARY } from './theme';

// Two apps in one build: the public server website at / and the staff panel at
// /panel. Each is its own chunk, so website visitors never download the panel.
const isPanel = window.location.pathname === '/panel' || window.location.pathname.startsWith('/panel/');
const App = isPanel ? lazy(() => import('./panel/PanelApp')) : lazy(() => import('./site/SiteApp'));

/** The panel always uses PalOps colours; the public website can take the server's own. */
function Root() {
  const [primary, setPrimary] = useState(() => (isPanel ? PALOPS_PRIMARY : cachedSiteAccent()));
  const theme = useMemo(() => createPalOpsTheme(primary), [primary]);
  return (
    <SetPrimaryContext.Provider value={setPrimary}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        <Suspense fallback={<Loading />}>
          <App />
        </Suspense>
      </ThemeProvider>
    </SetPrimaryContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
