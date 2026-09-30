import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// e2e tests run a separate backend on another port (see playwright.config.ts).
const api = `http://127.0.0.1:${process.env.API_PORT ?? 8000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev the SPA and the API share one origin, so session cookies just work.
    proxy: {
      '/api': api,
      '/media': api,
    },
  },
})
