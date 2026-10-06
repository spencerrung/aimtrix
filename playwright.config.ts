import { defineConfig, devices } from '@playwright/test';

const browserSet = process.env.PLAYWRIGHT_BROWSER_SET;
const projects = browserSet === 'firefox'
  ? [{ name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] }, testMatch: /(?:image-reactions|browser-compat|first-use|signin-targets|shell|composition|mobile-layout|usability|responsive-layout|message-navigation|popover-viewport|dialog-viewport)\.spec\.ts/ }]
  : browserSet === 'webkit'
    ? [
      { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] }, testMatch: /(?:image-reactions|browser-compat|first-use|signin-targets|shell|composition|mobile-layout|usability|responsive-layout|message-navigation|popover-viewport|dialog-viewport)\.spec\.ts/ },
      { name: 'webkit-mobile', use: { ...devices['iPhone 13'] }, testMatch: /(?:image-reactions|browser-compat|first-use|signin-targets|shell|composition|mobile-layout|usability|responsive-layout|message-navigation|popover-viewport|dialog-viewport)\.spec\.ts/ },
    ]
    : [
      { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
      { name: 'mobile', use: { ...devices['Pixel 7'] } },
    ];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  projects,
  webServer: {
    command: process.env.PLAYWRIGHT_PREVIEW
      ? 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
