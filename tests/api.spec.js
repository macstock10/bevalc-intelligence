// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * API Endpoint Tests
 * Tests the Cloudflare Worker API endpoints
 */

const API_BASE = 'https://bevalc-api.mac-rowan.workers.dev';

test.describe('Search API', () => {

  test('returns results for valid query', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?q=whiskey`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
  });

  test('returns paginated results', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?limit=10&offset=0`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBeLessThanOrEqual(10);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.total).toBeGreaterThan(0);
  });

  test('filters by category', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?category=Whiskey`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('filters by signal', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?signal=NEW_BRAND`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('filters by date range', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?date_from=2025-01-01&date_to=2025-12-31`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('sorts results', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?sort=approval_date&order=desc`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('returns correct data structure', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?limit=1`);
    const data = await response.json();

    if (data.data.length > 0) {
      const record = data.data[0];
      expect(record.ttb_id).toBeDefined();
      expect(record.brand_name).toBeDefined();
      expect(record.approval_date).toBeDefined();
    }
  });
});

test.describe('Filters API', () => {

  test('returns filter options', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/filters`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.filters).toBeDefined();
    expect(data.filters.origins).toBeDefined();
    expect(data.filters.class_types).toBeDefined();
    expect(data.filters.statuses).toBeDefined();
  });
});

test.describe('Record API', () => {

  test('returns single record by TTB ID', async ({ request }) => {
    // First get a valid TTB ID
    const searchResponse = await request.get(`${API_BASE}/api/search?limit=1`);
    const searchData = await searchResponse.json();

    if (searchData.data.length > 0) {
      const ttbId = searchData.data[0].ttb_id;

      const response = await request.get(`${API_BASE}/api/record?id=${ttbId}`);
      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.ttb_id).toBe(ttbId);
    }
  });

  test('returns error for invalid TTB ID', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/record?id=invalid123`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(false);
  });

  test('returns error when ID is missing', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/record`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

test.describe('Stats API', () => {

  test('returns database stats', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/stats`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.stats).toBeDefined();
    expect(data.stats.total).toBeGreaterThan(0);
  });
});

test.describe('Categories API', () => {

  test('returns category list', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/categories`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.categories).toBeDefined();
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories).toContain('Whiskey');
    expect(data.categories).toContain('Vodka');
    expect(data.categories).toContain('Tequila');
  });
});

test.describe('SEO Page Endpoints', () => {

  test('company page returns HTML', async ({ request }) => {
    const response = await request.get(`${API_BASE}/company/diageo-americas-supply-inc`);
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('brand page returns HTML', async ({ request }) => {
    const response = await request.get(`${API_BASE}/brand/crown-royal`);
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('category page returns HTML', async ({ request }) => {
    const response = await request.get(`${API_BASE}/category/whiskey/2025`);
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('sitemap returns XML', async ({ request }) => {
    const response = await request.get(`${API_BASE}/sitemap.xml`);
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('xml');
  });
});

test.describe('CORS Headers', () => {

  test('API endpoints have CORS headers', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?limit=1`);

    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBeDefined();
  });
});

test.describe('Error Handling', () => {

  test('returns error for unknown routes', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/unknown-endpoint-xyz`);
    // API returns 200 with success:false for unknown routes
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  test('handles malformed requests gracefully', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/search?limit=notanumber`);
    // Should either return 200 with default or 400 error, not 500
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('Performance', () => {

  test('search API responds within 3 seconds', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_BASE}/api/search?q=whiskey&limit=50`);
    const duration = Date.now() - start;

    expect(response.status()).toBe(200);
    expect(duration).toBeLessThan(3000);
  });

  test('company page responds within reasonable time', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_BASE}/company/diageo-americas-supply-inc`);
    const duration = Date.now() - start;

    expect(response.status()).toBe(200);
    // Allow up to 20 seconds for cold starts and network variability
    expect(duration).toBeLessThan(20000);
  });

  test('brand page responds within reasonable time', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_BASE}/brand/crown-royal`);
    const duration = Date.now() - start;

    expect(response.status()).toBe(200);
    // Allow up to 20 seconds for cold starts and network variability
    expect(duration).toBeLessThan(20000);
  });
});
