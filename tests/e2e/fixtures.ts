import { test as base, expect } from "@playwright/test";

/**
 * §15.6 — Test fixture: clears IndexedDB + localStorage before each test.
 *
 * The IDE uses IndexedDB for local-first persistence (files, comments, tabs).
 * Without clearing, tests would see state from previous test runs (resolved
 * comments, modified files, etc.), making them non-deterministic.
 *
 * This fixture uses a fresh browser context per test (Playwright's default),
 * which means localStorage/IndexedDB start empty. We still explicitly clear
 * to handle cases where the browser context is reused.
 */

export const test = base.extend({
  page: async ({ page }, use) => {
    // Navigate to the app
    await page.goto("/");

    // Clear all browser storage (handles reused context)
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    });

    // Clear IndexedDB — use a promise with timeout
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        try {
          const req = indexedDB.deleteDatabase("soroban-build");
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
          setTimeout(() => resolve(), 1500);
        } catch {
          resolve();
        }
      });
    });

    // Reload to get fresh state with cleared storage
    await page.reload();
    // Wait for the page to settle
    await page.waitForLoadState("domcontentloaded");

    await use(page);
  },
});

export { expect };
