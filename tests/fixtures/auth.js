/**
 * Authentication fixtures for BevAlc Intelligence E2E tests
 *
 * These fixtures simulate different user states by setting the appropriate
 * localStorage values that the app uses for authentication.
 */

const { test: base } = require('@playwright/test');

/**
 * Test accounts configuration
 * In a real setup, these would come from environment variables
 */
const TEST_ACCOUNTS = {
  free: {
    email: 'test-free@bevalcintel.com',
    tier: null,
    isPro: false,
  },
  categoryPro: {
    email: process.env.TEST_CATEGORY_PRO_EMAIL || 'maclain.rowan@gmail.com',
    tier: 'category_pro',
    tierCategory: 'Whiskey',
    isPro: true,
  },
  premier: {
    email: process.env.TEST_PREMIER_EMAIL || 'mac.rowan@outlook.com',
    tier: 'premier',
    isPro: true,
  },
};

/**
 * Set up authentication state for a user
 */
async function setupAuth(page, userType) {
  const account = TEST_ACCOUNTS[userType];
  if (!account) {
    throw new Error(`Unknown user type: ${userType}`);
  }

  // Navigate to the site first to set localStorage on the correct domain
  await page.goto('/');

  // Set localStorage values that the app uses
  await page.evaluate((email) => {
    localStorage.setItem('bevalc_email', email);
  }, account.email);

  // If pro user, set the pro cookie
  if (account.isPro) {
    await page.context().addCookies([{
      name: 'bevalc_pro',
      value: '1',
      domain: new URL(page.url()).hostname,
      path: '/',
    }]);
  }

  return account;
}

/**
 * Clear authentication state
 */
async function clearAuth(page) {
  await page.evaluate(() => {
    localStorage.removeItem('bevalc_email');
  });
  await page.context().clearCookies();
}

/**
 * Extended test fixtures with pre-authenticated states
 */
const test = base.extend({
  // Anonymous user (no auth)
  anonymousPage: async ({ page }, use) => {
    await clearAuth(page);
    await use(page);
  },

  // Free user (email set, no pro access)
  freePage: async ({ page }, use) => {
    await setupAuth(page, 'free');
    await use(page);
  },

  // Category Pro user
  categoryProPage: async ({ page }, use) => {
    const account = await setupAuth(page, 'categoryPro');
    page.testAccount = account;
    await use(page);
  },

  // Premier user
  premierPage: async ({ page }, use) => {
    const account = await setupAuth(page, 'premier');
    page.testAccount = account;
    await use(page);
  },
});

module.exports = {
  test,
  TEST_ACCOUNTS,
  setupAuth,
  clearAuth,
};
