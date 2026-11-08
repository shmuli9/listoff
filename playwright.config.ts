import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // tests share one mock backend
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', hasTouch: true },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: [
    { command: 'node e2e/mock/server.mjs', port: 8787, reuseExistingServer: true },
    { command: 'npx cross-env VITE_API=http://localhost:8787 npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: false, timeout: 120000 },
  ],
});
