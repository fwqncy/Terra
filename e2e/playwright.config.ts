import { defineConfig, devices } from '@playwright/test';

const API = 'http://localhost:5080';
const WEB = 'http://localhost:4310';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'dotnet run --project ../api/Terra.Api --no-launch-profile --urls http://localhost:5080',
      url: `${API}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ConnectionStrings__Sqlite: 'Data Source=e2e.db',
        Logistics__WarmupHours: '24',
        RateLimit__WritesPerMinute: '5000',
      },
    },
    {
      command: `node serve.mjs ../web/dist/web/browser 4310 ${API}`,
      url: WEB,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
