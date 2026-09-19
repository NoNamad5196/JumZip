import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const channel = process.platform === 'win32' ? 'msedge' : 'chromium';
const fixtureEnvironment = process.env.CI || !existsSync('.env.local')
  ? { VITE_SUPABASE_URL: 'https://jumzip-ui-fixture.supabase.co', VITE_SUPABASE_ANON_KEY: 'jumzip-public-fixture-key' }
  : undefined;
export default defineConfig({ testDir: './tests/e2e', outputDir: './test-results/playwright', fullyParallel: true, use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', channel }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }], webServer: { command: 'pnpm dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, env: fixtureEnvironment } });
