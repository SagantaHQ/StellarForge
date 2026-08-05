import { defineConfig, devices } from "@playwright/test";

/**
 * §15.6 — Playwright E2E configuration.
 *
 * Tests run against the dev server on http://localhost:3000.
 * In CI, the server is started before tests run.
 *
 * Test suites:
 *   - IDE loads correctly (smoke test)
 *   - File explorer + editor interaction
 *   - Comment lifecycle (add → resolve → delete)
 *   - Search across files
 *   - Theme switching
 *   - Command palette
 *   - Build panel (compile flow)
 *
 * To run locally:
 *   npx playwright install --with-deps chromium
 *   npx playwright test
 */

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Clear IndexedDB + localStorage before each test for deterministic state
    storageState: undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start dev server automatically for local runs
  webServer: process.env.CI
    ? undefined
    : {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
