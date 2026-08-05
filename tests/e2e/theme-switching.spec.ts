import { test, expect } from "./fixtures";

/**
 * §15.6 — E2E: Theme switching.
 *
 * Tests the theme engine:
 *   - Open settings
 *   - Switch theme
 *   - Verify CSS variables change
 *   - Command palette theme switch
 */

test.describe("Theme Switching", () => {
  test("command palette can switch themes", async ({ page }) => {
    await page.goto("/");

    // Open command palette
    await page.keyboard.press("Control+k");

    // Should see the command palette
    await expect(page.locator("[role='dialog'][aria-label='Command palette']")).toBeVisible({ timeout: 3_000 });

    // Type "theme: midnight"
    await page.locator("[role='dialog'][aria-label='Command palette'] input").fill("Theme: Midnight");

    // Click the theme option
    await page.locator("button:has-text('Theme: Midnight')").click();

    // The data-theme attribute should be set to midnight
    await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  });

  test("can switch to Daybreak (light) theme", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Control+k");
    await page.locator("[role='dialog'][aria-label='Command palette'] input").fill("Theme: Daybreak");
    await page.locator("button:has-text('Theme: Daybreak')").click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "daybreak");
  });

  test("settings dialog shows theme cards", async ({ page }) => {
    await page.goto("/");

    // Open settings
    await page.locator("button[aria-label='Settings']").click();
    await expect(page.locator("[role='dialog'][aria-label='Settings']")).toBeVisible({ timeout: 15_000 });

    // Click the Appearance section
    await page.locator("button:has-text('Appearance')").click();

    // Should see theme cards
    await expect(page.locator("text=Midnight")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Daybreak")).toBeVisible();
    await expect(page.locator("text=Slate")).toBeVisible();
    await expect(page.locator("text=Frost")).toBeVisible();
  });
});
