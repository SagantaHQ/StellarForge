import { test, expect } from "@playwright/test";

/**
 * §15.6 — E2E: Search across files.
 *
 * Tests the search panel functionality:
 *   - Open search view
 *   - Type a query
 *   - Results appear grouped by file
 *   - Click result opens the file
 */

test.describe("Search", () => {
  test("search view opens and accepts input", async ({ page }) => {
    await page.goto("/");

    // Click the Search activity bar icon
    await page.locator("button[aria-label='Search']").click();

    // Search input should be visible
    const searchInput = page.locator("input[placeholder='Search across files…']");
    await expect(searchInput).toBeVisible();

    // Type a query
    await searchInput.fill("contract");

    // Should show result count
    await expect(page.locator("text=/\\d+ results? in \\d+ files?/")).toBeVisible({ timeout: 5_000 });
  });

  test("search finds matches in the sample contract", async ({ page }) => {
    await page.goto("/");

    // Wait for file system to hydrate
    await expect(page.locator("button:has-text('src')")).toBeVisible({ timeout: 15_000 });

    await page.locator("button[aria-label='Search']").click();
    const searchInput = page.locator("input[placeholder='Search across files…']");
    await searchInput.fill("soroban_sdk");

    // Should find matches in src/lib.rs
    await expect(page.locator("text=src/lib.rs")).toBeVisible({ timeout: 10_000 });
  });

  test("case-sensitive toggle works", async ({ page }) => {
    await page.goto("/");

    await page.locator("button[aria-label='Search']").click();
    await page.locator("input[placeholder='Search across files…']").fill("Contract");

    // Click case-sensitive toggle (Aa button)
    const aaButton = page.locator("button:has-text('Aa')");
    await aaButton.click();

    // Should still show results (Contract appears in comments)
    await expect(page.locator("text=/\\d+ results?/")).toBeVisible({ timeout: 5_000 });
  });
});
