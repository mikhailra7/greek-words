import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against a throw-away backend (port 8001, DB in data/e2e) and a dev
// frontend on 5174 that proxies to it. Run: `make e2e`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one shared DB; tests build on the admin created in global setup
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5174',
    storageState: 'e2e/.auth/admin.json',
    trace: 'retain-on-failure',
    locale: 'ru-RU',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'laptop',
      use: { viewport: { width: 1440, height: 900 } },
      testMatch: /trainers\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: './e2e/backend.sh',
      url: 'http://127.0.0.1:8001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'API_PORT=8001 npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
