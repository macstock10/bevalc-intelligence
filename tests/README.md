# BevAlc Intelligence - Test Suite

End-to-end tests for the BevAlc Intelligence platform using Playwright.

## Setup

```bash
cd tests
npm install
npx playwright install
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run specific test suites
```bash
npm run test:links    # Link validation tests
npm run test:pages    # Page functionality tests
npm run test:seo      # SEO pages tests
npm run test:mobile   # Mobile responsiveness tests
npm run test:api      # API endpoint tests
```

### Run in headed mode (see browser)
```bash
npm run test:headed
```

### Run with UI
```bash
npm run test:ui
```

### View test report
```bash
npm run report
```

## Test Files

| File | Description |
|------|-------------|
| `links.spec.js` | Validates internal/external links, sitemaps, robots.txt |
| `pages.spec.js` | Tests homepage, database page, account page functionality |
| `seo-pages.spec.js` | Tests company, brand, category SEO pages |
| `mobile.spec.js` | Mobile responsiveness and touch interactions |
| `api.spec.js` | Cloudflare Worker API endpoint tests |
| `visual.spec.js` | Visual regression screenshots |

## Test Coverage

### Links
- Internal link validation
- Navigation links
- Footer links
- SEO page cross-linking
- Sitemap validity
- robots.txt accessibility

### Page Functionality
- Homepage loads, title, hero, email form, pricing section
- Database: search, filters, results, pagination, modal
- Account page access

### SEO Pages
- Company pages: meta tags, JSON-LD, breadcrumbs, stats, tables
- Brand pages: meta tags, timeline, products, company links
- Category pages: stats, top companies, year navigation
- 404 handling for non-existent pages
- Cache headers

### Mobile
- Responsive layouts
- Horizontal table scrolling
- Touch target sizes
- Form usability

### API
- Search with filters, pagination, sorting
- Record lookup
- Stats and categories
- CORS headers
- Error handling
- Performance (< 3s response)

## Environment Variables

- `BASE_URL` - Override the base URL (default: https://bevalcintel.com)

```bash
BASE_URL=http://localhost:8080 npm test
```

## Updating Visual Baselines

When UI changes are intentional:

```bash
npx playwright test visual.spec.js --update-snapshots
```

## CI Integration

Add to GitHub Actions:

```yaml
- name: Run Playwright tests
  run: |
    cd tests
    npm ci
    npx playwright install --with-deps
    npm test
```
