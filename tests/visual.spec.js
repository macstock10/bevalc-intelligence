// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Visual Regression Tests
 * Captures screenshots and compares against baselines
 */

test.describe('Visual Regression - Desktop', () => {

  test('homepage looks correct', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('homepage.png', {
      fullPage: true,
      maxDiffPixels: 1000,
    });
  });

  test('database page looks correct', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    await expect(page).toHaveScreenshot('database.png', {
      maxDiffPixels: 1000,
    });
  });

  test('company page looks correct', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('company-page.png', {
      fullPage: true,
      maxDiffPixels: 1000,
    });
  });

  test('brand page looks correct', async ({ page }) => {
    await page.goto('/brand/crown-royal');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('brand-page.png', {
      fullPage: true,
      maxDiffPixels: 1000,
    });
  });
});

test.describe('Visual Regression - Components', () => {

  test('navigation looks correct', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const nav = page.locator('nav');
    await expect(nav).toHaveScreenshot('navigation.png', {
      maxDiffPixels: 100,
    });
  });

  test('search results table looks correct', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const table = page.locator('table').first();
    await expect(table).toHaveScreenshot('results-table.png', {
      maxDiffPixels: 500,
    });
  });

  test('modal looks correct', async ({ page }) => {
    // Use access=granted to enable modal functionality
    await page.goto('/database.html?access=granted');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr.clickable-row', { timeout: 15000 });

    // Give JS time to attach click handlers
    await page.waitForTimeout(500);

    // Open modal
    await page.locator('table tbody tr.clickable-row').first().click();
    await page.waitForSelector('#modal-overlay.active', { timeout: 5000 });

    const modal = page.locator('.modal').first();
    await expect(modal).toHaveScreenshot('modal.png', {
      maxDiffPixels: 300,
    });
  });

  test('pro overlay looks correct', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');
    await page.waitForLoadState('networkidle');

    const overlay = page.locator('.pro-overlay').first();
    if (await overlay.isVisible()) {
      await expect(overlay).toHaveScreenshot('pro-overlay.png', {
        maxDiffPixels: 100,
      });
    }
  });
});

test.describe('Visual Regression - Mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12

  test('homepage mobile looks correct', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('homepage-mobile.png', {
      fullPage: true,
      maxDiffPixels: 1000,
    });
  });

  test('database mobile looks correct', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('database-mobile.png', {
      maxDiffPixels: 1000,
    });
  });

  test('company page mobile looks correct', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('company-mobile.png', {
      fullPage: true,
      maxDiffPixels: 1000,
    });
  });
});
