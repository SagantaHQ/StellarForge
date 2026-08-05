import { test, expect } from "@playwright/test";

/**
 * §15.6 — E2E smoke test: IDE loads correctly.
 *
 * Verifies the homepage IS the IDE (no landing page), all major panels
 * are present, and the sample Soroban contract is loaded.
 */

test.describe("IDE Smoke Tests", () => {
  test("homepage loads directly into the IDE", async ({ page }) => {
    await page.goto("/");

    // Should NOT be a landing page — should be the IDE
    await expect(page).toHaveTitle(/Soroban\.Build/);

    // TopBar should be visible
    await expect(page.locator("header[role='banner']")).toBeVisible({ timeout: 15_000 });

    // Build and Deploy buttons should be in the TopBar (scope to header to avoid ambiguity)
    const header = page.locator("header[role='banner']");
    await expect(header.locator("button:has-text('Build')")).toBeVisible({ timeout: 10_000 });
    await expect(header.locator("button:has-text('Deploy')")).toBeVisible();
  });

  test("file explorer shows sample project files", async ({ page }) => {
    await page.goto("/");

    // File explorer should show the sample project structure
    await expect(page.locator("text=EXPLORER")).toBeVisible({ timeout: 15_000 });

    // Should have src/ folder, Cargo.toml — wait for hydration
    await expect(page.locator("button:has-text('src')")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("button:has-text('Cargo.toml')")).toBeVisible({ timeout: 10_000 });
  });

  test("editor loads with sample Soroban contract", async ({ page }) => {
    await page.goto("/");

    // Wait for Monaco editor to load (use .first() — there may be multiple)
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 });

    // Wait for the editor to have content (Monaco loads async)
    await page.waitForFunction(
      () => {
        const editor = document.querySelector(".monaco-editor .view-lines");
        return editor && editor.textContent && editor.textContent.length > 50;
      },
      { timeout: 15_000 }
    );

    const editorContent = await page.locator(".monaco-editor").first().textContent();
    expect(editorContent).toContain("no_std");
  });

  test("terminal panel is visible", async ({ page }) => {
    await page.goto("/");

    // Terminal should be visible at the bottom
    await expect(page.locator("text=Soroban.Build terminal")).toBeVisible({ timeout: 15_000 });
  });

  test("status bar shows network and toolchain info", async ({ page }) => {
    await page.goto("/");

    // Status bar should show network + toolchain
    const statusBar = page.locator("footer[role='contentinfo']");
    await expect(statusBar).toBeVisible({ timeout: 15_000 });
    await expect(statusBar.locator("text=testnet")).toBeVisible();
  });

  test("activity bar has all view icons", async ({ page }) => {
    await page.goto("/");

    const activityBar = page.locator("[role='toolbar'][aria-label='Activity Bar']");
    await expect(activityBar).toBeVisible({ timeout: 15_000 });

    // All 6 activity views should be present
    await expect(activityBar.locator("button[aria-label='Explorer']")).toBeVisible();
    await expect(activityBar.locator("button[aria-label='Search']")).toBeVisible();
    await expect(activityBar.locator("button[aria-label='Source Control']")).toBeVisible();
    await expect(activityBar.locator("button[aria-label='Compile & Deploy']")).toBeVisible();
    await expect(activityBar.locator("button[aria-label='AI Agent']")).toBeVisible();
    await expect(activityBar.locator("button[aria-label='Collaboration']")).toBeVisible();
  });
});
