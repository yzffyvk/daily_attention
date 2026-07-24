import { defineConfig, devices } from "@playwright/test";

const flowTests = ["**/auth.spec.ts", "**/checkins.spec.ts"];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/run-e2e-server.mjs",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "flows-desktop",
      testMatch: flowTests,
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "desktop",
      testMatch: "**/responsive.spec.ts",
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet",
      testMatch: "**/responsive.spec.ts",
      use: {
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "mobile",
      testMatch: "**/responsive.spec.ts",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
