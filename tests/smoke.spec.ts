/**
 * ForeThought Browser Smoke Tests
 * Run with: npx playwright test tests/smoke.spec.ts
 * Requires the dev server OR set TEST_URL to production URL
 */

import { test, expect, Page } from "@playwright/test";

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const TEST_EMAIL = process.env.TEST_EMAIL || "jheidman@northteq.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "";

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/chat`, { timeout: 10000 });
}

test.describe("Auth", () => {
  test("Login page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page.locator("text=ForeThought")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("Signup page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/signup`);
    await expect(page.locator("text=Create your account")).toBeVisible();
  });

  test("Root redirects to login when not authenticated", async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });

  test("Login with valid credentials", async ({ page }) => {
    if (!TEST_PASSWORD) test.skip();
    await login(page);
    await expect(page).toHaveURL(`${BASE_URL}/chat`);
  });
});

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    if (!TEST_PASSWORD) test.skip();
    await login(page);
  });

  test("Chat page loads with header", async ({ page }) => {
    await expect(page.locator("text=Your AI caddy")).toBeVisible();
  });

  test("Profile icon is visible", async ({ page }) => {
    await expect(page.locator('a[href="/profile"]')).toBeVisible();
  });

  test("Voice/Text toggle is visible", async ({ page }) => {
    const toggle = page.locator("button", { hasText: /Voice|Text/ });
    await expect(toggle).toBeVisible();
  });

  test("Can send a text message and get a response", async ({ page }) => {
    // Switch to text mode if on mobile
    const toggle = page.locator("button", { hasText: "Voice" });
    if (await toggle.isVisible()) await toggle.click();

    const input = page.locator("textarea");
    await input.fill("What club from 150 yards?");
    await page.keyboard.press("Enter");

    // Wait for Frankie's response (up to 15 seconds)
    await expect(page.locator(".rounded-bl-sm").last()).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Profile", () => {
  test.beforeEach(async ({ page }) => {
    if (!TEST_PASSWORD) test.skip();
    await login(page);
  });

  test("Profile page loads", async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await expect(page.locator("text=Your Profile")).toBeVisible();
  });

  test("Persona selector is visible", async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await expect(page.locator("text=Frankie")).toBeVisible();
    await expect(page.locator("text=Coach")).toBeVisible();
  });

  test("Settings redirects to profile", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await expect(page).toHaveURL(`${BASE_URL}/profile`);
  });
});
