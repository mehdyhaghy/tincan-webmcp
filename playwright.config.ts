import { defineConfig, devices } from "@playwright/test";

const bun = process.env.npm_execpath ?? "bun";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${bun} run build && env PORT=4173 ${bun} run start`,
    url: "http://127.0.0.1:4173/api/subscription",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
