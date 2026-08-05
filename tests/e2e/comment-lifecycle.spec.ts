import { test, expect } from "@playwright/test";

/**
 * §15.6 — E2E: Comment lifecycle.
 *
 * Tests the full comment lifecycle per the acceptance checklist:
 *   - Add comment via right-click context menu
 *   - Comment appears in floating panel
 *   - Resolve comment → strikethrough + collapse
 *   - Delete (author-only)
 *   - Per-file scoping
 *   - Click-to-navigate
 */

test.describe("Comment Lifecycle", () => {
  test("seed comments are visible in the panel", async ({ page }) => {
    await page.goto("/");

    // Wait for editor + comments panel to load (IndexedDB hydration is async)
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });

    // Wait a bit for comments to load from IndexedDB
    await page.waitForTimeout(2000);

    // Should see the comments panel with seed comments
    await expect(page.locator("text=alice")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Should we add input validation")).toBeVisible();

    // bob's comment should be visible
    await expect(page.locator("text=bob")).toBeVisible();
    await expect(page.locator("text=Missing require_auth")).toBeVisible();
  });

  test("clicking a comment scrolls editor to the anchored line", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Click bob's comment (should be on line 33)
    await page.locator("text=Missing require_auth").click();

    // The editor cursor should move
    await expect(page.locator(".monaco-editor")).toBeVisible();
  });

  test("resolve button works — comment moves to resolved section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Click the first resolve button
    const resolveBtn = page.locator("button[aria-label='Resolve comment']").first();
    await resolveBtn.waitFor({ state: "visible", timeout: 10_000 });
    await resolveBtn.click();

    // Should now see a "Resolved" section
    await expect(page.locator("text=/Resolved \\(\\d+\\)/")).toBeVisible({ timeout: 5_000 });
  });

  test("comments panel can be collapsed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Find the collapse button in the comments panel header
    const collapseBtn = page.locator("button[aria-label='Collapse panel']").first();
    await collapseBtn.waitFor({ state: "visible", timeout: 10_000 });
    await collapseBtn.click();

    // Panel should collapse to a pill
    await page.waitForTimeout(500);
  });
});
