# Company Enhancement Upgrade Plan

## Executive Summary

The current "Enhance Company" feature frequently fails to find websites and social profiles for small/regional beverage alcohol companies. This document outlines a plan to dramatically improve accuracy by replacing Anthropic's `web_search` tool with Google Custom Search API.

**Our Priority: Accuracy and completeness over cost savings.** If spending an extra $0.05-0.10 per enhancement means we find the website 95% of the time instead of 60%, that's the right tradeoff. Users are paying for intelligence - delivering incomplete data damages trust and product value.

---

## The Problem

### What's Happening

Claude's built-in `web_search` tool has limited index coverage compared to Google. It consistently fails to find websites for small, regional, or newer beverage alcohol companies.

### Real Example

**Company:** Binary Barrel Distillery LLC

**Current Result (Claude web_search):**
> "After conducting extensive searches using multiple search strategies, Binary Barrel Distillery LLC does not appear to have an established online presence or verifiable business operations. No official website, business listings, social media profiles, or industry mentions could be found."

**Google Search Result:**
First link: https://binarybarrel.com/ - a fully functional website with all the company information we need.

### Why This Matters

- Users pay $1.67-2.00 per enhancement credit
- Delivering "no information found" when the website is easily Googleable is unacceptable
- This damages user trust and perceived product value
- Many of our target companies ARE small/regional - exactly the ones Claude's search misses

### Estimated Current Failure Rate

| Metric | Current Performance |
|--------|---------------------|
| Website found | ~60-70% |
| Correct website (not a retailer) | ~50-60% |
| Social profiles found | ~30% |
| News articles with valid URLs | ~50% |
| Summary with specific facts | ~40% |

---

## The Solution

### Core Principle

