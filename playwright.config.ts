import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3141",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth-state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Prefer the already-running production instance (systemd, warm, no
    // cold-compile flakiness); on a fresh machine a dev server starts instead.
    command: "NEXT_DIST_DIR=.next-e2e npx next dev -p 3141",
    url: "http://localhost:3141/terminal/login",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
