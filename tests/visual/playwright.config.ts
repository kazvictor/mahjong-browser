import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Playwright configuration for Mahjong browser game visual QA
 * 
 * Run tests: npm run test:visual
 * Run headed: npm run test:visual:headed
 * Show report: npm run test:visual:report
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false, // Run sequentially for visual tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for visual consistency
  reporter: [
    ['html', { outputFolder: resolve(__dirname, 'playwright-report') }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
  outputDir: resolve(__dirname, 'test-results'),
});
