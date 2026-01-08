# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Management

**At the END of every working session, Claude MUST:**
1. Update this CLAUDE.md with any new files, features, or architecture changes
2. Update RUNBOOK.md if new operational procedures were added
3. Commit changes with message "Update context docs after [brief description]"

**After EVERY code change, Claude MUST offer to run the full git commit and push:**
- Ask the user if they want Claude to commit and push the changes
- If yes, run: `git add -A && git commit -m "Description of change" && git push`
- Always commit from the repo root directory

**At the START of every session, Claude SHOULD:**
1. Read this file and RUNBOOK.md
2. Ask what the user wants to accomplish
3. Reference these docs to understand current state

---

## Project Overview

BevAlc Intelligence is a B2B SaaS platform tracking TTB COLA filings (beverage alcohol label approvals). It provides a searchable database of 1M+ records with weekly email reports for subscribers.

**Live Site**: https://bevalcintel.com
**GitHub**: https://github.com/macstock10/bevalc-intelligence

## Folder Structure

```
bevalc-intelligence/
├── .claude/
│   └── CLAUDE.md              # This file - Claude context
├── .github/
│   └── workflows/
│       ├── weekly-update.yml  # Scrapes TTB, updates D1
│       └── weekly-report.yml  # Generates + sends reports
├── emails/                    # React Email + Resend system
│   ├── package.json           # Email dependencies
│   ├── send.js                # Main send functions (CLI + API)
│   ├── test-email.js          # Test/preview tool
│   ├── index.js               # Package exports
│   ├── components/
│   │   └── Layout.jsx         # Shared email layout (brand colors)
│   └── templates/
│       ├── WeeklyReport.jsx   # Free weekly report email
│       ├── ProWeeklyReport.jsx # Pro weekly report email (comprehensive)
│       └── Welcome.jsx        # New subscriber welcome email
├── scripts/
│   ├── requirements.txt
│   ├── weekly_update.py       # TTB scraper + D1 sync
│   ├── weekly_report.py       # PDF report generator
│   ├── send_weekly_report.py  # Query D1 + send weekly email
│   ├── normalize_companies.py # Company name normalization
│   ├── generate_sitemaps.py   # Generate static sitemaps, upload to R2
│   ├── batch_classify.py      # Batch classify historical records
│   ├── cola_worker.py         # Historical TTB scraper (by month)
│   ├── scrape_2014_*.bat      # 12 batch files for 2014 monthly scraping
│   └── src/
│       └── email_sender.py    # Python wrapper for email system
├── web/                       # Frontend (Netlify)
│   ├── index.html
│   ├── database.html
│   ├── database.js
│   ├── ttb-categories.js      # Shared category/subcategory mapping
│   ├── account.html
│   ├── auth.js
│   ├── style.css
│   ├── _redirects             # Netlify proxy rules for SEO pages
│   └── robots.txt             # Crawler instructions + sitemap reference
├── worker/                    # Cloudflare Worker source
│   ├── worker.js
│   └── wrangler.toml          # Worker deployment config
├── data/                      # Reference data
│   └── ttb-categories.json    # Master TTB code hierarchy (420 codes → 67 subcategories → 11 categories)
├── reports/                   # Generated reports (gitignored)
├── logs/                      # Script logs (gitignored)
├── .env                       # Secrets (gitignored)
├── .gitignore
├── netlify.toml
└── RUNBOOK.md                 # Operations guide
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Static Site    │────▶│ Cloudflare Worker│────▶│  Cloudflare D1  │
│  (Netlify)      │     │  (API Gateway)   │     │  (1M+ COLAs)    │
│  /web/*         │     │  /worker/        │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                        │
                                ▼                        │
                        ┌──────────────────┐            │
                        │    Stripe API    │            │
                        │  (Pro payments)  │            │
                        └──────────────────┘            │
                                                        │
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (Weekly)                       │
│  ┌─────────────────┐   ┌─────────────────┐   ┌────────────────┐ │
│  │ weekly_update.py│──▶│ weekly_report.py│──▶│send_weekly_    │ │
│  │ Scrape TTB      │   │ Generate PDF    │   │report.py       │ │
│  │ → Sync to D1    │   │ → Upload to R2  │   │ → Send via     │ │
│  │                 │   │                 │   │   Resend       │ │
│  └─────────────────┘   └─────────────────┘   └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Weekly Update** (Fridays 9pm ET / Saturday 2am UTC):
   - `weekly_update.py` scrapes last 14 days from TTB
   - New COLAs synced to Cloudflare D1
   - Records classified as NEW_BRAND / NEW_SKU / REFILE

2. **Weekly Report** (Saturdays 9am ET / 2pm UTC):
   - `weekly_report.py` queries D1 for historical data
   - Generates PDF with charts and tables
   - `send_weekly_report.py` uploads to R2 and sends via Resend

3. **API Layer** (`worker/worker.js`):
   - Handles search, filters, CSV export
   - Stripe checkout/webhooks for Pro subscriptions
   - User preferences and watchlist management

4. **Frontend** (`web/`):
   - Static HTML/JS makes API calls to Worker
   - Auth state via localStorage

### Key Integration Points

- **Stripe Webhooks**: Worker receives `checkout.session.completed` → creates `user_preferences` record in D1
- **Category Mapping**: Both `worker.js` and `database.js` share `TTB_CODE_CATEGORIES` mapping (TTB codes → categories like Whiskey, Vodka)
- **D1 Sync**: `weekly_update.py` uses INSERT OR IGNORE for deduplication
- **Email System**: React Email templates in `/emails` sent via Resend API (replaces Loops)

## Common Commands

```bash
# Frontend: Auto-deploys on push to main (Netlify)

