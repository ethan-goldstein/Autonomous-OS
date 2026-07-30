import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy API + the SSE event stream to the orchestrator during dev.
// API_TARGET lets you point a dev front-end at a throwaway orchestrator on
// another port, so you can test server changes without restarting the live
// service that normally holds 8787.
const target = process.env.API_TARGET || 'http://localhost:8787';

export default defineConfig({
  // GitHub Pages serves the demo from /Autonomous-OS/; the real app is served
  // from the Node server at the root.
  base: process.env.VITE_DEMO === '1' ? '/Autonomous-OS/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/events': { target, changeOrigin: true },
    },
  },
});
