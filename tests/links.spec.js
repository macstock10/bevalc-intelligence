// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Link Validation Tests
 * Crawls pages and validates all links are working
 */

const PAGES_TO_CRAWL = [
  '/',
  '/database.html',
  '/account.html',
];

// Track visited URLs to avoid duplicates
const visitedUrls = new Set();
const brokenLinks = [];

test.describe('Link Validation', () => {

  test('homepage has no broken internal links', async ({ page }) => {
    await page.goto('/');

    const links = await page.locator('a[href]').all();
    const internalLinks = [];

    for (const link of links) {
      const href = await link.getAttribute('href');
      // Skip anchors, external links, mailto, data URIs, and CDN links
      if (href &&
          !href.startsWith('http') &&
          !href.startsWith('mailto:') &&
          !href.startsWith('#') &&
          !href.startsWith('data:') &&
          !href.includes('#') &&
          !href.startsWith('/cdn-cgi')) {
        internalLinks.push(href);
      }
    }

    // Check each internal link
    for (const href of [...new Set(internalLinks)]) {
      const response = await page.request.get(href);
      expect(response.status(), `Link ${href} should return 200`).toBeLessThan(400);
    }
  });

  test('database page has no broken internal links', async ({ page }) => {
    await page.goto('/database.html');

    const links = await page.locator('a[href]').all();
    const internalLinks = [];

    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
        internalLinks.push(href);
      }
    }

    for (const href of [...new Set(internalLinks)]) {
      const response = await page.request.get(href);
      expect(response.status(), `Link ${href} should return 200`).toBeLessThan(400);
    }
  });

  test('navigation links work correctly', async ({ page }) => {
    await page.goto('/');

    // Test nav links exist
    const navLinks = [
      { text: 'Database', expectedHref: 'database' },
      { text: 'Pricing', expectedHref: 'pricing' },
    ];

    for (const { text, expectedHref } of navLinks) {
      const link = page.locator(`nav a:has-text("${text}")`).first();
      if (await link.count() > 0) {
        const href = await link.getAttribute('href');
        expect(href.toLowerCase()).toContain(expectedHref);
      }
    }
  });

  test('footer links work correctly', async ({ page }) => {
    await page.goto('/');

    const footerLinks = await page.locator('footer a[href]').all();

    for (const link of footerLinks) {
      const href = await link.getAttribute('href');
      // Skip anchors, mailto, external links, data URIs
      if (href &&
          !href.startsWith('mailto:') &&
          !href.startsWith('#') &&
          !href.includes('#') &&
          !href.startsWith('http') &&
          !href.startsWith('data:') &&
          !href.startsWith('/cdn-cgi')) {
        const response = await page.request.get(href);
        expect(response.status(), `Footer link ${href} should work`).toBeLessThan(400);
      }
    }
  });

  test('SEO company page links are valid', async ({ page }) => {
    // Test a sample company page
    const response = await page.goto('/company/diageo-americas-supply-inc');
    expect(response.status()).toBeLessThan(400);

    // Check that brand links on the page are valid
    const brandLinks = await page.locator('a[href^="/brand/"]').all();
    expect(brandLinks.length).toBeGreaterThan(0);

    // Test first few brand links
    for (const link of brandLinks.slice(0, 3)) {
      const href = await link.getAttribute('href');
      const linkResponse = await page.request.get(href);
      expect(linkResponse.status(), `Brand link ${href} should work`).toBeLessThan(400);
    }
  });

  test('SEO brand page links are valid', async ({ page }) => {
    const response = await page.goto('/brand/crown-royal');
    expect(response.status()).toBeLessThan(400);

    // Check company link
    const companyLink = page.locator('a[href^="/company/"]').first();
    if (await companyLink.count() > 0) {
      const href = await companyLink.getAttribute('href');
      const linkResponse = await page.request.get(href);
      expect(linkResponse.status()).toBeLessThan(400);
    }
  });

  test('sitemap is accessible and valid XML', async ({ page }) => {
    const response = await page.request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('xml');

    const body = await response.text();
    expect(body).toContain('<?xml');
    expect(body).toContain('<sitemapindex');
  });

  test('robots.txt is accessible', async ({ page }) => {
    const response = await page.request.get('/robots.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('Sitemap:');
  });
});
