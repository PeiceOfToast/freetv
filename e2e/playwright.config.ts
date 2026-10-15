import { defineConfig, devices } from "@playwright/test";

const WEB = "http://127.0.0.1:4173";
const CI = !!process.env.CI;
// The Playwright-bundled Chromium needs --no-sandbox when run as root (typical in containers).
const launchArgs = process.getuid?.() === 0 || process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : [];

// Mobile runs the flows a phone user would hit. TV mode is a remote-control UI and only runs on desktop.
const MOBILE_SPECS = /(browse|watch|exports|pwa)\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./setup/global-setup.ts",
  globalTeardown: "./setup/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  use: {
    baseURL: WEB,
    trace: "on-first-retry",
    launchOptions: { args: launchArgs },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: launchArgs } },
    },
    {
      name: "mobile",
      testMatch: MOBILE_SPECS,
      use: { ...devices["Pixel 7"], launchOptions: { args: launchArgs } },
    },
  ],
});
