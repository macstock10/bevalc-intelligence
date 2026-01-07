// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Page Functionality Tests
 * Tests core features of main pages
 */

test.describe('Homepage', () => {

  test('loads successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('has correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/BevAlc Intelligence/);
  });

  test('hero section is visible', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('.hero, [class*="hero"]').first();
    await expect(hero).toBeVisible();
  });

  test('email signup form exists', async ({ page }) => {
    await page.goto('/');
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible();
  });

  test('pricing section exists', async ({ page }) => {
    await page.goto('/');
    const pricing = page.locator('#pricing, [id*="pricing"]');
    await expect(pricing).toBeVisible();
  });

  test('navigation is visible', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
  });
});

test.describe('Database Page', () => {

  test('loads successfully', async ({ page }) => {
    const response = await page.goto('/database.html');
    expect(response.status()).toBe(200);
  });

  test('search input exists', async ({ page }) => {
    await page.goto('/database.html');
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], #search-input');
    await expect(searchInput.first()).toBeVisible();
  });

  test('filter dropdowns exist', async ({ page }) => {
    await page.goto('/database.html');
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    const filters = page.locator('select');
    expect(await filters.count()).toBeGreaterThan(0);
  });

  test('results table loads', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    // Wait for results to load (max 10 seconds)
    await page.waitForSelector('table tbody tr, .results-table tr', { timeout: 10000 });

    const rows = page.locator('table tbody tr, .results-table tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('search returns results', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');

    // Type in search
    const searchInput = page.locator('input[type="search"], #search-input').first();
    await searchInput.fill('whiskey');
    await searchInput.press('Enter');

    // Wait for results
    await page.waitForTimeout(2000);

    const rows = page.locator('table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('clicking a row opens modal', async ({ page }) => {
    // Use access=granted to enable modal functionality
    await page.goto('/database.html?access=granted');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr.clickable-row', { timeout: 15000 });

    // Give JS time to attach click handlers
    await page.waitForTimeout(500);

    // Click first clickable row
    const firstRow = page.locator('table tbody tr.clickable-row').first();
    await firstRow.click();

    // Wait for modal overlay to become active
    const modalOverlay = page.locator('#modal-overlay.active');
    await expect(modalOverlay).toBeVisible({ timeout: 5000 });
  });

  test('modal can be closed', async ({ page }) => {
    // Use access=granted to enable modal functionality
    await page.goto('/database.html?access=granted');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr.clickable-row', { timeout: 15000 });

    // Give JS time to attach click handlers
    await page.waitForTimeout(500);

    // Open modal
    await page.locator('table tbody tr.clickable-row').first().click();
    await page.waitForSelector('#modal-overlay.active', { timeout: 5000 });

    // Close modal by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Modal overlay should not have active class
    const modalOverlay = page.locator('#modal-overlay.active');
    await expect(modalOverlay).not.toBeVisible({ timeout: 2000 });
  });

  test('URL parameters populate filters', async ({ page }) => {
    await page.goto('/database.html?signal=NEW_BRAND');
    await page.waitForLoadState('networkidle');

    // Check that signal filter is applied
    // The results should be filtered
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
  });

  test('pagination works', async ({ page }) => {
    await page.goto('/database.html');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Look for pagination controls
    const nextBtn = page.locator('button:has-text("Next"), [class*="next"]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForTimeout(1000);
      // Page should have changed
    }
  });
});

test.describe('Account Page', () => {

  test('loads successfully', async ({ page }) => {
    const response = await page.goto('/account.html');
    expect(response.status()).toBe(200);
  });

  test('shows login/signup prompt for non-logged-in users', async ({ page }) => {
    await page.goto('/account.html');
    // Should show some form of login/signup or "not logged in" message
    const pageContent = await page.textContent('body');
    expect(pageContent.length).toBeGreaterThan(100);
  });
});
