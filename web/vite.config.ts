import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Emit every asset (including tiny font subsets) as a file: the panel's CSP
  // doesn't allow data: fonts.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 5173,
    // Keep the browser's Host header: the API checks Origin against it on
    // state-changing requests, and Discord redirects come back to this address.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
});
