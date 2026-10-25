const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const repoRoot = path.resolve(__dirname, '../..');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'ci-artifacts/browser-results.json' }],
    ['junit', { outputFile: 'ci-artifacts/browser-junit.xml' }],
  ],
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    cwd: repoRoot,
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/tests/browser/fixtures/terminal.html',
    timeout: 60000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
