// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * SEO Pages Tests
 * Tests company, brand, and category pages
 */

const SAMPLE_COMPANIES = [
  'diageo-americas-supply-inc',
  'constellation-brands-inc',
  'e-and-j-gallo-winery',
];

const SAMPLE_BRANDS = [
  'crown-royal',
  'johnnie-walker',
  'don-julio',
];

test.describe('Company SEO Pages', () => {

  test('company page loads successfully', async ({ page }) => {
    const response = await page.goto('/company/diageo-americas-supply-inc');
    expect(response.status()).toBe(200);
  });

  test('has correct meta tags', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    // Check title
    const title = await page.title();
    expect(title).toContain('Diageo');
    expect(title).toContain('BevAlc Intelligence');

    // Check meta description
    const metaDesc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDesc).toBeTruthy();
    expect(metaDesc.length).toBeGreaterThan(50);
  });

  test('has JSON-LD structured data', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toBeTruthy();

    const data = JSON.parse(jsonLd);
    expect(data['@type']).toBe('Organization');
    expect(data.name).toBeTruthy();
  });

  test('has breadcrumb navigation', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    const breadcrumb = page.locator('.breadcrumb');
    await expect(breadcrumb).toBeVisible();

    const homeLink = breadcrumb.locator('a[href="/"]');
    await expect(homeLink).toBeVisible();
  });

  test('displays company stats', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    // Check for stats cards
    const statsCards = page.locator('.seo-card, .stat-value');
    expect(await statsCards.count()).toBeGreaterThan(0);
  });

  test('displays brands section', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    const brandsSection = page.locator('text=Brands');
    await expect(brandsSection.first()).toBeVisible();

    // Check for brand chips/links
    const brandLinks = page.locator('a[href^="/brand/"]');
    expect(await brandLinks.count()).toBeGreaterThan(0);
  });

  test('displays recent filings table', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    const table = page.locator('.filings-table, table');
    await expect(table.first()).toBeVisible();

    // Check table has headers
    const headers = page.locator('th');
    expect(await headers.count()).toBeGreaterThan(3);
  });

  test('has blur overlay for non-Pro users', async ({ page }) => {
    await page.goto('/company/diageo-americas-supply-inc');

    // Check for blur content or pro overlay
    const blurContent = page.locator('.blur-content, .pro-overlay');
    expect(await blurContent.count()).toBeGreaterThan(0);
  });

  test('has proper caching headers', async ({ page }) => {
    const response = await page.goto('/company/diageo-americas-supply-inc');
    const cacheControl = response.headers()['cache-control'];

    // Should have some form of caching
    expect(cacheControl).toBeTruthy();
  });

  test('404 for non-existent company', async ({ page }) => {
    const response = await page.goto('/company/this-company-does-not-exist-12345');
    expect(response.status()).toBe(404);
  });

  for (const companySlug of SAMPLE_COMPANIES) {
    test(`company page ${companySlug} loads correctly`, async ({ page }) => {
      const response = await page.goto(`/company/${companySlug}`);
      expect(response.status()).toBe(200);
    });
  }
});

test.describe('Brand SEO Pages', () => {

  test('brand page loads successfully', async ({ page }) => {
    const response = await page.goto('/brand/crown-royal');
    expect(response.status()).toBe(200);
  });

  test('has correct meta tags', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const title = await page.title();
    expect(title.toLowerCase()).toContain('crown royal');

    const metaDesc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDesc).toBeTruthy();
  });

  test('has JSON-LD structured data', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toBeTruthy();

    const data = JSON.parse(jsonLd);
    expect(data['@type']).toBe('Brand');
  });

  test('displays filing timeline', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const timeline = page.locator('.bar-chart, [class*="timeline"]');
    expect(await timeline.count()).toBeGreaterThan(0);
  });

  test('displays products table', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const table = page.locator('table, .filings-table');
    await expect(table.first()).toBeVisible();
  });

  test('links to company page', async ({ page }) => {
    await page.goto('/brand/crown-royal');

    const companyLink = page.locator('a[href^="/company/"]');
    expect(await companyLink.count()).toBeGreaterThan(0);
  });

  test('404 for non-existent brand', async ({ page }) => {
    const response = await page.goto('/brand/this-brand-does-not-exist-xyz-12345');
    expect(response.status()).toBe(404);
  });

  for (const brandSlug of SAMPLE_BRANDS) {
    test(`brand page ${brandSlug} loads correctly`, async ({ page }) => {
      const response = await page.goto(`/brand/${brandSlug}`);
      expect(response.status()).toBe(200);
    });
  }
});

test.describe('Category SEO Pages', () => {

  test('category page loads successfully', async ({ page }) => {
    const response = await page.goto('/category/whiskey/2025');
    expect(response.status()).toBe(200);
  });

  test('has correct meta tags', async ({ page }) => {
    await page.goto('/category/whiskey/2025');

    const title = await page.title();
    expect(title.toLowerCase()).toContain('whiskey');
  });

  test('displays category stats', async ({ page }) => {
    await page.goto('/category/whiskey/2025');

    const stats = page.locator('.stat-value');
    expect(await stats.count()).toBeGreaterThan(0);
  });

  test('displays top companies', async ({ page }) => {
    await page.goto('/category/whiskey/2025');

    const companyLinks = page.locator('a[href^="/company/"]');
    expect(await companyLinks.count()).toBeGreaterThan(0);
  });

  test('year navigation works', async ({ page }) => {
    await page.goto('/category/whiskey/2025');

    // Check for year links
    const yearLinks = page.locator('a[href*="/category/whiskey/"]');
    expect(await yearLinks.count()).toBeGreaterThan(0);
  });
});

test.describe('Sitemaps', () => {

  test('sitemap index is valid', async ({ page }) => {
    const response = await page.request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('sitemapindex');
    expect(body).toContain('sitemap-companies.xml');
    expect(body).toContain('sitemap-brands');
  });

  test('companies sitemap is valid', async ({ page }) => {
    const response = await page.request.get('/sitemap-companies.xml');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('urlset');
    expect(body).toContain('/company/');
  });

  test('brands sitemap is valid', async ({ page }) => {
    const response = await page.request.get('/sitemap-brands-1.xml');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('urlset');
    expect(body).toContain('/brand/');
  });

  test('static sitemap is valid', async ({ page }) => {
    const response = await page.request.get('/sitemap-static.xml');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('urlset');
  });
});