# Deploy Cloudflare Worker
cd worker && npx wrangler deploy

# Test Worker locally
cd worker && npx wrangler dev

# Test Python scripts locally (use venv)
cd scripts
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt

# Run weekly update (scrapes TTB, syncs to D1)
python weekly_update.py              # Full run
python weekly_update.py --dry-run    # Preview without D1 push
python weekly_update.py --sync-only  # Skip scraping, just sync existing local data
python weekly_update.py --days 7     # Custom lookback period

# Generate weekly PDF report
python weekly_report.py
python weekly_report.py --dry-run

# Email System (React Email + Resend)
cd emails && npm install           # Install dependencies (first time)
cd emails && npm run dev           # Preview emails in browser at localhost:3001
node emails/test-email.js          # Interactive test tool
node emails/send.js weekly-report --to you@example.com --weekEnding "January 5, 2026" --downloadLink "https://..."
node emails/send.js welcome --to you@example.com --firstName "John"
```

## Key Files

| File | Purpose |
|------|---------|
| `worker/worker.js` | All API endpoints - search, export, Stripe, user prefs, watchlist, SEO pages |
| `worker/wrangler.toml` | Worker deployment config with D1 database binding |
| `web/database.html` | Main database UI - search, filters, results table |
| `web/database.js` | Frontend search/filter logic, category mapping, watchlist toggle |
| `web/ttb-categories.js` | Shared TTB category/subcategory mapping (420 codes → 67 subcategories → 11 categories) |
| `web/account.html` | Pro user account page - preferences, watchlist management |
| `web/auth.js` | Stripe checkout, Pro user detection |
| `data/ttb-categories.json` | Master reference JSON for TTB code hierarchy |
| `scripts/weekly_update.py` | TTB scraper + D1 sync (main automation) |
| `scripts/weekly_report.py` | PDF report generator |
| `scripts/send_weekly_report.py` | Query D1 + send weekly email via Resend |
| `scripts/normalize_companies.py` | Company name normalization (fuzzy matching) |
| `scripts/batch_classify.py` | Batch classify historical records with signals + refile counts |
| `scripts/cola_worker.py` | Historical TTB scraper - scrapes by month, resume-safe, parallel-capable |
| `scripts/generate_sitemaps.py` | Generate static sitemaps and upload to R2 |
| `emails/send.js` | Resend email sender (CLI + API) |
| `emails/templates/*.jsx` | React Email templates (WeeklyReport, Welcome) |
| `scripts/src/email_sender.py` | Python wrapper for email system |

## Environment Variables

All secrets in GitHub Secrets (Actions) and local `.env`:

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts, Worker |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 API) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | send_weekly_report.py |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | send_weekly_report.py |
| `CLOUDFLARE_R2_BUCKET_NAME` | send_weekly_report.py |
| `CLOUDFLARE_R2_PUBLIC_URL` | send_weekly_report.py |
| `RESEND_API_KEY` | emails/send.js, scripts/src/email_sender.py |
| `FROM_EMAIL` | emails/send.js (optional, defaults to hello@bevalcintel.com) |
| `STRIPE_SECRET_KEY` | Worker (checkout/webhooks) |
| `STRIPE_PRICE_ID` | Worker (checkout) |

## Database Schema (D1)

**`colas`** table: 1M+ COLA records
- `ttb_id` (PK), `brand_name`, `fanciful_name`, `class_type_code`, `origin_code`, `approval_date`, `status`, `company_name`, `state`, `year`, `month`, `signal` (NEW_COMPANY/NEW_BRAND/NEW_SKU/REFILE), `refile_count` (number of subsequent refilings for first instances)

**`companies`** table: Normalized company entities (25,224 companies from 34,178 raw names)
- `id` (PK), `canonical_name`, `display_name`, `match_key`, `total_filings`, `variant_count`, `first_filing`, `last_filing`, `confidence`, `created_at`

**`company_aliases`** table: Maps raw company_name strings to normalized company IDs
- `id` (PK), `raw_name` (UNIQUE), `company_id` (FK → companies), `created_at`
- Use this to join colas.company_name to companies table

**`brands`** table: Brand entities (257K brands)
- `brand_key` (PK), `company_key`, `brand_name`, `brand_name_norm`, `first_seen_date`, `first_seen_ttb_id`, `filing_count`, `created_at`

**`brand_slugs`** table: Fast slug-to-brand lookup for SEO pages (240K entries)
- `slug` (PK), `brand_name`, `filing_count`
- Used by brand SEO pages for O(1) lookup instead of GROUP BY
- Auto-updated by `weekly_update.py` when new brands are synced to D1

**`user_preferences`** table: Pro user category subscriptions
- `email` (PK), `stripe_customer_id`, `is_pro`, `preferences_token`, `categories` (JSON array), `receive_free_report`

**`watchlist`** table: Pro user watchlist (brands/companies to track)
- `id` (PK), `email`, `type` (brand/company), `value`, `created_at`
- Unique constraint on (email, type, value)

```sql
-- Query filings by normalized company name
SELECT c.canonical_name, COUNT(*) as filings
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
GROUP BY c.id
ORDER BY filings DESC;
```

## Current State (Last Updated: 2026-01-08)

### What's Working
- [x] Frontend deployed on Netlify
- [x] D1 database with 1M+ records
- [x] Search/filter functionality with approval_date sorting
- [x] Pro user features (CSV export, watchlist storage + display)
- [x] GitHub Actions weekly update workflow (paths fixed)
- [x] Watchlist API endpoints (add/remove/check/counts)
- [x] React Email + Resend email system (replaces Loops)
- [x] Email templates: WeeklyReport, ProWeeklyReport, Welcome
- [x] Weekly report email with real D1 data (send_weekly_report.py)
- [x] Pro weekly report with watchlist matches, filing spikes, linked SEO pages
- [x] Company name normalization (34K → 25K companies, 26% reduction)
- [x] Programmatic SEO pages (~262K pages: 21K companies, 240K brands, categories)
- [x] Dynamic sitemap.xml (split into 10 files for Google 50k limit)
- [x] SEO page caching (1hr browser, 24hr edge)
- [x] Google Search Console sitemap submitted
- [x] Database modal links to brand/company SEO pages (open in new tab)
- [x] Brand slugs auto-updated by weekly_update.py (new brands get SEO pages automatically)
- [x] Pro email respects user category preferences (filters filings by subscribed categories)
- [x] Database URL filtering (?signal=NEW_BRAND,NEW_SKU&date_from=... populates filters on load)
- [x] Company SEO pages show "Filing Entity" column (actual TTB company_name vs normalized)
- [x] Signal classification for all historical records (NEW_COMPANY, NEW_BRAND, NEW_SKU, REFILE)
- [x] Refile count tracking - shows "(current)" or "(X refiles)" under signal badge
- [x] Company SEO pages show DBA names ("Also operates as: X, Y, Z")
- [x] Cascading Category/Subcategory filters (3-tier hierarchy: 11 categories, 67 subcategories, 420 TTB codes)
- [x] Company pages show filer location (city, state, zip from `state` column)
- [x] Database page renamed to "BevAlc Intel Database"
- [x] Signal badge displayed in modal header next to brand name
- [x] Robust company page slug matching (handles possessives, DBA compounds, all filings >= 1)
- [x] SEO page paywall (free users see blurred content with upgrade modal)
- [x] Mobile modal overflow fix (track pills don't bleed outside box)
- [ ] Scraping protection (rate limiting, bot detection)

### Known Issues
1. Welcome email not wired up - worker.js needs to call Resend after user signup

2. ~~SEO pages slow on first load~~ **FIXED** - now 0.1-0.3s:
   - Created `brand_slugs` table for fast brand lookups
   - Added indexes on `colas.company_name` and `colas.brand_name`
   - Removed slow related brands query (would need precomputed table)

3. Scraping vulnerability - all data accessible via SEO pages + sitemap
   - Consider: rate limiting SEO pages, limiting data shown, honeypot entries

### Programmatic SEO Pages (COMPLETED 2026-01-06)

**URL Structure:**
- `/company/[slug]` - Company pages (all companies with 1+ filings, ~25K)
- `/brand/[slug]` - Brand pages (240,605 pages with 1+ filings)
- `/category/[category]/[year]` - Category trend pages (~70 pages)

**Sitemap Structure** (split for Google's 50k URL limit):
- `/sitemap.xml` - Sitemap index pointing to child sitemaps
- `/sitemap-static.xml` - Static pages + category pages (~62 URLs)
- `/sitemap-companies.xml` - All company pages (~21k URLs)
- `/sitemap-brands-1.xml` through `/sitemap-brands-6.xml` - All brands (~240k URLs, ~45k per file)

**Sitemap Generation** (UPDATED 2026-01-07):
Sitemaps are pre-generated and stored in R2 for performance:
```bash
python scripts/generate_sitemaps.py              # Generate and upload to R2
python scripts/generate_sitemaps.py --dry-run    # Preview without upload
python scripts/generate_sitemaps.py --local      # Save locally only
```

The weekly GitHub Action automatically regenerates sitemaps after `weekly_update.py` runs, ensuring new brands get SEO pages indexed.

Sitemaps are served from R2 via the worker (`R2_SITEMAP_URL` constant). This avoids D1 query timeouts that occurred when generating 240K+ brand URLs dynamically.

**How SEO Pages Are Served:**
1. User visits `bevalcintel.com/company/diageo-americas-supply-inc`
2. Netlify receives request, checks `web/_redirects`
3. Redirect rule proxies to `bevalc-api.mac-rowan.workers.dev/company/...`
4. Cloudflare Worker renders HTML page with data from D1
5. Response returned to user (200 status, not a redirect)

**Features:**
- Server-rendered HTML matching existing site design
- JSON-LD structured data for Google (Organization with Brand array)
- Internal linking (company ↔ brand ↔ category)
- Breadcrumb navigation
- Category bar charts, filing timelines
- Related companies/brands sections
- Edge caching: `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400`

**Company Pages (Brand-Focused for SEO):**
- Title format: `[Company] Brands & Portfolio | BevAlc Intelligence`
- Meta description mentions top 5 brands by name
- Opening paragraph lists brand names in natural text
- JSON-LD includes top 10 brands as structured Brand objects
- Helps rank for searches like "Diageo brands" not just "Diageo COLA filings"

**Examples:**
- `/company/diageo-americas-supply-inc` - "Diageo Americas Supply, Inc. Brands & Portfolio"
- `/brand/crown-royal` - Filing timeline, products, related brands
- `/category/tequila/2025` - 3,562 filings, +4% YoY, top filers

**Google Search Console:**
- Site verified and sitemap submitted (2026-01-06)
- Sitemap URL: `https://bevalcintel.com/sitemap.xml`

### Pro Email Category Filtering (COMPLETED 2026-01-07)

Pro users can set category preferences in their account. The Pro weekly report now respects these:

**How it works:**
1. User saves preferences in `/account.html` → stored as JSON array in `user_preferences.categories`
2. `send_weekly_report.py` reads categories for each Pro user
3. `fetch_pro_metrics()` applies SQL filter to `notable_brands` and `new_filings` queries
4. Only filings matching subscribed categories are included in email

**SQL filtering:**
```python
# In send_weekly_report.py
if subscribed_categories:
    category_conditions = [get_category_sql_filter(cat) for cat in subscribed_categories]
    category_filter_sql = f"AND ({' OR '.join(category_conditions)})"
```

### Database URL Filtering (COMPLETED 2026-01-07)

The database page now supports URL parameters to pre-populate filters:

**Supported parameters:**
- `q` - Search query
- `category` - Category filter
- `origin` - Origin filter
- `status` - Status filter
- `date_from`, `date_to` - Date range
- `signal` - Signal filter (NEW_BRAND, NEW_SKU, NEW_COMPANY, REFILE - comma-separated)

**Example URLs:**
- `/database?signal=NEW_BRAND,NEW_SKU` - Show only new brands and SKUs
- `/database?date_from=2025-12-30&date_to=2026-01-05&signal=NEW_BRAND,NEW_SKU` - New filings from specific week
- `/database?q=whiskey&category=Whiskey` - Search with category filter

**Implementation:**
- `database.js` has `applyUrlFilters()` function that runs on page load
- `worker.js` `/api/search` endpoint accepts `signal` parameter
- Pro email "View new filings in database" button generates URL with date range + signal filter

### Company Page Filing Entity Column (COMPLETED 2026-01-07)

Company SEO pages now show a "Filing Entity" column instead of just the brand name. This clarifies which legal entity actually filed each COLA, since the same brand can be filed by different companies.

**Why this matters:**
- Diageo page shows brands like "Balcones" filed by "Balcones Distilling LLC" (subsidiary)
- Makes it clear when a brand is licensed vs owned vs acquired
- Avoids confusion like "Diageo and Balcones are the same company"

**Implementation:**
- Query joins `colas` with `company_aliases` to get `co.company_name as filing_entity`
- Added "Filing Entity" column to recent filings table on company pages

### Company Page DBA Names Display (COMPLETED 2026-01-07)

Company SEO pages now show DBA (doing-business-as) names in the header when a company files under multiple trade names.

**Background:**
TTB filings often use compound names like "WOLVERINE DISTILLING COMPANY, Stadium Beverage Company LLC" where:
- First part = DBA/trade name (Wolverine Distilling Company)
- Second part = Legal filing entity (Stadium Beverage Company LLC)

This caused confusion when brands from "different" companies appeared on the same page.

**Solution:**
Added "Also operates as:" line under company stats showing all DBA names:
```
Stadium Beverage Company Llc Brands & Portfolio
20+ Brands · 69 Total Filings · Since 04/04/2017
Also operates as: WOLVERINE DISTILLING COMPANY
```

**Implementation:**
- Query extracts DBA names from `company_aliases` where `raw_name` contains a comma
- Uses `ROW_NUMBER() OVER (PARTITION BY UPPER(...))` to dedupe case variations
- Limited to 10 DBAs max to keep header clean
- Only shows line if company has DBAs (most don't)

**SQL query:**
```sql
SELECT dba_name FROM (
    SELECT TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1)) as dba_name,
           ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1))) ORDER BY raw_name) as rn
    FROM company_aliases
    WHERE company_id = ? AND raw_name LIKE '%,%'
) WHERE rn = 1
ORDER BY dba_name
LIMIT 10
```

**Examples:**
- Stadium Beverage Company LLC → "Also operates as: WOLVERINE DISTILLING COMPANY"
- Diageo Americas Supply, Inc. → "Also operates as: Aviation American Gin, CASCADE HOLLOW DISTILLING CO., DON JULIO TEQUILA COMPANY, GEORGE A. DICKEL & CO., Guinness Taproom, THE JEREMIAH WEED CO."

### SEO Page Paywall (COMPLETED 2026-01-08)

Brand and company SEO pages now require Pro subscription to view full content. Free users see:
- Header with brand/company name visible
- Rest of page blurred (12px blur) with upgrade modal overlay
- "Unlock Full Access" button linking to pricing

**Access Control:**
- Uses `bevalc_pro=1` cookie (NOT `bevalc_access` which is set for ALL signups)
- Cookie only set when API confirms `status === 'pro'`
- Testing params: `?pro=grant` to unlock, `?pro=revoke` to lock

**CSS Implementation:**
```css
.seo-blur { filter: blur(8px) !important; user-select: none !important; pointer-events: none !important; }
.page-paywall .seo-blur { filter: blur(12px) !important; }
.page-paywall::before { /* Dark overlay */ }
```

**Important:** The CSS class is `seo-blur` (NOT `blur-content`) to avoid conflicts with `style.css` which has a different `.blur-content` class.

**Cache Headers:** Temporarily set to `no-store, no-cache, must-revalidate` to ensure paywall changes propagate. Should be restored to `public, max-age=3600, s-maxage=86400` after verification.

### Cascading Category/Subcategory Filters (COMPLETED 2026-01-07)

The database page now has a 3-tier filtering hierarchy: Category > Subcategory > TTB Code.

**Structure:**
- 11 Categories: Whiskey, Vodka, Tequila, Gin, Rum, Brandy, Wine, Beer, Liqueur, RTD/Cocktails, Other
- 67 Subcategories: e.g., Bourbon, Rye, Scotch, Irish Whiskey under Whiskey
- 420 TTB Codes: The raw TTB class_type_code values

**Files:**
- `data/ttb-categories.json` - Master reference JSON with all mappings
- `web/ttb-categories.js` - Shared JS module for frontend
- `worker/worker.js` - TTB_SUBCATEGORIES mapping for API filtering

**How It Works:**
1. User selects Category (e.g., "Whiskey") → Subcategory dropdown populates
2. User selects Subcategory (e.g., "Bourbon") → Frontend sends `?subcategory=Bourbon`
3. Worker converts subcategory to TTB codes via `getSubcategoryCodes()`
4. SQL: `WHERE class_type_code IN ('STRAIGHT BOURBON WHISKY', 'BOURBON WHISKY', ...)`

**API Parameter:**
```
GET /api/search?subcategory=Bourbon
GET /api/export?subcategory=Irish%20Whiskey
```

### Company Page Location Display (COMPLETED 2026-01-07)

Company SEO pages now show the filer location (city, state, zip) from the `state` column.

Format: `20+ Brands · 69 Total Filings · Since 04/04/2017 · 📍 NAPA, CA 94558`

The location is the most common filing address for the company based on their COLA records.

### Robust Company Page Slug Matching (COMPLETED 2026-01-07)

Company pages now work for ALL companies (>= 1 filing, not >= 3) with improved slug matching:

1. **Exact slug match** - Try `companies.slug = ?`
2. **Alias pattern match** - Search `company_aliases.raw_name` with LIKE pattern
3. **Direct colas search** - Search `colas.company_name` directly (fallback for non-normalized companies)

**Possessive handling:** Strips trailing 's' from slug terms to handle apostrophe-s names:
- Slug "kvasirs-mead-habanbilan" → Try pattern `%kvasir%mead%habanbilan%`
- Matches "Kvasir's Mead, HabanBilan Farm and Forest LLC"

### Company Name Normalization (COMPLETED 2026-01-06)

**Solution implemented:**
- Created `companies` table (25,224 normalized entities)
- Created `company_aliases` table (34,178 raw name → company_id mappings)
- Script: `scripts/normalize_companies.py` with fuzzy matching via `rapidfuzz`
- Compound name parsing extracts legal entities (e.g., "DON JULIO, DIAGEO INC" → DIAGEO INC)
- 26% reduction in duplicate companies

**Results:**
- Jackson Family Wines: 38 variants consolidated
- E. & J. Gallo Winery: 23 variants consolidated
- Foley Family Wines: 24 variants consolidated
- Major companies (Diageo, Constellation, Pernod) correctly identified as separate legal entities

**Usage:**
```bash
python scripts/normalize_companies.py --analyze   # Preview stats
python scripts/normalize_companies.py --export    # Export to JSON
python scripts/normalize_companies.py --apply     # Write to D1
```

**Next steps to fully integrate:**
1. Update `weekly_update.py` to normalize new companies on ingest
2. Update NEW_COMPANY signal classification to use normalized company_id

## Technical Notes

**D1 Batch Insert Limit**: SQLite has ~999 parameter limit. When inserting batches to D1, use inline SQL values instead of parameterized queries:
```python
# BAD - hits parameter limit with large batches
placeholders = ",".join(["(?,?,?,...)" for _ in records])
stmt.bind(all_values)

