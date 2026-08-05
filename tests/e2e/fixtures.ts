import { test as base, expect } from "@playwright/test";

/**
 * §15.6 — Test fixture: clears IndexedDB + localStorage before each test.
 *
 * The IDE uses IndexedDB for local-first persistence (files, comments, tabs).
 * Without clearing, tests would see state from previous test runs (resolved
 * comments, modified files, etc.), making them non-deterministic.
 *
 * This fixture navigates to the page, clears all browser storage, then reloads
 * to get a fresh state before each test runs.
 */

export const test = base.extend({
  page: async ({ page }, use) => {
    // Navigate to the app first
    await page.goto("/");

    // Clear all browser storage
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("soroban-build");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
        // Timeout fallback — don't block tests if IDB is stuck
        setTimeout(() => resolve(), 2000);
      });
    });

    // Reload to get fresh state with cleared storage
    await page.reload();

    await use(page);
  },
});

export { expect };
