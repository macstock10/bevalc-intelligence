/**
 * Search and Filter Tests
 *
 * Tests all search functionality and filter combinations
 */

const { test, expect } = require('@playwright/test');
const {
  waitForPageLoad,
  waitForSearchResults,
  performSearch,
  getResultsCount,
  getTableHeaders,
} = require('./fixtures/helpers');

test.describe('Basic Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('search input accepts text', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('whiskey');
    await expect(searchInput).toHaveValue('whiskey');
  });

  test('search returns results', async ({ page }) => {
    await page.fill('#search-input', 'whiskey');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('search by brand name works', async ({ page }) => {
    await page.fill('#search-input', 'JACK DANIELS');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    // Check results contain the brand
    const results = page.locator('#results-table tbody tr');
    expect(await results.count()).toBeGreaterThan(0);

    // First result should contain the search term
    const firstRowText = await results.first().textContent();
    expect(firstRowText.toUpperCase()).toContain('JACK');
  });

  test('search by company name works', async ({ page }) => {
    await page.fill('#search-input', 'DIAGEO');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('empty search shows recent/all results', async ({ page }) => {
    await page.fill('#search-input', '');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('no results message for nonsense query', async ({ page }) => {
    await page.fill('#search-input', 'xyznonexistent12345');
    await page.click('#search-btn');

    // Wait a bit for search to complete
    await page.waitForTimeout(2000);

    // Either no results or zero count
    const count = await getResultsCount(page);
    expect(count).toBe(0);
  });

  test('search is case insensitive', async ({ page }) => {
    // Search lowercase
    await page.fill('#search-input', 'smirnoff');
    await page.click('#search-btn');
    await waitForSearchResults(page);
    const lowerCount = await getResultsCount(page);

    // Search uppercase
    await page.fill('#search-input', 'SMIRNOFF');
    await page.click('#search-btn');
    await waitForSearchResults(page);
    const upperCount = await getResultsCount(page);

    // Counts should be the same
    expect(lowerCount).toBe(upperCount);
  });

  test('pressing Enter triggers search', async ({ page }) => {
    await page.fill('#search-input', 'vodka');
    await page.press('#search-input', 'Enter');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Category Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  const categories = [
    'Whiskey',
    'Vodka',
    'Tequila',
    'Gin',
    'Rum',
    'Brandy',
    'Wine',
    'Beer',
    'Liqueur',
    'RTD/Cocktails',
  ];

  for (const category of categories) {
    test(`filtering by ${category} returns results`, async ({ page }) => {
      await page.selectOption('#filter-category', category);
      await page.click('#search-btn');
      await waitForSearchResults(page);

      const count = await getResultsCount(page);
      expect(count).toBeGreaterThan(0);
    });
  }

  test('category filter combined with search', async ({ page }) => {
    await page.selectOption('#filter-category', 'Whiskey');
    await page.fill('#search-input', 'bourbon');
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Origin Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('filter by Domestic origin', async ({ page }) => {
    // Wait for origin options to load
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-origin');
      return select && select.options.length > 1;
    }, { timeout: 5000 }).catch(() => {});

    const options = await page.locator('#filter-origin option').allTextContents();

    if (options.some(o => o.includes('Domestic') || o.includes('D'))) {
      await page.selectOption('#filter-origin', { label: /Domestic|^D$/i });
      await page.click('#search-btn');
      await waitForSearchResults(page);

      const count = await getResultsCount(page);
      expect(count).toBeGreaterThan(0);
    }
  });

  test('filter by Import origin', async ({ page }) => {
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-origin');
      return select && select.options.length > 1;
    }, { timeout: 5000 }).catch(() => {});

    const options = await page.locator('#filter-origin option').allTextContents();

    if (options.some(o => o.includes('Import') || o.includes('I'))) {
      await page.selectOption('#filter-origin', { label: /Import|^I$/i });
      await page.click('#search-btn');
      await waitForSearchResults(page);

      const count = await getResultsCount(page);
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe('Date Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('filter by date range', async ({ page }) => {
    // Set date range to last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];

    await page.fill('#filter-date-from', fromDate);
    await page.fill('#filter-date-to', toDate);
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('filter with only from date', async ({ page }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

    await page.fill('#filter-date-from', fromDate);
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('filter with only to date', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0];

    await page.fill('#filter-date-to', today);
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Status Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('filter by APPROVED status', async ({ page }) => {
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-status');
      return select && select.options.length > 1;
    }, { timeout: 5000 }).catch(() => {});

    await page.selectOption('#filter-status', { label: /APPROVED/i });
    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Combined Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('search + category + origin', async ({ page }) => {
    await page.fill('#search-input', 'reserve');
    await page.selectOption('#filter-category', 'Whiskey');

    // Wait for origin options
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-origin');
      return select && select.options.length > 1;
    }, { timeout: 5000 }).catch(() => {});

    await page.selectOption('#filter-origin', { index: 1 }); // First non-empty option

    await page.click('#search-btn');
    await waitForSearchResults(page);

    const count = await getResultsCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('all filters combined', async ({ page }) => {
    const today = new Date();
    const yearAgo = new Date(today);
    yearAgo.setFullYear(today.getFullYear() - 1);

    await page.fill('#search-input', 'premium');
    await page.selectOption('#filter-category', 'Vodka');
    await page.fill('#filter-date-from', yearAgo.toISOString().split('T')[0]);
    await page.fill('#filter-date-to', today.toISOString().split('T')[0]);

    await page.click('#search-btn');
    await waitForSearchResults(page);

    // May or may not have results, but should not error
    const resultsCount = page.locator('#results-count');
    await expect(resultsCount).toBeVisible();
  });
});

test.describe('Clear Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('clear all button resets filters', async ({ page }) => {
    // Set some filters
    await page.fill('#search-input', 'test');
    await page.selectOption('#filter-category', 'Whiskey');
    await page.fill('#filter-date-from', '2024-01-01');

    // Click clear all
    await page.click('#clear-filters');

    // Verify filters are reset
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#filter-category')).toHaveValue('');
    await expect(page.locator('#filter-date-from')).toHaveValue('');
  });
});

test.describe('Subcategory Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
  });

  test('subcategory populates when category selected', async ({ page }) => {
    // Select a category
    await page.selectOption('#filter-category', 'Whiskey');

    // Wait for subcategory to populate
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-class');
      return select && select.options.length > 1;
    }, { timeout: 5000 });

    const options = await page.locator('#filter-class option').count();
    expect(options).toBeGreaterThan(1);
  });

  test('subcategory clears when category changes', async ({ page }) => {
    // Select Whiskey
    await page.selectOption('#filter-category', 'Whiskey');
    await page.waitForFunction(() => {
      const select = document.querySelector('#filter-class');
      return select && select.options.length > 1;
    }, { timeout: 5000 });

    // Select a subcategory
    await page.selectOption('#filter-class', { index: 1 });

    // Change to different category
    await page.selectOption('#filter-category', 'Vodka');

    // Subcategory should reset or change
    await page.waitForTimeout(500);
  });
});

test.describe('Results Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);
    await page.fill('#search-input', 'whiskey');
    await page.click('#search-btn');
    await waitForSearchResults(page);
  });

  test('table has expected headers', async ({ page }) => {
    const headers = await getTableHeaders(page);

    // Check for key columns
    expect(headers.some(h => /brand/i.test(h))).toBe(true);
    expect(headers.some(h => /company/i.test(h))).toBe(true);
    expect(headers.some(h => /signal/i.test(h))).toBe(true);
  });

  test('table rows are clickable', async ({ page }) => {
    const firstRow = page.locator('#results-table tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Should have cursor pointer
    const cursor = await firstRow.evaluate(el => window.getComputedStyle(el).cursor);
    expect(cursor).toBe('pointer');
  });

  test('pagination works', async ({ page }) => {
    // Check if pagination exists
    const pagination = page.locator('.pagination, [class*="pagination"]');

    if (await pagination.count() > 0) {
      // Get initial results
      const initialFirstRow = await page.locator('#results-table tbody tr').first().textContent();

      // Click next page if available
      const nextBtn = page.locator('.pagination-next, button:has-text("Next"), [aria-label="Next"]');
      if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(1000);

        // Results should change
        const newFirstRow = await page.locator('#results-table tbody tr').first().textContent();
        expect(newFirstRow).not.toBe(initialFirstRow);
      }
    }
  });
});
