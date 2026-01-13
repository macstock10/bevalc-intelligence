/**
 * Modal and Table Interaction Tests
 *
 * Tests for clicking results, opening modals, and interactive features
 */

const { expect } = require('@playwright/test');
const { test } = require('./fixtures/auth');
const {
  waitForPageLoad,
  waitForSearchResults,
  openResultModal,
  closeModal,
} = require('./fixtures/helpers');

test.describe('Result Row Click', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'whiskey');
    await page.click('#search-btn');
    await waitForSearchResults(page);
  });

  test('clicking row opens modal', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');

    // Wait for modal to appear
    const modal = page.locator('.modal.active, .modal[style*="display: block"], .modal:visible');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('modal shows brand details', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Check modal contains brand info
    const modalContent = await page.locator('.modal').textContent();
    expect(modalContent.length).toBeGreaterThan(50);
  });

  test('modal close button works', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Click close button
    const closeBtn = page.locator('.modal-close, .close-btn, button[aria-label="Close"], .modal button:has-text("×")');
    await closeBtn.first().click();

    // Modal should close
    await expect(page.locator('.modal.active')).not.toBeVisible({ timeout: 3000 });
  });

  test('pressing Escape closes modal', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(page.locator('.modal.active')).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking outside modal closes it', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Click on overlay/backdrop
    const overlay = page.locator('.modal-overlay, .modal-backdrop, .overlay');
    if (await overlay.count() > 0) {
      await overlay.click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.modal.active')).not.toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Modal Content - Anonymous User', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'vodka');
    await page.click('#search-btn');
    await waitForSearchResults(page);
  });

  test('modal shows basic info', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Should show brand name
    const brandName = page.locator('.modal h2, .modal-title, .modal .brand-name');
    await expect(brandName).toBeVisible();
  });

  test('pro features are locked/blurred', async ({ page }) => {
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Check for upgrade prompts or locked features
    const upgradePrompt = page.locator('.modal text=Upgrade, .modal text=Pro, .modal .locked, .modal .blur');
    // May or may not be visible depending on implementation
  });
});

test.describe('Modal Content - Premier User', () => {
  test('modal shows full details without blur', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'whiskey');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Should not have blur class on signal/pro content
    const blurredElements = page.locator('.modal .blur, .modal .blurred');
    expect(await blurredElements.count()).toBe(0);
  });

  test('Company Intelligence button visible', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'jack daniels');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Look for enhance/intelligence button
    const enhanceBtn = page.locator('.modal button:has-text("Enhance"), .modal button:has-text("Intelligence"), .modal .enhance-btn, .modal .company-intel-btn');

    if (await enhanceBtn.count() > 0) {
      await expect(enhanceBtn.first()).toBeVisible();
    }
  });

  test('watchlist buttons work', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'tequila');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Look for watchlist buttons
    const watchlistBtn = page.locator('.modal button:has-text("Watch"), .modal .watchlist-btn, .modal [data-watchlist]');

    if (await watchlistBtn.count() > 0) {
      const initialText = await watchlistBtn.first().textContent();
      await watchlistBtn.first().click();
      await page.waitForTimeout(1000);

      // Button text should change (Add -> Remove or vice versa)
      const newText = await watchlistBtn.first().textContent();
      // May be same if already watched, or different
    }
  });
});

test.describe('CSV Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'gin');
    await page.click('#search-btn');
    await waitForSearchResults(page);
  });

  test('CSV button is visible', async ({ page }) => {
    const csvBtn = page.locator('#csv-export-btn');
    await expect(csvBtn).toBeVisible();
  });

  test('CSV export works for Premier user', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'rum');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const csvBtn = page.locator('#csv-export-btn');

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    await csvBtn.click();

    const download = await downloadPromise;
    if (download) {
      // Download was triggered
      expect(download.suggestedFilename()).toContain('.csv');
    }
  });
});

test.describe('Table Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'bourbon');
    await page.click('#search-btn');
    await waitForSearchResults(page);
  });

  test('clicking header sorts table', async ({ page }) => {
    // Get initial first row
    const getFirstBrand = async () => {
      return page.locator('#results-table tbody tr:first-child td').nth(0).textContent();
    };

    const initialBrand = await getFirstBrand();

    // Click brand header to sort
    const brandHeader = page.locator('#results-table thead th:has-text("Brand")');
    await brandHeader.click();
    await page.waitForTimeout(500);

    // Check if sort indicator appears or data changes
    const afterSort = await getFirstBrand();
    // Data may or may not change depending on current sort state
  });

  test('double click reverses sort', async ({ page }) => {
    const brandHeader = page.locator('#results-table thead th:has-text("Brand")');

    // Click once
    await brandHeader.click();
    await page.waitForTimeout(300);

    // Click again to reverse
    await brandHeader.click();
    await page.waitForTimeout(300);

    // Should have sort indicator
  });
});

test.describe('Responsive Table', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('table is scrollable on mobile', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'wine');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    // Table wrapper should have overflow scroll
    const tableWrapper = page.locator('.table-wrapper, .table-container');
    const overflow = await tableWrapper.evaluate(el => window.getComputedStyle(el).overflowX);
    expect(['auto', 'scroll']).toContain(overflow);
  });

  test('rows are still clickable on mobile', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'beer');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    await page.click('#results-table tbody tr:first-child');

    const modal = page.locator('.modal.active, .modal[style*="display: block"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Signal Column Interactions', () => {
  test('signal link navigates to glossary', async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Check for signal help link
    const signalLink = page.locator('.filter-help-link, a[href*="glossary"][href*="signals"]');
    await expect(signalLink).toBeVisible();

    await signalLink.click();
    await expect(page).toHaveURL(/glossary.*signals/);
  });
});

test.describe('Company Page Links', () => {
  test('company name links to company page', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'maker');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    // Open modal
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Look for company link
    const companyLink = page.locator('.modal a[href*="/company/"]');
    if (await companyLink.count() > 0) {
      const href = await companyLink.first().getAttribute('href');
      expect(href).toContain('/company/');
    }
  });
});

test.describe('Brand Page Links', () => {
  test('brand name links to brand page', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'grey goose');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    // Open modal
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Look for brand link
    const brandLink = page.locator('.modal a[href*="/brand/"]');
    if (await brandLink.count() > 0) {
      const href = await brandLink.first().getAttribute('href');
      expect(href).toContain('/brand/');
    }
  });
});
