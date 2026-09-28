import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Loading } from './components/ui';
import './styles.css';

// Two apps in one build: the public server website at / and the staff panel at
// /panel. Each is its own chunk, so website visitors never download the panel.
const isPanel = window.location.pathname === '/panel' || window.location.pathname.startsWith('/panel/');
const App = isPanel ? lazy(() => import('./panel/PanelApp')) : lazy(() => import('./site/SiteApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Loading />}>
      <App />
    </Suspense>
  </StrictMode>,
);
