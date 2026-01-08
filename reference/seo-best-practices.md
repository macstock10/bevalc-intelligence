# SEO Best Practices Reference

This document outlines SEO best practices for BevAlc Intelligence content and programmatic pages.

## Technical SEO

### Page Speed
- **Target:** <3 seconds load time
- **Current:** 0.1-0.3s for SEO pages (edge cached)
- **Caching:** 1hr browser, 24hr edge, stale-while-revalidate

### Core Web Vitals
| Metric | Target | Notes |
|--------|--------|-------|
| LCP (Largest Contentful Paint) | <2.5s | Main content visible quickly |
| FID (First Input Delay) | <100ms | Interactive quickly |
| CLS (Cumulative Layout Shift) | <0.1 | Stable layout |

### Indexing
- **Sitemap:** bevalcintel.com/sitemap.xml (split into 10 files)
- **Robots.txt:** Allow all, reference sitemap
- **Canonical:** Self-referencing on all pages

### URL Structure
```
/company/[slug]          # 21,509 pages
/brand/[slug]            # 240,605 pages
/category/[category]/[year]  # ~70 pages
/database                # Main search page
```

## On-Page SEO

### Title Tags
**Format:** `[Primary Keyword] | BevAlc Intelligence`
**Max length:** 60 characters

| Page Type | Format |
|-----------|--------|
| Company | `[Company] Brands & Portfolio \| BevAlc Intelligence` |
| Brand | `[Brand] TTB Label Approvals \| BevAlc Intelligence` |
| Category | `[Category] Trends [Year] \| BevAlc Intelligence` |
| Blog | `[Article Title] \| BevAlc Intelligence` |

### Meta Descriptions
**Max length:** 155 characters
**Formula:** [Action verb] + [what] + [number if applicable] + [value prop]

| Page Type | Example |
|-----------|---------|
| Company | `Explore 15,234 approved labels from Diageo, including Crown Royal, Don Julio, and Tanqueray. View complete TTB filing history.` |
| Brand | `View all 234 TTB-approved labels for Crown Royal by Diageo Americas Supply, Inc. Track filing history and new product launches.` |

### Headings
- **H1:** One per page, includes primary keyword
- **H2:** Section headers, use keyword variations
- **H3:** Subsections as needed

### Internal Linking
- Link company names to `/company/[slug]`
- Link brand names to `/brand/[slug]`
- Link categories to `/category/[category]/[year]`
- Use descriptive anchor text (not "click here")

## Content SEO

### Keyword Research

**Primary Keywords (programmatic):**
- "[Company] brands"
- "[Company] TTB filings"
- "[Brand] label approval"
- "[Category] trends [year]"

**Long-tail Keywords (content):**
- "new [category] brands [year]"
- "[company] new product launch"
- "TTB COLA database"
- "alcohol label approval timeline"

### Content Requirements

**Company Pages:**
- Primary keyword in H1
- Brand names in opening paragraph
- Filing count with context
- Category breakdown
- Recent activity

**Brand Pages:**
- Brand name in H1
- Company name with link
- Filing timeline
- Product variants (fanciful names)
- Category context

**Blog Posts:**
- Minimum 500 words for indexing
- 3+ internal links
- Data-driven (numbers)
- Updated within 12 months

## Structured Data (JSON-LD)

### Company Page Schema
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Company Name",
  "description": "Description with brands mentioned",
  "url": "https://bevalcintel.com/company/slug",
  "brand": [
    {"@type": "Brand", "name": "Brand 1"},
    {"@type": "Brand", "name": "Brand 2"}
  ]
}
```

### Brand Page Schema
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Brand Name",
  "brand": {
    "@type": "Brand",
    "name": "Brand Name"
  },
  "manufacturer": {
    "@type": "Organization",
    "name": "Company Name"
  },
  "category": "Beverage > Alcoholic Beverage > Category"
}
```

### Blog Post Schema
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Article Title",
  "datePublished": "2026-01-11",
  "author": {
    "@type": "Organization",
    "name": "BevAlc Intelligence"
  }
}
```

## Link Building

### Internal Link Strategy
- Every SEO page links to related pages
- Blog posts link to relevant company/brand pages
- Category pages link to top companies/brands
- All pages link to main database

### External Link Opportunities
- Industry publications (pitch data stories)
- Trade associations
- Business news (for data citations)
- Legal/compliance resources

### Citation Opportunities
When we're cited, request link to:
- Homepage for brand mentions
- Specific page for data citations
- Database for research references

## Content Optimization Checklist

### New Blog Post
- [ ] Title includes primary keyword
- [ ] Meta description under 155 chars
- [ ] H1 matches title intent
- [ ] 3+ data points from D1
- [ ] 3+ internal links to SEO pages
- [ ] JSON-LD Article schema
- [ ] Featured image with alt text
- [ ] URL slug is descriptive
- [ ] Mobile-friendly layout

### Company/Brand Page Enhancement
- [ ] Description includes brand names naturally
- [ ] Meta description mentions top brands
- [ ] JSON-LD includes brand array
- [ ] Internal links to related pages
- [ ] Recent filings table has data
- [ ] Category breakdown visible

## Monitoring

### Google Search Console
- Check weekly for:
  - Indexing issues
  - Coverage errors
  - Core Web Vitals
  - Search performance

### Key Metrics
| Metric | Target | Check Frequency |
|--------|--------|-----------------|
| Pages indexed | 260K+ | Weekly |
| Impressions | Growing | Weekly |
| CTR | >2% | Monthly |
| Average position | Improving | Monthly |

### Alerts
- Coverage drops >10%
- CTR drops >20%
- Pages de-indexed
- Core Web Vitals fail

## Common Issues & Fixes

### Low CTR
- **Problem:** High impressions, low clicks
- **Fix:** Improve meta description, add numbers

### Not Indexing
- **Problem:** Pages not in index
- **Fix:** Check sitemap, internal links, content quality

### Keyword Cannibalization
- **Problem:** Multiple pages targeting same keyword
- **Fix:** Consolidate or differentiate focus

### Thin Content
- **Problem:** Pages with minimal content
- **Fix:** Add descriptions, context, related data
