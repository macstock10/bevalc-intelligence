# SEO Content Agent

## Purpose
Update and enhance SEO pages with fresh content, optimize metadata, and ensure pages are indexable and valuable for search traffic.

## Triggers
- After weekly update (new filings added)
- When new companies/brands reach visibility thresholds
- Manual optimization requests

## Responsibilities

### 1. Page Content Updates
For high-traffic company and brand pages:
- Add contextual descriptions
- Include recent news mentions
- Update "About" sections with industry context

### 2. Metadata Optimization
- Title tags (60 chars max)
- Meta descriptions (155 chars max)
- JSON-LD structured data

### 3. Internal Linking
- Related companies (same parent/subsidiary)
- Related brands (same category)
- Category pages
- Trend pages

### 4. Content Gap Analysis
Identify pages that need improvement:
- High impressions, low clicks (CTR issue)
- Pages without descriptions
- Stale content (no recent filings)

## Priority Pages

### Tier 1: Top 100 Companies
Companies with most historical filings:
- Diageo Americas Supply, Inc.
- E. & J. Gallo Winery
- Constellation Brands
- Brown-Forman Corporation
- etc.

### Tier 2: Growing Companies
Companies with significant recent activity:
- NEW_COMPANY with 10+ filings
- Companies with filing spikes
- Companies mentioned in news

### Tier 3: Popular Brands
Brands with search traffic potential:
- Major brand names
- Trending categories
- Newsworthy launches

## Content Templates

### Company Page Description
```markdown
{Company Name} is a {industry description} with {X} approved COLA filings
in the TTB database. Their portfolio includes brands like {top 3 brands}.
Recent activity shows {trend observation}.
```

### Brand Page Description
```markdown
{Brand Name} is a {category} brand by {Company}. First approved in {year},
it has {X} total filings with {Y} variants. The brand is known for
{distinguishing feature if available}.
```

## Metadata Templates

### Company Title
```
{Company} Brands & Portfolio | BevAlc Intelligence
```
Max 60 chars - truncate company name if needed.

### Company Meta Description
```
Explore {X} approved labels from {Company}, including {top brand 1},
{top brand 2}, and {top brand 3}. View complete TTB filing history.
```
Max 155 chars.

### Brand Title
```
{Brand Name} TTB Label Approvals | BevAlc Intelligence
```

### Brand Meta Description
```
View all {X} TTB-approved labels for {Brand Name} by {Company}.
Track filing history and new product launches.
```

## Structured Data (JSON-LD)

### Company Page
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Company Name",
  "description": "Generated description",
  "brand": [
    {"@type": "Brand", "name": "Brand 1"},
    {"@type": "Brand", "name": "Brand 2"}
  ],
  "numberOfEmployees": null,
  "foundingDate": null
}
```

### Brand Page
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

## Output Format
```json
{
  "page_type": "company",
  "slug": "diageo-americas-supply-inc",
  "updates": {
    "meta_title": "Diageo Americas Supply Brands & Portfolio | BevAlc Intelligence",
    "meta_description": "Explore 15,234 approved labels from Diageo...",
    "description_html": "<p>Diageo Americas Supply, Inc. is one of the world's largest...</p>",
    "json_ld": {...}
  },
  "internal_links": [
    {"text": "Crown Royal", "url": "/brand/crown-royal"},
    {"text": "Don Julio", "url": "/brand/don-julio"}
  ]
}
```

## Workflow

1. **Identify Priority Pages**
   - Query Search Console for top pages (if API available)
   - Query D1 for top companies by filing count
   - Check for pages without descriptions

2. **Generate Content**
   - Use company/brand data from D1
   - Cross-reference with news mentions
   - Follow templates above

3. **Update Worker**
   - Metadata can be added to worker.js response
   - Consider caching layer for generated content

4. **Track Results**
   - Monitor Search Console impressions/clicks
   - A/B test meta descriptions
   - Track indexation status

## Related Files
- `worker/worker.js` - SEO page rendering
- `skills/bevalc-business-context/SKILL.md`
- `reference/seo-best-practices.md`
