import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev proxy: backend (src/webui/server.ts) listens on the port from
    // Config.webui.port (default 3000). Avoids CORS during development.
    proxy: {
      '/api': 'http://localhost:3000',
      // The session WebSocket channel (/ws) shares the backend port — proxy
      // upgrades so the client can use the native WebSocket API in dev.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