# GOOD - use inline escaped values
def escape_sql_value(value):
    if value is None: return "NULL"
    if isinstance(value, (int, float)): return str(value)
    return f"'{str(value).replace(chr(39), chr(39)+chr(39))}'"
```

**GitHub Actions Mode**: `weekly_update.py` detects if local `consolidated_colas.db` exists. On GHA (no local DB), it skips the merge step and reads directly from the temp scrape DB.

**COLA Classification System**: Records are classified in `classify_new_records()` after D1 insertion. **Uses normalized `company_id`** (via `company_aliases` table) to ensure company name variants are treated as the same company.

Priority order:
1. **NEW_COMPANY** (purple badge) - normalized `company_id` never seen before
2. **NEW_BRAND** (green badge) - Company exists, but `(company_id, brand_name)` never seen
3. **NEW_SKU** (blue badge) - Company+brand exists, but `(company_id, brand_name, fanciful_name)` never seen
4. **REFILE** (gray badge) - All three exist (re-filing of existing product)

**Why normalized company IDs matter**: The same company often files under variant names (e.g., "Estate Crush LLC" vs "Estate Crush, LLC"). Without normalization, each variant would get its own NEW_COMPANY/NEW_BRAND signals. The `company_aliases` table maps all variants to a single `company_id`, ensuring accurate classification.

The `signal` column is stored in D1 `colas` table, returned in search API, displayed in table, and included in CSV exports.

**Refile Count Tracking**: First-time filings (NEW_COMPANY, NEW_BRAND, NEW_SKU) also track how many times the SKU was subsequently refiled via `refile_count`. The database page shows:
- "(current)" under signal badge if `refile_count = 0` (no later refilings)
- "(X refiles)" under signal badge if `refile_count > 0` (X subsequent refilings exist)

This helps users understand if a "new" brand/SKU was later refiled or if it's still current.

**Batch Classification Script** (`scripts/batch_classify.py`): Script to classify all historical records. Processes records chronologically (oldest first) to correctly identify first-time filings. Uses normalized `company_id` via JOIN with `company_aliases`.
```bash
python batch_classify.py --analyze    # Check current state
python batch_classify.py --dry-run    # Preview changes
python batch_classify.py              # Run full classification
```

**Historical Classification Results** (Reclassified 2026-01-07 with normalized company IDs):
- Total records: 1,636,391
- NEW_COMPANY: 25,224 (1.5%)
- NEW_BRAND: 433,071 (26.5%)
- NEW_SKU: 501,705 (30.7%)
- REFILE: 676,391 (41.3%)
- SKUs with future refilings: 235,263

**Critical: Chronological Date Sorting**: The batch_classify.py script must process records in chronological order to correctly identify "first-time" filings. The ORDER BY clause uses:
```sql
ORDER BY COALESCE(year, 9999) ASC, COALESCE(month, 99) ASC,
         CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ASC, ttb_id ASC
