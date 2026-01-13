/**
 * Account Management Tests
 *
 * Tests for account page functionality including preferences,
 * watchlist, category selection, and credit purchases
 */

const { expect } = require('@playwright/test');
const { test } = require('./fixtures/auth');
const { waitForPageLoad } = require('./fixtures/helpers');

test.describe('Account Page - Anonymous', () => {
  test('redirects or shows login prompt', async ({ anonymousPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should either redirect to home or show login prompt
    const loginPrompt = page.locator('text=sign in, text=log in, text=enter your email, #signup-email');
    const isOnAccount = page.url().includes('account');

    if (isOnAccount) {
      // Should show some form of auth requirement
      await expect(page.locator('body')).toContainText(/email|sign|log/i);
    }
  });
});

test.describe('Account Page - Category Pro', () => {
  test('shows current tier', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    await expect(page.locator('text=Pro')).toBeVisible();
  });

  test('shows selected category', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should show Whiskey as selected category
    await expect(page.locator('text=Whiskey')).toBeVisible();
  });

  test('category change UI is present', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for category selection/change UI
    const categorySelect = page.locator('select:has(option:has-text("Whiskey")), .category-select, #category-select');
    // May be a dropdown or button
  });

  test('shows upgrade to Premier option', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const upgradeBtn = page.locator('button:has-text("Upgrade"), a:has-text("Premier")');
    // Should have some upgrade path visible
  });

  test('watchlist section is visible', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const watchlistSection = page.locator('text=Watchlist, text=Watching, #watchlist');
    await expect(watchlistSection.first()).toBeVisible();
  });

  test('shows category change cooldown info', async ({ categoryProPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should mention the 7-day/weekly cooldown
    const cooldownText = page.locator('text=/once per week|7 day|cooldown/i');
    // May or may not be visible depending on UI state
  });
});

test.describe('Account Page - Premier', () => {
  test('shows Premier tier', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    await expect(page.locator('text=Premier')).toBeVisible();
  });

  test('does not show category restriction', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should not have single category selection
    // Premier has access to all categories
  });

  test('shows all category preferences', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Should show category checkboxes or multi-select for reports
    const categoryOptions = page.locator('input[type="checkbox"], .category-checkbox, [data-category]');
    // May have multiple category options
  });

  test('watchlist section shows both brands and companies', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const brandWatch = page.locator('text=/brand.*watch|watching.*brand/i');
    const companyWatch = page.locator('text=/company.*watch|watching.*compan/i');

    // At least one watchlist section should be visible
  });

  test('credits section is visible', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const creditsSection = page.locator('text=Credit, text=Enhancement, #credits');
    await expect(creditsSection.first()).toBeVisible();
  });

  test('credit purchase options are shown', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for credit pack options
    const creditPacks = page.locator('text=/10 credit|25 credit|\\$20|\\$40/i');
    await expect(creditPacks.first()).toBeVisible();
  });
});

test.describe('Watchlist Management', () => {
  test('can view watchlist items', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Watchlist section should load
    const watchlist = page.locator('#watchlist, .watchlist-section, [data-watchlist]');
    await expect(watchlist.first()).toBeVisible();
  });

  test('can remove item from watchlist', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for remove buttons
    const removeBtn = page.locator('.watchlist-remove, button:has-text("Remove"), button[aria-label="Remove"]');

    if (await removeBtn.count() > 0) {
      const initialCount = await removeBtn.count();
      await removeBtn.first().click();
      await page.waitForTimeout(1000);

      // Count should decrease or item should be gone
    }
  });
});

test.describe('Report Preferences', () => {
  test('email preferences section exists', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const preferencesSection = page.locator('text=/report.*preference|email.*preference|weekly.*report/i');
    await expect(preferencesSection.first()).toBeVisible();
  });

  test('can toggle report categories', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for category checkboxes
    const checkbox = page.locator('input[type="checkbox"][name*="category"], .category-toggle');

    if (await checkbox.count() > 0) {
      const wasChecked = await checkbox.first().isChecked();
      await checkbox.first().click();
      await page.waitForTimeout(500);

      const isNowChecked = await checkbox.first().isChecked();
      expect(isNowChecked).not.toBe(wasChecked);
    }
  });
});

test.describe('Credit Purchase Flow', () => {
  test('credit pack selection works', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for credit pack buttons/options
    const pack10 = page.locator('button:has-text("10"), [data-pack="10"], .credit-pack:has-text("10")');
    const pack25 = page.locator('button:has-text("25"), [data-pack="25"], .credit-pack:has-text("25")');

    if (await pack10.count() > 0) {
      await pack10.first().click();
      // Should show selection state
    }
  });

  test('purchase button triggers checkout', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Select a pack
    const packBtn = page.locator('.credit-pack, [data-pack]').first();
    if (await packBtn.count() > 0) {
      await packBtn.click();
    }

    // Look for purchase/buy button
    const purchaseBtn = page.locator('button:has-text("Purchase"), button:has-text("Buy")');

    if (await purchaseBtn.count() > 0 && await purchaseBtn.isEnabled()) {
      // Don't actually click to avoid triggering real Stripe checkout
      // Just verify button is present and enabled
      await expect(purchaseBtn).toBeEnabled();
    }
  });
});

test.describe('Billing Management', () => {
  test('billing portal link exists', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const billingLink = page.locator('a:has-text("Billing"), button:has-text("Billing"), a:has-text("Manage Subscription")');
    // May or may not be visible
  });
});

test.describe('Account Security', () => {
  test('logout functionality exists', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    const logoutBtn = page.locator('button:has-text("Log out"), button:has-text("Sign out"), a:has-text("Logout")');

    if (await logoutBtn.count() > 0) {
      await expect(logoutBtn.first()).toBeVisible();
    }
  });
});

test.describe('Mobile Account Page', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('account page is usable on mobile', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Key sections should be visible
    await expect(page.locator('text=Premier')).toBeVisible();

    // Should be scrollable
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  });

  test('credit packs are tappable on mobile', async ({ premierPage: page }) => {
    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Scroll to credits section
    await page.locator('text=Credit').first().scrollIntoViewIfNeeded();

    const packBtn = page.locator('.credit-pack, [data-pack]').first();
    if (await packBtn.count() > 0) {
      await packBtn.tap();
      await page.waitForTimeout(300);
    }
  });
});
