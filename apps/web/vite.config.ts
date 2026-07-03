import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind both IPv4 (127.0.0.1) and IPv6 (::1). Without this Vite binds ::1 only,
    // so browsers that resolve `localhost` to 127.0.0.1 get "connection refused".
    host: true,
    port: 5173,
    // Always use :5173 — fail loudly if it's taken rather than silently moving to
    // another port (which makes the bookmarked URL "refuse to connect").
    strictPort: true,
  },
  // libsodium ships a WASM/CJS build; let Vite pre-bundle it for the browser.
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
  },
});
