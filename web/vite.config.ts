import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the relay runs on HTTP_PORT (default 8080, `npm run dev -w server`);
// Vite proxies the relay's endpoints so the dashboard behaves exactly as when
// the relay serves it.
const RELAY = process.env.RELAY_URL || `http://localhost:${process.env.HTTP_PORT || 8080}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@proto': fileURLToPath(new URL('../server/src/protocol', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: RELAY.replace(/^http/, 'ws'), ws: true },
      '/ingest': RELAY,
      '/exec': RELAY,
      '/clear': RELAY,
      '/api': RELAY,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
