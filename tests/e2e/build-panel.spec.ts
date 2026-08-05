import { test, expect } from "./fixtures";

/**
 * §15.6 — E2E: Build panel (compile flow).
 *
 * Tests the Build button and Compile panel:
 *   - Click Build button in TopBar
 *   - Compile panel opens
 *   - Build status shows "building" then "success" or "failed"
 *
 * Note: The actual cargo build may not run in CI (no Rust toolchain).
 * These tests verify the UI flow, not the real compilation.
 */

test.describe("Build Panel", () => {
  test("Build button is visible and clickable", async ({ page }) => {
    await page.goto("/");

    const buildButton = page.locator("button:has-text('Build')");
    await expect(buildButton).toBeVisible();
    await buildButton.click();

    // Should switch right panel to compile view
    await expect(page.locator("text=soroban contract build")).toBeVisible({ timeout: 3_000 });
  });

  test("Compile panel shows build buttons", async ({ page }) => {
    await page.goto("/");

    // Click the Compile & Deploy activity
    await page.locator("button[aria-label='Compile & Deploy']").click();

    // Should see the build section — wait for hydration
    await expect(page.locator("button:has-text('soroban contract build')")).toBeVisible({ timeout: 15_000 });
  });

  test("output area is present", async ({ page }) => {
    await page.goto("/");

    // Navigate to compile panel
    await page.locator("button[aria-label='Compile & Deploy']").click();

    // Should see the Output heading
    await expect(page.locator("text=Output")).toBeVisible({ timeout: 15_000 });
  });
});
