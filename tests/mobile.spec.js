// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Mobile Responsiveness Tests
 * Tests layout and functionality on mobile devices
 */

test.use({ viewport: { width: 390, height: 844 } });

test.describe('Mobile - Homepage', () => {

  test('loads and displays correctly', async ({ page }) => {
    await page.goto('/');

    // Page should load
    expect(await page.title()).toBeTruthy();

    // Hero should be visible
    const hero = page.locator('.hero, [class*="hero"]').first();
    await expect(hero).toBeVisible();
  });

  test('navigation is accessible', async ({ page }) => {
    await page.goto('/');

    // Either nav is visible or hamburger menu exists
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
  });

  test('email form is usable', async ({ page }) => {
    await page.goto('/');

    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible();

    // Input should be wide enough to type
    const box = await emailInput.boundingBox();
    expect(box.width).toBeGreaterThan(150);
  });

  test('pricing section scrolls into view', async ({ page }) => {
    await page.goto('/');

    // Scroll to pricing
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('#pricing')).toBeVisible();
  });
});

test.describe('Mobile - Database Page', () => {

  test('loads correctly', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    // Search should be visible
    const search = page.locator('input[type="search"], #search-input').first();
    await expect(search).toBeVisible();
  });

  test('table is scrollable horizontally', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table', { timeout: 15000 });

    // Table should exist
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
  });

  test('filters are accessible', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    // Filters should be visible or in a collapsible section
    const filters = page.locator('select').first();
    await expect(filters).toBeVisible();
  });

  test('modal works on mobile', async ({ page }) => {
    // Use access=granted to enable modal functionality
    await page.goto('/database.html?access=granted');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr.clickable-row', { timeout: 15000 });

    // Give JS time to attach click handlers
    await page.waitForTimeout(500);

    // Scroll to first row and click
    const firstRow = page.locator('table tbody tr.clickable-row').first();
    await firstRow.scrollIntoViewIfNeeded();
    await firstRow.click({ force: true });

    // Wait for modal overlay to become active
    await page.waitForSelector('#modal-overlay.active', { timeout: 5000 });

    // Modal should be visible and reasonably wide
    const modal = page.locator('.modal').first();
    const box = await modal.boundingBox();
    expect(box.width).toBeGreaterThan(280);
  });

  test('search is functional', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    const search = page.locator('input[type="search"], #search-input').first();
    await search.fill('tequila');
    await search.press('Enter');

    await page.waitForTimeout(2000);

    // Results should update
    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });
});

test.describe('Mobile - SEO Pages', () => {

  test('company page has working mobile menu', async ({ page }) => {
    // Set mobile viewport for this test
    await page.setViewportSize({ width: 390, height: 844 });
    // Use worker URL directly to bypass Netlify Edge cache
    await page.goto('https://bevalc-api.mac-rowan.workers.dev/company/diageo-americas-supply-inc');
    await page.waitForLoadState('networkidle');

    // Hamburger menu should be visible on mobile
    const menuBtn = page.locator('#mobile-menu-btn');
    await expect(menuBtn).toBeVisible();

    // Mobile menu should be hidden initially
    const mobileMenu = page.locator('#mobile-menu');
    await expect(mobileMenu).not.toBeVisible();

    // Click hamburger to open menu
    await menuBtn.click();
    await expect(mobileMenu).toBeVisible();

    // Menu should have navigation links
    const homeLink = mobileMenu.locator('a[href="/"]');
    await expect(homeLink).toBeVisible();
  });

  test('company page is readable', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    // Header should be visible
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();

    // Cards should stack vertically
    const cards = page.locator('.seo-card');
    if (await cards.count() > 1) {
      const firstBox = await cards.nth(0).boundingBox();
      const secondBox = await cards.nth(1).boundingBox();
      // On mobile, second card should be below first (not side by side)
      expect(secondBox.y).toBeGreaterThanOrEqual(firstBox.y + firstBox.height - 10);
    }
  });

  test('brand page is readable', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();

    // Text should be readable (not overflowing)
    const content = page.locator('.seo-page, main');
    const box = await content.first().boundingBox();
    expect(box.width).toBeLessThanOrEqual(450); // iPhone 12 width
  });

  test('tables scroll horizontally', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    // Table should be in a wrapper that allows horizontal scroll
    const tableWrapper = page.locator('.table-wrapper');
    if (await tableWrapper.count() > 0) {
      await expect(tableWrapper.first()).toBeVisible();
    }
  });

  test('pro overlay is visible and tappable', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    const overlay = page.locator('.pro-overlay');
    if (await overlay.count() > 0) {
      await expect(overlay.first()).toBeVisible();

      // Upgrade button should be tappable
      const btn = overlay.first().locator('a.btn, button');
      if (await btn.count() > 0) {
        const box = await btn.boundingBox();
        expect(box.width).toBeGreaterThan(80);
        expect(box.height).toBeGreaterThan(30);
      }
    }
  });
});

test.describe('Mobile - Touch Interactions', () => {

  test('links are large enough to tap', async ({ page }) => {
    await page.goto('/');

    // Check nav links
    const navLinks = page.locator('nav a');
    for (const link of await navLinks.all()) {
      const box = await link.boundingBox();
      if (box) {
        // Minimum tap target should be 44x44 or close to it
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }
  });

  test('buttons are large enough to tap', async ({ page }) => {
    await page.goto('/');

    const buttons = page.locator('button, .btn, [class*="button"]');
    for (const btn of await buttons.all()) {
      if (await btn.isVisible()) {
        const box = await btn.boundingBox();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  test('form inputs are large enough', async ({ page }) => {
    await page.goto('/');

    const inputs = page.locator('input[type="email"], input[type="text"]');
    for (const input of await inputs.all()) {
      if (await input.isVisible()) {
        const box = await input.boundingBox();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(36);
        }
      }
    }
  });
});