```
Do NOT sort by `approval_date` string directly - it's MM/DD/YYYY format and sorts lexicographically wrong.

**Subcategory SQL Pattern Matching**: When using LIKE patterns for subcategory filtering, be careful with short strings. Example issue: `%PORT%` was matching "imPORTed" in whisky codes. Fixed by using `%/PORT/%` or exact matches to avoid false positives.

## UI Notes

**Database Table Columns**: TTB ID column was removed. Table now starts with Brand Name, followed by Fanciful Name, Class/Type, Origin, Approval Date, Status, Company, State.

**Watchlist Track Options**: When viewing a COLA detail modal, Pro users see "Track" pills for Brand and Company only. Subcategory and Keyword options were removed to keep it simple.

**Hero Email Form**: The top email signup form on index.html shows an inline confirmation message (same as footer form) instead of redirecting to a thank-you page.

**Database Modal Links**: When clicking a row in the database table, the modal now has clickable links:
- Brand name (modal title) → `/brand/[slug]` SEO page
- Company name → `/company/[slug]` SEO page
Uses `makeSlug()` function in database.js to generate URL slugs.

**Company SEO Pages**: Show "Filing Entity" column in recent filings table. This displays the actual `company_name` from the TTB record (e.g., "Balcones Distilling LLC") rather than just the normalized company name. Helps clarify when subsidiaries, licensees, or acquired brands file under different entities.

**Company SEO Page Stats Layout**: Stats are displayed on separate lines (not all in one line):
```
20+ Brands
69 Total Filings
Since 04/04/2017
📍 NAPA, CA 94558
Also operates as: ...
```

**Homepage Feature Text**:
- "New brands" feature does NOT say "(first-seen in your category)"
- "Top active companies/filers" does NOT say "this week"
- Pro feature says "CSV exports" (lowercase "exports", not "Full CSV export")

**Mobile Modal Fixes**: Track pills in database modals use `flex-direction: column` on mobile to prevent bleeding outside the modal box. Negative margins compensate for modal padding.

## Email System (React Email + Resend)

The email system uses React Email for templates and Resend for delivery. This replaces the previous Loops.so integration.

### Email Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EMAIL TRIGGERS & RECIPIENTS                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                                                       │
│  │ 1. WELCOME EMAIL │                                                       │
│  └────────┬─────────┘                                                       │
│           │                                                                  │
│   TRIGGER: User signs up via form on index.html                             │
│   WHO GETS IT: New subscriber (single email)                                │
│   WHEN: Immediately after signup                                            │
│   SENT BY: Worker (after creating user_preferences record)                  │
│   STATUS: Template ready, NOT YET WIRED UP to worker.js                     │
│                                                                              │
│  ┌─────────────────────────────┐                                            │
│  │ 2. FREE WEEKLY REPORT EMAIL │                                            │
│  └────────┬────────────────────┘                                            │
│           │                                                                  │
│   TRIGGER: GitHub Action cron (Saturdays 2pm UTC / 9am ET)                  │
│   WHO GETS IT: Free users where subscribed_free_report = 1                  │
│   WHEN: Every Saturday morning                                              │
│   SENT BY: scripts/send_weekly_report.py                                    │
│   STATUS: COMPLETE                                                          │
│                                                                              │
│  ┌────────────────────────────┐                                             │
│  │ 3. PRO WEEKLY REPORT EMAIL │                                             │
│  └────────┬───────────────────┘                                             │
│           │                                                                  │
│   TRIGGER: GitHub Action cron (Saturdays 2pm UTC / 9am ET)                  │
│   WHO GETS IT: Pro users where is_pro = 1                                   │
│   WHEN: Every Saturday morning                                              │
│   SENT BY: scripts/send_weekly_report.py                                    │
│   STATUS: COMPLETE - includes watchlist matches, filing spikes, etc.        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Email Templates

| Template | File | Trigger | Recipients |
|----------|------|---------|------------|
| Welcome | `emails/templates/Welcome.jsx` | User signup | Single new subscriber |
| WeeklyReport | `emails/templates/WeeklyReport.jsx` | Saturday cron job | Free subscribers |
| ProWeeklyReport | `emails/templates/ProWeeklyReport.jsx` | Saturday cron job | Pro subscribers |

#### WeeklyReport Template (Free Users)
The free weekly report is an embedded HTML email with:
- **Summary** - One-liner about the week's trends
- **Stat Tiles** - Total Filings, New Brands, New SKUs, New Companies, Top Filer
- **Category Breakdown** - CSS bar charts showing filings by category
- **Top Filing Companies** - Companies ranked by total filings this week
- **Top Brand Extensions** - Brands adding the most new SKUs this week
- **Pro Feature Preview** - Single COLA teaser to encourage upgrade
- **LOCKED Section** - Blurred "All New Brands & SKUs" table with upgrade CTA

#### ProWeeklyReport Template (Paid Users)
The Pro weekly report is a comprehensive data-rich email with:
- **Personalized Header** - User's name, Pro badge, watchlist count
- **Summary Stats** - 6 stat tiles including week-over-week trends
- **Watchlist Activity** - New filings from tracked brands/companies (teal highlight)
- **Category Breakdown** - Bar charts with links to category pages
- **Top Filers** - Companies with most filings + change vs 4-week average
- **Filing Spikes** - Companies with unusual activity (M&A signals, orange highlight)
- **Notable New Brands** - First-time brand filings with Filing Entity column (purple highlight)
- **All New Brands & SKUs** - Full table (unlocked) with signal badges and TTB links
- **"View new filings in database"** - Button links to database with date + signal filters pre-applied

All company and brand names are clickable links to their SEO pages:
- Company names → `/company/[slug]`
- Brand names → `/brand/[slug]`
- Categories → `/category/[category]/[year]`

Category color badges: Whiskey (amber), Tequila (green), Vodka (blue), Wine (pink), Beer (orange), RTD (indigo), Gin (cyan)

**Column widths:**
- Notable New Brands: Brand 40%, Company 45%, Category 50px
- Unusual Filing Activity: narrower numeric columns (55px each)
- Manage Preferences link goes to account page (unsubscribe button removed)

#### Data Source
`send_weekly_report.py` queries D1 for all metrics:
- **Base metrics** (both templates): total filings, new brands/SKUs, top companies, category breakdown
- **Pro metrics** (Pro only): watchlist matches, filing spikes vs 4-week average, full filings list

**Important:** The `ProWeeklyReport.defaultProps` now uses empty arrays `[]` for all data fields. This ensures no fake sample data appears when real data is missing. The `maxCategoryValue` calculation handles empty arrays gracefully.

### User Segments (from D1 `user_preferences` table)

| Segment | Query | Emails They Receive |
|---------|-------|---------------------|
| Free subscribers | `subscribed_free_report = 1 AND is_pro = 0` | Welcome, WeeklyReport |
| Pro users | `is_pro = 1` | Welcome, ProWeeklyReport (with watchlist data) |
| Unsubscribed | `subscribed_free_report = 0` | None |

### Integration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Email templates (JSX) | COMPLETE | WeeklyReport, ProWeeklyReport, Welcome |
| Resend API integration | COMPLETE | `emails/send.js` with lazy init |
| Python wrapper | COMPLETE | `scripts/src/email_sender.py` |
| send_weekly_report.py | COMPLETE | Sends WeeklyReport to free, ProWeeklyReport to Pro |
| Worker welcome email | NOT WIRED | Need to call Resend after signup in worker.js |

### Setup

```bash
cd emails
npm install                    # Install dependencies
```

Add to your `.env`:
```
RESEND_API_KEY=re_xxxxxxxx
FROM_EMAIL=BevAlc Intelligence <hello@bevalcintel.com>
```

### Testing Emails

```bash
cd emails
npm test                       # Interactive test tool
npm run dev                    # Preview in browser at localhost:3001

# Send specific templates
node test-email.js --email you@example.com --template weekly-report
node test-email.js --email you@example.com --template pro-weekly-report
node test-email.js --email you@example.com --template welcome
node test-email.js --email you@example.com --all    # Send all templates
```

### Sending Emails

**From Python (recommended for scripts):**
```python
from scripts.src.email_sender import send_weekly_report, send_welcome

# Welcome email
send_welcome(to="user@example.com", first_name="John")

# Weekly report
send_weekly_report(
    to="user@example.com",
    week_ending="January 5, 2026",
    download_link="https://...",
)
```

**From Node.js (for worker.js):**
```javascript
import { sendWelcome } from './emails/send.js';
await sendWelcome({ to: 'user@example.com', firstName: 'John' });
```

### Brand Colors (from style.css)

- Primary (teal): `#0d9488`
- Text: `#1e293b`
- Background: `#ffffff`
