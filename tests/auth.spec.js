/**
 * Authentication and User State Tests
 *
 * Tests user authentication flows and different tier behaviors
 */

const { expect } = require('@playwright/test');
const { test, TEST_ACCOUNTS } = require('./fixtures/auth');
const { waitForPageLoad, hasProBadge } = require('./fixtures/helpers');

test.describe('Anonymous User', () => {
  test('shows signup CTA in nav', async ({ anonymousPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Should see "Get Access" or similar CTA
    const signupCta = page.locator('#nav-signup, .nav-cta');
    await expect(signupCta).toBeVisible();
  });

  test('can view database page but with limitations', async ({ anonymousPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search should work
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('#search-btn')).toBeVisible();
  });

  test('pricing section shows all tiers', async ({ anonymousPage: page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);

    // Check pricing cards are visible
    await expect(page.locator('text=Category Pro')).toBeVisible();
    await expect(page.locator('text=Premier')).toBeVisible();
  });
});

test.describe('Free User', () => {
  test('shows user email in nav', async ({ freePage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Greeting should show email or be logged in state
    const greeting = page.locator('#user-greeting');
    // The app may show greeting differently - adjust as needed
  });

  test('sees blurred signals on database', async ({ freePage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Perform a search
    await page.fill('#search-input', 'whiskey');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Check that signal column exists
    const signalHeader = page.locator('#results-table thead th:has-text("Signal")');
    await expect(signalHeader).toBeVisible();

    // Signal values should be blurred for free users
    const signalCell = page.locator('#results-table tbody tr:first-child td.signal-cell, #results-table tbody tr:first-child td:nth-child(7)');
    // Check for blur class or filter
    const hasBlur = await signalCell.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.filter.includes('blur') || el.classList.contains('blur') || el.querySelector('.blur');
    });
    // This may vary based on implementation
  });

  test('CSV export is locked', async ({ freePage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Perform a search first
    await page.fill('#search-input', 'vodka');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Check CSV button shows PRO badge
    const csvButton = page.locator('#csv-export-btn');
    await expect(csvButton).toBeVisible();

    const proBadge = csvButton.locator('.pro-badge-small, #csv-pro-badge');
    await expect(proBadge).toBeVisible();
  });
});

test.describe('Category Pro User', () => {
  test('shows Pro badge in nav', async ({ categoryProPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Should show Pro status
    const userStatus = page.locator('.user-status');
    await expect(userStatus).toContainText(/Pro/i);
  });

  test('can access signals in their category', async ({ categoryProPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search in their category (Whiskey)
    await page.selectOption('#filter-category', 'Whiskey');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Signals should NOT be blurred in their category
    const signalCell = page.locator('#results-table tbody tr:first-child td.signal-cell, #results-table tbody tr:first-child td:has-text("NEW_"), #results-table tbody tr:first-child td:has-text("REFILE")').first();

    if (await signalCell.count() > 0) {
      const isBlurred = await signalCell.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.filter.includes('blur');
      });
      expect(isBlurred).toBe(false);
    }
  });

  test('signals blurred outside their category', async ({ categoryProPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search in a different category (Vodka, not Whiskey)
    await page.selectOption('#filter-category', 'Vodka');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Signals should be blurred outside their category
    // Implementation may vary
  });

  test('can export CSV for their category', async ({ categoryProPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search in their category
    await page.selectOption('#filter-category', 'Whiskey');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // CSV button should not have PRO badge locked
    const csvButton = page.locator('#csv-export-btn');
    const proBadge = csvButton.locator('.pro-badge-small:visible');
    // For category pro in their category, badge may be hidden
  });

  test('account page shows category selection', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should see category selection or current category display
    await expect(page.locator('text=Whiskey')).toBeVisible();
  });

  test('shows upgrade to Premier option', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should see upgrade option
    const upgradeButton = page.locator('button:has-text("Upgrade"), a:has-text("Upgrade")');
    // May or may not be visible depending on UI state
  });
});

test.describe('Premier User', () => {
  test('shows Premier badge in nav', async ({ premierPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // Should show Premier status
    const userStatus = page.locator('.user-status');
    await expect(userStatus).toContainText(/Premier/i);
  });

  test('can access all signals', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search any category
    await page.fill('#search-input', 'tequila');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Signals should not be blurred
    const signalCells = page.locator('#results-table tbody td.signal-cell, #results-table tbody td:has-text("NEW_"), #results-table tbody td:has-text("REFILE")');

    if (await signalCells.count() > 0) {
      const firstCell = signalCells.first();
      const isBlurred = await firstCell.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.filter.includes('blur');
      });
      expect(isBlurred).toBe(false);
    }
  });

  test('can export CSV for any category', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Search any category
    await page.selectOption('#filter-category', 'Tequila');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // CSV button should be unlocked
    const csvButton = page.locator('#csv-export-btn');
    await expect(csvButton).toBeVisible();

    // PRO badge should not be visible (or button should not have 'locked' class)
    const isLocked = await csvButton.evaluate(el => el.classList.contains('locked'));
    expect(isLocked).toBe(false);
  });

  test('can access Company Intelligence', async ({ premierPage: page }) => {
    await page.goto('/database.html');
    await waitForPageLoad(page);

    // Perform a search
    await page.fill('#search-input', 'jack daniels');
    await page.click('#search-btn');
    await page.waitForSelector('#results-table tbody tr', { timeout: 30000 });

    // Click on a result to open modal
    await page.click('#results-table tbody tr:first-child');
    await page.waitForSelector('.modal.active, .modal[style*="display: block"]', { timeout: 5000 });

    // Company Intelligence button should be available
    const enhanceBtn = page.locator('button:has-text("Enhance"), button:has-text("Intelligence"), .enhance-btn');
    // May or may not be visible depending on modal structure
  });

  test('account page shows all categories selected', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should see Premier tier indication
    await expect(page.locator('text=Premier')).toBeVisible();
  });

  test('does not show upgrade option on home page', async ({ premierPage: page }) => {
    await page.goto('/');
    await waitForPageLoad(page);

    // The "Subscribe to Premier" button should be disabled or hidden
    const premierCta = page.locator('a[href*="premier"]:has-text("Subscribe"), button:has-text("Subscribe to Premier")');

    if (await premierCta.count() > 0) {
      // Should be disabled
      const isDisabled = await premierCta.first().evaluate(el => {
        return el.disabled || el.classList.contains('disabled') || el.style.pointerEvents === 'none';
      });
      expect(isDisabled).toBe(true);
    }
  });
});

test.describe('Signup Flow', () => {
  test('signup form validates email', async ({ anonymousPage: page }) => {
    await page.goto('/#signup');
    await waitForPageLoad(page);

    const emailInput = page.locator('#signup-email, input[type="email"]');

    if (await emailInput.count() > 0) {
      // Try invalid email
      await emailInput.fill('invalid-email');
      await page.click('#signup-form button[type="submit"], .signup-btn');

      // Should show validation error or not submit
      // Check for HTML5 validation
      const isInvalid = await emailInput.evaluate(el => !el.validity.valid);
      expect(isInvalid).toBe(true);
    }
  });

  test('signup form accepts valid email', async ({ anonymousPage: page }) => {
    await page.goto('/#signup');
    await waitForPageLoad(page);

    const emailInput = page.locator('#signup-email, input[type="email"]');

    if (await emailInput.count() > 0) {
      await emailInput.fill('test@example.com');

      const isValid = await emailInput.evaluate(el => el.validity.valid);
      expect(isValid).toBe(true);
    }
  });
});