**Use the right tool for each job:**
- **Google** is best at finding URLs (it has the world's most comprehensive web index)
- **Claude** is best at reading content and writing summaries (it's an LLM, not a search engine)

Currently, we're asking Claude to do both. Instead, we should let Google find the URLs, then let Claude analyze and summarize.

### New Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ENHANCED FLOW (Phase 1)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. USER CLICKS "ENHANCE"                                           │
│     │                                                               │
│     ▼                                                               │
│  2. QUERY D1 DATABASE (existing - no change)                        │
│     - Filing statistics                                             │
│     - Brand portfolio                                               │
│     - Category breakdown                                            │
│     - State distribution                                            │
│     │                                                               │
│     ▼                                                               │
│  3. GOOGLE CUSTOM SEARCH (NEW)                                      │
│     - Query 1: "${companyName}"                                     │
│     - Query 2: "${brandName} official website ${industry}"          │
│     - Query 3: "${companyName} facebook instagram"                  │
│     - Query 4: "${brandName} news 2024 2025"                        │
│     │                                                               │
│     ├─► Extract: Official website URL (skip retailers)              │
│     ├─► Extract: Facebook page URL                                  │
│     ├─► Extract: Instagram page URL                                 │
│     └─► Extract: News article URLs + titles                         │
│     │                                                               │
│     ▼                                                               │
│  4. DEEP WEBSITE CRAWL (NEW)                                        │
│     a. Fetch homepage → extract text + find internal links          │
│     b. Filter links for relevant pages (about, story, contact)      │
│     c. Fetch 3-4 most relevant internal pages                       │
│     d. Combine all page content (~8000-12000 chars total)           │
│     │                                                               │
│     ▼                                                               │
│  5. CLAUDE SUMMARIZATION (MODIFIED)                                 │
│     - Input: Company name, filing stats, ALL website content,       │
│              social URLs, news articles                             │
│     - NO web_search tool - just text analysis                       │
│     - Output: Detailed summary with specific facts                  │
│     │                                                               │
│     ▼                                                               │
│  6. CACHE AND RETURN                                                │
│     - Store in company_enhancements table                           │
│     - Return tearsheet to user                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Google Custom Search?

| Capability | Anthropic web_search | Google Custom Search |
|------------|---------------------|----------------------|
| Index size | Limited | Comprehensive (entire web) |
| Small business coverage | Poor | Excellent |
| Regional/local businesses | Weak | Strong |
| New websites (<1 year) | Often missing | Usually indexed |
| Social media pages | Inconsistent | Reliable |
| Structured results | Basic | Rich (title, URL, snippet) |
| Cost per query | ~$0.03 embedded in API | $0.005 |

---

## Implementation Details

### Phase 1: Google CSE + Better Summaries

#### What We Need to Set Up

1. **Google Cloud Project**
   - Go to: https://console.cloud.google.com/
   - Create a new project (or use existing)
   - Name suggestion: "BevAlc Enhancement"

2. **Enable Custom Search API**
   - Navigate to: APIs & Services → Library
   - Search for "Custom Search API"
   - Click Enable

3. **Create API Key**
   - Navigate to: APIs & Services → Credentials
   - Click "Create Credentials" → "API Key"
   - Recommended: Restrict the key to "Custom Search API" only
   - Copy and save the API key

4. **Create Custom Search Engine**
   - Go to: https://programmablesearchengine.google.com/
   - Click "Add" to create a new search engine
   - For "Sites to search": Select **"Search the entire web"**
   - Name it: "BevAlc Company Search"
   - After creation, copy the **Search Engine ID** (cx parameter)

5. **Add Secrets to Cloudflare Worker**
   ```bash
   cd worker
   npx wrangler secret put GOOGLE_CSE_API_KEY
   # Paste your API key when prompted

   npx wrangler secret put GOOGLE_CSE_ID
   # Paste your Search Engine ID when prompted
   ```

#### New Functions to Add (worker.js)

**Function 1: `googleSearch(query, env)`**

Purpose: Execute a single Google Custom Search query and return results.

Logic:
- Call Google CSE API with query
- Return array of results (title, URL, snippet)
- Handle errors gracefully

**Function 2: `discoverCompanyUrls(companyName, brandName, industryHint, env)`**

Purpose: Run multiple Google searches in parallel to find all relevant URLs.

Logic:
- Execute 4 searches in parallel:
  1. Direct company name search
  2. Brand + industry search
  3. Social media search
  4. News search
- Parse results to extract:
  - Official website (first non-retailer .com result)
  - Facebook page URL
  - Instagram page URL
  - Top 3 news articles with URLs
- Filter out known retailers: Drizly, Total Wine, Vivino, Wine-Searcher, ReserveBar, Caskers, wine.com, thewhiskyexchange.com, masterofmalt.com
- Filter out review sites: Yelp, TripAdvisor, Untappd

**Function 3: `crawlWebsite(websiteUrl)`**

Purpose: Deep crawl the website to extract content from multiple relevant pages, not just the homepage.

**Why crawl multiple pages?**
- Homepage often has minimal text (hero images, navigation, CTAs)
- The "About" or "Our Story" page has founding history, location, team info
- The "Contact" page has email, phone, address
- Product pages have details about their offerings

**Hybrid Crawling Approach:**

```
Step 1: Fetch homepage
        │
        ├─► Extract text content (~3000 chars)
        └─► Extract all internal links from <a href="...">
                │
                ▼
Step 2: Filter links for relevant pages
        │
        │   Look for URLs containing keywords:
        │   - about, about-us, our-story, story, history
        │   - team, our-team, people, founders
        │   - contact, contact-us, location, visit
        │   - distillery, winery, brewery (facility info)
        │
        └─► Select top 3-4 most relevant links
                │
                ▼
Step 3: Fetch each relevant page
        │
        ├─► /about → Extract ~2500 chars
        ├─► /our-story → Extract ~2500 chars
        └─► /contact → Extract ~1500 chars
                │
                ▼
Step 4: Fallback (if no relevant links found)
        │
        │   Try common paths directly:
        │   - /about, /about-us, /our-story
        │   - /contact, /contact-us
        │   - /team, /our-team
        │
        └─► Fetch any that return 200 OK
                │
                ▼
Step 5: Combine all content
        │
        └─► Return structured object:
            {
              homepage: "...",      // ~3000 chars
              aboutPage: "...",     // ~2500 chars
              contactPage: "...",   // ~1500 chars
              otherPages: [...]     // Additional content
            }

            Total: ~8000-12000 chars for Claude to analyze
```

**Link Extraction Logic:**
```javascript
// Keywords that indicate valuable pages
const relevantKeywords = [
  'about', 'story', 'history', 'heritage', 'tradition',
  'team', 'people', 'founder', 'family',
  'contact', 'visit', 'location', 'find-us',
  'distillery', 'winery', 'brewery', 'cellar', 'tasting'
];

// Extract links from homepage HTML
const linkRegex = /href=["']([^"']+)["']/gi;
const allLinks = [...html.matchAll(linkRegex)].map(m => m[1]);

// Filter for internal links containing relevant keywords
const relevantLinks = allLinks.filter(link => {
  const isInternal = link.startsWith('/') || link.includes(websiteDomain);
  const hasKeyword = relevantKeywords.some(kw => link.toLowerCase().includes(kw));
  return isInternal && hasKeyword;
});
```

**Content Cleaning Logic:**
```javascript
function cleanHtml(html) {
  return html
    // Remove non-content elements
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Cost:** All fetches are free (just HTTP requests from Cloudflare Worker)

**Function 4: `callClaudeForSummary(companyName, filingData, discoveredUrls, websiteContent, env)`**

Purpose: Generate a detailed, fact-based summary using Claude WITHOUT web_search.

Input to Claude:
- Company name and top brand
- Filing statistics from D1
- Website content (if fetched successfully)
- Social media URLs found
- News article titles and snippets

Output from Claude:
- 3-4 sentence summary with SPECIFIC facts (founding year, location, flagship products, awards, etc.)
- Confidence level (high if website content available, medium if only search results)

Key difference from current: **No `tools` parameter** - Claude just analyzes and writes, no searching.

#### Changes to Existing Code

**Modify: `runEnhancement()` function (lines ~4147-4300)**

Replace the section that calls `callClaudeWithSearch()` with:

1. Call `discoverCompanyUrls()` to find website, social, news via Google
2. Call `crawlWebsite()` to deep crawl homepage + internal pages
3. Call `callClaudeForSummary()` with all discovered data and crawled content
4. Merge results into tearsheet

**Remove/Deprecate: `callClaudeWithSearch()` function (lines ~4310-4451)**

Keep commented out for rollback purposes, but no longer called.

**New Function List:**

| Function | Purpose | Cost |
|----------|---------|------|
| `googleSearch(query, env)` | Single Google CSE query | $0.005/query |
| `discoverCompanyUrls(company, brand, industry, env)` | Run 4 Google searches, extract URLs | $0.02 total |
| `crawlWebsite(websiteUrl)` | Deep crawl homepage + 3-4 internal pages | Free |
| `callClaudeForSummary(...)` | Generate summary from crawled content | ~$0.06 |

---

### Phase 2: Contact Information Extraction (Future)

#### The Goal

Extract contact information (email, phone, address, key people) from company websites to include in the tearsheet.

#### Can Google Do This?

**Partially.** Google can find contact pages, but doesn't return structured contact data. We need to fetch and parse the pages ourselves.

#### Approach: Multi-Layer Extraction

**Layer 1: Scrape from Website (Free)**

Since we're already fetching the website homepage, we extend this to:

1. Fetch additional pages:
   - `${websiteUrl}/contact`
   - `${websiteUrl}/contact-us`
   - `${websiteUrl}/about`
   - `${websiteUrl}/about-us`

2. Extract with regex patterns:
   - Email: `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`
   - Phone: `\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`
   - Address: Look for patterns with state abbreviations + ZIP codes

3. Use Claude to structure:
   - Pass raw contact page content to Claude
   - Ask Claude to extract and format contact info
   - Claude is good at understanding context ("General Inquiries: info@..." vs "Sales: sales@...")

**Expected success rate:** ~60-70% of companies

**Layer 2: Hunter.io Fallback (If Needed)**

For companies where scraping doesn't find an email:

- Hunter.io provides email discovery by domain
- Give it `binarybarrel.com`, get back associated email addresses
- Also provides confidence scores and verification

**Cost:** $49/month for 500 searches = ~$0.10 per lookup

**When to use:** Only when Layer 1 (scraping) fails to find ANY email address

**Expected success rate with both layers:** ~85-95%

#### Alternative Contact Data Services

| Service | What It Provides | Cost | Notes |
|---------|------------------|------|-------|
| **Hunter.io** | Email addresses by domain | $49/mo for 500 | Best for email-only |
| **Clearbit** | Full company enrichment | $99/mo+ | Overkill for our needs |
| **Apollo.io** | B2B contact database | $49/mo for 200 | Good for finding people |
| **Snov.io** | Email finder + verifier | $39/mo for 1000 | Budget option |
| **FullContact** | Person + company data | Per-match pricing | Good accuracy |

**Recommendation:** Start with free scraping. Add Hunter.io only if scraping success rate is below 70%.

#### Contact Data Structure (Phase 2 Output)

```json
{
  "contacts": {
    "emails": {
      "general": "info@binarybarrel.com",
      "sales": "sales@binarybarrel.com"
    },
    "phone": "(502) 555-1234",
    "address": {
      "street": "123 Bourbon Trail",
      "city": "Louisville",
      "state": "KY",
      "zip": "40202"
    },
    "people": [
      {
        "name": "John Smith",
        "title": "Founder & Head Distiller",
        "email": "john@binarybarrel.com"
      }
    ]
  }
}
```

---

## Cost Analysis

### Our Philosophy on Cost

**Accuracy and completeness are more important than saving a few cents.**

A user pays $1.67-2.00 for an enhancement credit. If we deliver "no website found" when the website exists and is easily Googleable, we've failed that user. They won't buy more credits.

The marginal cost difference between a bad enhancement and a good enhancement is $0.05-0.15. That's negligible compared to the cost of losing user trust.

### Cost Breakdown Per Enhancement

| Component | Current | Phase 1 | Phase 2 |
|-----------|---------|---------|---------|
| D1 queries | ~$0.00 | ~$0.00 | ~$0.00 |
| Search (Claude web_search) | ~$0.15 | - | - |
| Search (Google CSE, 4 queries) | - | ~$0.02 | ~$0.02 |
| Website crawl (homepage + 3-4 pages) | - | Free | Free |
| Hunter.io (10% of enhancements) | - | - | ~$0.01 avg |
| Claude API (with tools, ~2K tokens) | ~$0.15 | - | - |
| Claude API (no tools, ~10K input tokens) | - | ~$0.06 | ~$0.07 |
| **Total** | **~$0.30** | **~$0.08** | **~$0.10** |

**Note on Claude costs:** With deep crawling, we send ~8000-12000 characters to Claude (vs ~2000 before). This increases input token cost slightly, but the dramatically better output quality is worth it. We're optimizing for accuracy, not cost.

**Detailed token math:**
- Input: ~10K chars = ~2.5K tokens × $0.003/1K = ~$0.0075
- Output: ~600 tokens × $0.015/1K = ~$0.009
- Total Claude cost: ~$0.02 (much cheaper than with web_search tool!)

The web_search tool adds significant cost because each search is billed. Without it, Claude is just doing text analysis which is cheap.

### Revenue vs Cost

| Metric | Value |
|--------|-------|
| Credit price (pack of 25) | $1.60 per credit |
| Enhancement cost (Phase 1) | ~$0.08 |
| **Gross margin** | **$1.52 (95%)** |
| Enhancement cost (Phase 2) | ~$0.10 |
| **Gross margin** | **$1.50 (94%)** |

Even with deep crawling and Phase 2 contact extraction, margins remain excellent. **Do not compromise on accuracy to save $0.02.**

### What We Get For The Extra Cost

| Approach | Cost | Content Sent to Claude | Summary Quality |
|----------|------|------------------------|-----------------|
| Current (Claude web_search) | ~$0.30 | ~150 char snippet (often nothing) | Generic or "not found" |
| Phase 1 (Google + homepage only) | ~$0.05 | ~4000 chars | Better, but missing depth |
| **Phase 1 (Google + deep crawl)** | **~$0.08** | **~10000 chars** | **Specific facts, founding story, contact info** |

The extra $0.03 for deep crawling gives us 2.5x more content and dramatically better summaries. This is a no-brainer.

---

## Success Metrics

### What We're Optimizing For

1. **Website discovery rate** - Did we find the official website?
2. **Website accuracy** - Is it actually their site (not a retailer)?
3. **Summary quality** - Does it contain specific facts from their website?
4. **Social link discovery** - Did we find their Facebook/Instagram?
5. **News relevance** - Are the news articles actually about this company?
6. **Contact completeness** (Phase 2) - Did we find email/phone/address?

### Target Metrics

| Metric | Current | Phase 1 Target | Phase 2 Target |
|--------|---------|----------------|----------------|
| Website found | ~60% | >95% | >95% |
| Website correct | ~80% | >98% | >98% |
| Summary with specific facts | ~40% | >85% | >85% |
| Facebook found | ~25% | >70% | >70% |
| Instagram found | ~20% | >60% | >60% |
| News URLs valid | ~50% | >90% | >90% |
| Email found | N/A | N/A | >80% |
| Phone found | N/A | N/A | >60% |

---

## Testing Plan

### Phase 1 Test Cases

Test with companies that currently fail or return poor results:

| Company | Current Result | Expected Phase 1 Result |
|---------|---------------|------------------------|
| Binary Barrel Distillery | "No online presence" | binarybarrel.com found, detailed summary |
| [Add more known failures] | | |

### Test Procedure

1. **Local Testing**
   ```bash
   cd worker
   npx wrangler dev
   ```

2. **Test Enhancement Endpoint**
   ```bash
   curl -X POST http://localhost:8787/api/enhance \
     -H "Content-Type: application/json" \
     -d '{
       "company_name": "Binary Barrel Distillery LLC",
       "company_id": 12345,
       "email": "test@example.com"
     }'
   ```

3. **Verify Results**
   - [ ] Website URL found and correct?
   - [ ] Website is NOT a retailer (Drizly, Total Wine, etc.)?
   - [ ] Summary contains specific facts from website?
   - [ ] Facebook URL found (if they have one)?
   - [ ] Instagram URL found (if they have one)?
   - [ ] News articles are actually about this company?
   - [ ] News URLs are valid/clickable?

### Regression Testing

Ensure we don't break companies that currently work:

| Company | Current Result | Should Still Work |
|---------|---------------|-------------------|
| Jack Daniel's | Works | Yes |
| Maker's Mark | Works | Yes |
| [Add more known successes] | | |

---

## Rollout Plan

### Phase 1 Rollout

**Step 1: Google Cloud Setup (15 minutes)**
- Create project
- Enable Custom Search API
- Create API key
- Create search engine (whole web)
- Note down API key and Search Engine ID

**Step 2: Add Secrets to Cloudflare (5 minutes)**
```bash
npx wrangler secret put GOOGLE_CSE_API_KEY
npx wrangler secret put GOOGLE_CSE_ID
```

**Step 3: Code Changes (1-2 hours)**
- Add `googleSearch()` function - single Google CSE API call
- Add `discoverCompanyUrls()` function - run 4 searches, extract URLs
- Add `crawlWebsite()` function - deep crawl homepage + internal pages
- Add `callClaudeForSummary()` function - generate summary from crawled content
- Modify `runEnhancement()` to use new flow
- Comment out old `callClaudeWithSearch()` (keep for rollback)

**Step 4: Local Testing (30 minutes)**
- Run `npx wrangler dev`
- Test with known failure cases
- Test with known success cases
- Verify no regressions

**Step 5: Deploy (5 minutes)**
```bash
npx wrangler deploy
```

**Step 6: Production Validation (30 minutes)**
- Test a few real enhancements
- Monitor Cloudflare logs for errors
- Check Google Cloud Console for API usage

**Step 7: Clear Failed Enhancement Cache**
```sql
-- Find companies with no website that should be re-enhanced
SELECT company_id, company_name
FROM company_enhancements
WHERE website_url IS NULL;

-- Delete their cache entries to force re-enhancement
DELETE FROM company_enhancements
WHERE website_url IS NULL;
```

### Phase 2 Rollout (Future)

**Step 1: Add Contact Extraction Functions**
- `fetchContactPages()`
- `extractContactsFromHtml()`
- Update Claude prompt to include contact formatting

**Step 2: Test Contact Extraction Accuracy**
- Run on 50 companies
- Manually verify accuracy
- Calculate success rate

**Step 3: If Success Rate < 70%, Add Hunter.io**
- Sign up for Hunter.io
- Add `HUNTER_API_KEY` secret
- Add `hunterEmailLookup()` function
- Add fallback logic

**Step 4: Deploy and Monitor**

---

## Rollback Plan

If Phase 1 causes issues:

1. **Immediate:** The old `callClaudeWithSearch()` function is kept (commented out)
2. **To rollback:**
   - Uncomment `callClaudeWithSearch()`
   - Comment out new functions
   - Revert `runEnhancement()` to call old function
   - Deploy: `npx wrangler deploy`
3. **Time to rollback:** ~5 minutes

---

## Open Questions

1. **Fallback behavior:** If Google CSE fails (rate limit, API error), should we:
   - Fall back to Claude web_search? (more expensive, but better than nothing)
   - Return partial data? (filing stats are still valuable)
   - **Recommendation:** Fall back to Claude web_search - accuracy matters more than cost

2. **Website fetch failures:** Some sites block bots or use Cloudflare protection. Should we:
   - Return website URL even if content fetch fails? (yes)
   - Try with different User-Agent? (worth trying)
   - Use a headless browser service? (overkill for now)

3. **Rate limits:** Google CSE has quotas. Should we:
   - Monitor and alert when approaching limits?
   - Implement request queuing?
   - **Recommendation:** Monitor in Google Cloud Console, quotas are generous

4. **Caching strategy:** Currently cache for 90 days. Should we:
   - Keep 90 days?
   - Reduce for more freshness?
   - **Recommendation:** Keep 90 days, but allow manual refresh

---

## Summary

### The Problem
Claude's web_search frequently misses small business websites that Google finds instantly. Even when it finds them, it only gets a ~150 character snippet - not enough to write a meaningful summary.

### The Solution
1. **Google Custom Search** for URL discovery (best-in-class web index)
2. **Deep website crawling** to fetch homepage + about/contact/story pages
3. **Claude for summarization** with ~10,000 chars of real content (not searching)

### The Principle
**Accuracy and completeness matter more than saving a few cents.** Users pay for intelligence - delivering "not found" when the data exists destroys trust. Spending $0.08 instead of $0.05 for dramatically better results is the right call.

### The Result
- Website discovery: 60% → 95%+
- Content available for summary: 150 chars → 10,000 chars
- Summary quality: Generic → Specific facts (founding year, location, story, products)
- Social links: 30% → 70%+
- Cost: ~$0.30 → ~$0.08 (bonus savings, not the goal)

### Next Steps
1. Set up Google Cloud project and Custom Search Engine
2. Add secrets to Cloudflare Worker
3. Implement new functions in worker.js:
   - `googleSearch()` - single CSE query
   - `discoverCompanyUrls()` - run 4 searches, extract URLs
   - `crawlWebsite()` - deep crawl homepage + internal pages
   - `callClaudeForSummary()` - generate summary from content
4. Test thoroughly with known failure cases
5. Deploy
6. Clear cache for previously failed enhancements
7. Monitor and iterate
