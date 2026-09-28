import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Keep the browser's Host header: the API checks Origin against it on
    // state-changing requests, and Discord redirects come back to this address.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
});
