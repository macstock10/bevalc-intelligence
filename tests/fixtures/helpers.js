/**
 * Test helper utilities for BevAlc Intelligence E2E tests
 */

const { expect } = require('@playwright/test');

/**
 * Wait for the page to finish loading (no network activity)
 */
async function waitForPageLoad(page) {
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for search results to load
 */
async function waitForSearchResults(page) {
  await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });
}

/**
 * Perform a search with the given query
 */
async function performSearch(page, query, options = {}) {
  const { category, origin, status, dateFrom, dateTo } = options;

  // Enter search query
  if (query) {
    await page.fill('#search-input', query);
  }

  // Set filters
  if (category) {
    await page.selectOption('#filter-category', category);
  }
  if (origin) {
    await page.selectOption('#filter-origin', origin);
  }
  if (status) {
    await page.selectOption('#filter-status', status);
  }
  if (dateFrom) {
    await page.fill('#filter-date-from', dateFrom);
  }
  if (dateTo) {
    await page.fill('#filter-date-to', dateTo);
  }

  // Click search button
  await page.click('#search-btn');

  // Wait for results
  await waitForSearchResults(page);
}

/**
 * Get the count of results shown
 */
async function getResultsCount(page) {
  const countText = await page.textContent('#results-count');
  const match = countText.match(/[\d,]+/);
  return match ? parseInt(match[0].replace(/,/g, ''), 10) : 0;
}

/**
 * Click on a result row to open the modal
 */
async function openResultModal(page, rowIndex = 0) {
  const rows = page.locator('#results-table tbody tr');
  await rows.nth(rowIndex).click();
  await page.waitForSelector('.modal.active', { timeout: 5000 });
}

/**
 * Close the currently open modal
 */
async function closeModal(page) {
  // Click outside or press escape
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal.active', { state: 'hidden', timeout: 5000 });
}

/**
 * Check if an element is blurred (has blur filter)
 */
async function isBlurred(page, selector) {
  const element = page.locator(selector);
  const filter = await element.evaluate(el => window.getComputedStyle(el).filter);
  return filter.includes('blur');
}

/**
 * Check if pro badge is visible
 */
async function hasProBadge(page) {
  return page.locator('.user-status:has-text("Pro"), .user-status:has-text("Premier")').isVisible();
}

/**
 * Navigate to a page and wait for load
 */
async function navigateTo(page, path) {
  await page.goto(path);
  await waitForPageLoad(page);
}

/**
 * Fill out the signup form
 */
async function fillSignupForm(page, email) {
  await page.fill('#signup-email', email);
  await page.click('#signup-form button[type="submit"]');
}

/**
 * Check for error/success toast messages
 */
async function waitForToast(page, type = 'success') {
  const selector = type === 'error' ? '.toast-error, .error-message' : '.toast-success, .success-message';
  await page.waitForSelector(selector, { timeout: 10000 });
}

/**
 * Get all visible table headers
 */
async function getTableHeaders(page) {
  const headers = await page.locator('#results-table thead th').allTextContents();
  return headers.map(h => h.trim());
}

/**
 * Sort table by clicking a header
 */
async function sortTableBy(page, columnName) {
  const header = page.locator(`#results-table thead th:has-text("${columnName}")`);
  await header.click();
  await page.waitForTimeout(500); // Wait for sort to apply
}

/**
 * Check if CSV export button is locked
 */
async function isCsvExportLocked(page) {
  const button = page.locator('#csv-export-btn');
  return button.locator('.pro-badge-small').isVisible();
}

/**
 * Add item to watchlist
 */
async function addToWatchlist(page, type, value) {
  // This depends on your specific UI implementation
  // Adjust selectors as needed
  if (type === 'brand') {
    await page.click(`[data-watchlist-brand="${value}"]`);
  } else if (type === 'company') {
    await page.click(`[data-watchlist-company="${value}"]`);
  }
}

/**
 * Check mobile menu is working
 */
async function openMobileMenu(page) {
  await page.click('#mobile-menu-btn');
  await page.waitForSelector('.nav-links.active, .mobile-menu.active', { timeout: 3000 });
}

/**
 * Take a screenshot with a descriptive name
 */
async function takeScreenshot(page, name) {
  await page.screenshot({
    path: `tests/screenshots/${name}-${Date.now()}.png`,
    fullPage: true
  });
}

module.exports = {
  waitForPageLoad,
  waitForSearchResults,
  performSearch,
  getResultsCount,
  openResultModal,
  closeModal,
  isBlurred,
  hasProBadge,
  navigateTo,
  fillSignupForm,
  waitForToast,
  getTableHeaders,
  sortTableBy,
  isCsvExportLocked,
  addToWatchlist,
  openMobileMenu,
  takeScreenshot,
};
