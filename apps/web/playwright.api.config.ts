import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: '**/api.e2e.ts', workers: 1, timeout: 90000,
  expect: { timeout: 15000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
  webServer: [
    { command: 'node ../api/scripts/e2e-server.cjs', url: 'http://127.0.0.1:3010/api/health/live',
      env: { NODE_ENV: 'test' }, reuseExistingServer: false, timeout: 120000 },
    { command: 'pnpm dev --host 127.0.0.1 --port 4174 --strictPort', url: 'http://127.0.0.1:4174',
      env: { VITE_DATA_SOURCE: 'api', API_PROXY_TARGET: 'http://127.0.0.1:3010' }, reuseExistingServer: false },
  ],
})
