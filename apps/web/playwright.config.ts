import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: [
    {
      command: 'npm run dev:api',
      cwd: root,
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'npm run dev:web',
      cwd: root,
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
