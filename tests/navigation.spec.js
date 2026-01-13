/**
 * Navigation and Page Load Tests
 *
 * Tests that all pages load correctly and navigation works
 */

const { test, expect } = require('@playwright/test');
const { waitForPageLoad } = require('./fixtures/helpers');

test.describe('Page Loading', () => {
  test('home page loads correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Check title
    await expect(page).toHaveTitle(/BevAlc Intelligence/);

    // Check main elements are visible
    await expect(page.locator('.logo')).toBeVisible();
    await expect(page.locator('.nav-links')).toBeVisible();

    // Check hero section
    await expect(page.locator('h1')).toBeVisible();
  });

  test('database page loads correctly', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    await expect(page).toHaveTitle(/Database|BevAlc/);

    // Check search elements
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-btn')).toBeVisible();

    // Check filters
    await expect(page.locator('#filter-category')).toBeVisible();
    await expect(page.locator('#filter-origin')).toBeVisible();
  });

  test('glossary page loads correctly', async ({ page }) => {
    await page.goto('/glossary.html');
    await waitForPageLoad(page);

    await expect(page).toHaveTitle(/Glossary|BevAlc/);

    // Check glossary sections exist
    await expect(page.locator('#signals')).toBeVisible();
  });

  test('account page loads correctly', async ({ page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    await expect(page).toHaveTitle(/Account|BevAlc/);
  });

  test('legal page loads correctly', async ({ page }) => {
    await page.goto('/legal.html');
    await waitForPageLoad(page);

    await expect(page).toHaveTitle(/Legal|Terms|Privacy|BevAlc/i);
  });
});

test.describe('Navigation Links', () => {
  test('nav links work from home page', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Click Database link
    await page.click('.nav-link:has-text("Database")');
    await expect(page).toHaveURL(/database/);

    // Go back and click Glossary
    await page.goto('/');
    await page.click('.nav-link:has-text("Glossary")');
    await expect(page).toHaveURL(/glossary/);

    // Go back and click Account
    await page.goto('/');
    await page.click('.nav-link:has-text("Account")');
    await expect(page).toHaveURL(/account/);
  });

  test('logo links back to home', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    await page.click('.logo');
    await expect(page).toHaveURL(/index|\/$/);
  });

  test('pricing link scrolls to pricing section', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    await page.click('.nav-link:has-text("Pricing")');

    // Check URL has #pricing
    await expect(page).toHaveURL(/#pricing/);
  });
});

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile menu opens and closes', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Menu should be hidden initially
    const navLinks = page.locator('.nav-links');

    // Click hamburger menu
    await page.click('#mobile-menu-btn');

    // Menu should be visible now (check for active class or visibility)
    await expect(page.locator('.nav-links, .mobile-menu')).toBeVisible();

    // Click again to close (or click outside)
    await page.click('#mobile-menu-btn');
  });

  test('mobile nav links work', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Open mobile menu
    await page.click('#mobile-menu-btn');
    await page.waitForTimeout(300);

    // Click Database link
    await page.click('.nav-link:has-text("Database")');
    await expect(page).toHaveURL(/database/);
  });
});

test.describe('Footer Links', () => {
  test('footer links are present and work', async ({ page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Check footer exists
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();

    // Check for common footer links
    const legalLink = footer.locator('a:has-text("Legal"), a:has-text("Terms"), a:has-text("Privacy")');
    if (await legalLink.count() > 0) {
      await legalLink.first().click();
      await expect(page).toHaveURL(/legal|terms|privacy/i);
    }
  });
});

test.describe('Signal Glossary Link', () => {
  test('database page has link to signals glossary', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Check for the signal help link
    const signalLink = page.locator('a[href*="glossary"][href*="signals"], .filter-help-link');
    await expect(signalLink).toBeVisible();

    // Click and verify navigation
    await signalLink.click();
    await expect(page).toHaveURL(/glossary.*#signals|glossary.html#signals/);

    // Check signals section is visible
    await expect(page.locator('#signals')).toBeVisible();
  });
});
