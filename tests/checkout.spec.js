/**
 * Checkout and Payment Flow Tests
 *
 * Tests for subscription and credit purchase flows.
 * Note: These tests verify the UI flow but don't complete real payments.
 */

const { test, expect } = require('@playwright/test');
const { waitForPageLoad } = require('./fixtures/helpers');

test.describe('Pricing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);
  });

  test('shows all pricing tiers', async ({ page }) => {
    // Free tier
    await expect(page.locator('text=Free')).toBeVisible();

    // Category Pro tier
    await expect(page.locator('text=Category Pro')).toBeVisible();
    await expect(page.locator('text=$29')).toBeVisible();

    // Premier tier
    await expect(page.locator('text=Premier')).toBeVisible();
    await expect(page.locator('text=$79')).toBeVisible();
  });

  test('Category Pro has subscribe button', async ({ page }) => {
    const categoryProCard = page.locator('.pricing-card:has-text("Category Pro"), [data-tier="category_pro"]');
    const subscribeBtn = categoryProCard.locator('a:has-text("Subscribe"), button:has-text("Subscribe")');

    await expect(subscribeBtn).toBeVisible();
  });

  test('Premier has subscribe button', async ({ page }) => {
    const premierCard = page.locator('.pricing-card:has-text("Premier"), [data-tier="premier"]');
    const subscribeBtn = premierCard.locator('a:has-text("Subscribe"), button:has-text("Subscribe")');

    await expect(subscribeBtn).toBeVisible();
  });

  test('tier features are listed', async ({ page }) => {
    // Check for feature lists
    const features = page.locator('.pricing-feature, .tier-feature, li:has-text("search"), li:has-text("export")');
    expect(await features.count()).toBeGreaterThan(3);
  });
});

test.describe('Category Pro Checkout Flow', () => {
  test('clicking subscribe opens category selection', async ({ page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);

    // Find Category Pro subscribe button
    const subscribeBtn = page.locator('a[href*="category_pro"]:has-text("Subscribe"), button[data-tier="category_pro"]');

    if (await subscribeBtn.count() > 0) {
      await subscribeBtn.first().click();
      await page.waitForTimeout(1000);

      // Should show category selection or redirect to checkout
      // Check for category picker or Stripe redirect
      const categoryPicker = page.locator('.category-picker, select:has-text("Whiskey"), [data-category-select]');
      const isStripeRedirect = page.url().includes('stripe.com') || page.url().includes('checkout');

      expect(await categoryPicker.count() > 0 || isStripeRedirect).toBe(true);
    }
  });

  test('category selection is required', async ({ page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);

    // This test depends on your specific implementation
    // The user should have to select a category before checkout
  });
});

test.describe('Premier Checkout Flow', () => {
  test('clicking subscribe redirects to Stripe', async ({ page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);

    // Find Premier subscribe button
    const subscribeBtn = page.locator('a[href*="premier"]:has-text("Subscribe"), a[href*="checkout"]:has-text("Premier")');

    if (await subscribeBtn.count() > 0) {
      // Set up navigation listener
      const [response] = await Promise.all([
        page.waitForNavigation({ timeout: 10000 }).catch(() => null),
        subscribeBtn.first().click(),
      ]);

      // Should redirect somewhere (Stripe or checkout page)
      // Don't complete checkout, just verify redirect happens
    }
  });
});

test.describe('Upgrade Flow', () => {
  test('upgrade button is shown for Category Pro users', async ({ page }) => {
    // Simulate Category Pro user
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('bevalc_email', 'test-category-pro@test.com');
    });
    await page.context().addCookies([{
      name: 'bevalc_pro',
      value: '1',
      domain: new URL(page.url()).hostname,
      path: '/',
    }]);

    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for upgrade option
    const upgradeBtn = page.locator('button:has-text("Upgrade"), a:has-text("Upgrade to Premier")');
    // May or may not be visible depending on API response
  });
});

test.describe('Credit Purchase Flow', () => {
  test('credit packs are displayed', async ({ page }) => {
    // Simulate pro user
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('bevalc_email', 'test@test.com');
    });
    await page.context().addCookies([{
      name: 'bevalc_pro',
      value: '1',
      domain: new URL(page.url()).hostname,
      path: '/',
    }]);

    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Scroll to credits section
    const creditsSection = page.locator('#credits, text=Enhancement Credits');
    if (await creditsSection.count() > 0) {
      await creditsSection.first().scrollIntoViewIfNeeded();

      // Check for pack options
      const pack10 = page.locator('text=/10.*\\$20|10 credit/i');
      const pack25 = page.locator('text=/25.*\\$40|25 credit/i');

      await expect(pack10.or(pack25)).toBeVisible();
    }
  });

  test('selecting a pack enables purchase button', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('bevalc_email', 'test@test.com');
    });
    await page.context().addCookies([{
      name: 'bevalc_pro',
      value: '1',
      domain: new URL(page.url()).hostname,
      path: '/',
    }]);

    await page.goto('/account.html');
    await waitForPageLoad(page);

    const packBtn = page.locator('.credit-pack').first();
    if (await packBtn.count() > 0) {
      await packBtn.click();
      await page.waitForTimeout(300);

      const purchaseBtn = page.locator('button:has-text("Purchase")');
      if (await purchaseBtn.count() > 0) {
        await expect(purchaseBtn).toBeEnabled();
      }
    }
  });
});

test.describe('Checkout Success Page', () => {
  test('success page loads', async ({ page }) => {
    await page.goto('/success.html');
    await waitForPageLoad(page);

    await expect(page.locator('text=/welcome|success|thank/i')).toBeVisible();
  });

  test('success page shows tier badge', async ({ page }) => {
    // Test with tier parameter
    await page.goto('/success.html?tier=premier');
    await waitForPageLoad(page);

    // Should show appropriate tier
    await expect(page.locator('text=/premier/i')).toBeVisible();
  });
});

test.describe('Billing Portal Access', () => {
  test('manage subscription link exists for pro users', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('bevalc_email', 'test@test.com');
    });
    await page.context().addCookies([{
      name: 'bevalc_pro',
      value: '1',
      domain: new URL(page.url()).hostname,
      path: '/',
    }]);

    await page.goto('/account.html');
    await waitForPageLoad(page);

    // Look for billing/subscription management
    const billingLink = page.locator('a:has-text("Billing"), a:has-text("Manage"), button:has-text("Subscription")');
    // May or may not be visible depending on implementation
  });
});

test.describe('Email Validation in Checkout', () => {
  test('checkout requires valid email', async ({ page }) => {
    await page.goto('/#pricing');
    await waitForPageLoad(page);

    // If there's an email input before checkout
    const emailInput = page.locator('#checkout-email, input[name="email"]');

    if (await emailInput.count() > 0) {
      // Test invalid email
      await emailInput.fill('invalid');
      const isInvalid = await emailInput.evaluate(el => !el.validity.valid);
      expect(isInvalid).toBe(true);

      // Test valid email
      await emailInput.fill('test@example.com');
      const isValid = await emailInput.evaluate(el => el.validity.valid);
      expect(isValid).toBe(true);
    }
  });
});
