# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## How Everything Runs (Execution Flow)

This is the most important section. Read this first to understand how the system works.

### Scheduled Data Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DAILY SCRAPE (9pm ET)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DAILY 9pm ET / 2am UTC (GitHub Actions: daily-sync.yml)                │
│  └─► weekly_update.py --days 7                                          │
│       ├─► 1. Scrape trailing 7 days from TTB website (rolling window)   │
│       ├─► 2. Insert records to D1 (INSERT OR IGNORE handles duplicates) │
│       ├─► 3. Add new brands to brand_slugs (for SEO pages)              │
│       ├─► 4. Add new companies to companies/company_aliases             │
│       └─► 5. Classify: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE       │
│                                                                         │
│  Uses ColaWorker for robust scraping (3 retries, CAPTCHA handling)      │
│                                                                         │
│  THEN: precompute_category_stats.py (refreshes hub page cache)          │
│       └─► Updates category_stats table with totals, top companies/brands│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         DAILY ALERTS (11:30am ET next day)              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DAILY 11:30am ET (GitHub Actions: watchlist-alerts.yml)                │
│  └─► send_watchlist_alerts.py --days 3                                  │
│       ├─► 1. Query D1 for records from last 3 days                      │
│       ├─► 2. Match against user watchlists (brands + companies)         │
│       ├─► 3. Filter out already-alerted (watchlist_alert_log table)     │
│       └─► 4. Send email alerts via Resend                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         WEEKLY REPORT (Friday 2pm ET)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FRIDAY 2pm ET / 7pm UTC (GitHub Actions: weekly-report.yml)                    │
│  └─► weekly_report.py → send_weekly_report.py                                              │
│       ├─► 1. Query D1 for week's stats                                  │
│       ├─► 2. Build email data (top filers, new brands, etc.)            │
│       └─► 3. Send emails via Resend (free + pro users)                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    WEEKLY PERMITS SYNC (Tuesday 6am ET)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TUESDAY 6am ET / 11am UTC (GitHub Actions: weekly-permits-sync.yml)    │
│  └─► sync_permits.py                                                    │
│       ├─► 1. Download TTB permits JSON (82K+ permits)                   │
│       ├─► 2. Match permits to existing companies via normalized names   │
│       ├─► 3. Insert/update permits table in D1                          │
│       └─► 4. Log stats (matched vs unmatched = potential leads)         │
│                                                                         │
│  Data source: https://www.ttb.gov/public-information/foia/list-of-permittees  │
│  Updated weekly by TTB (usually Mondays)                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    WEEKLY TTB STATISTICS SYNC (Wednesday 3am UTC)       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  WEDNESDAY 3am UTC / 10pm ET (GitHub Actions: ttb-statistics-sync.yml)  │
│  └─► sync_ttb_statistics.py                                             │
│       ├─► 1. Download monthly + yearly CSVs from TTB                    │
│       ├─► 2. Parse production data (proof gallons by category)          │
│       ├─► 3. Insert/update ttb_spirits_stats table in D1                │
│       └─► 4. Log sync status (last year/month available)                │
│                                                                         │
│  THEN: generate_spirits_articles.py --auto                              │
│       └─► Generates monthly recap + LinkedIn posts for new data         │
│                                                                         │
│  Data source: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics │
│  Updated monthly by TTB (45 days after month end)                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Live System Architecture

```
USER REQUEST
     │
     ▼
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Netlify    │───▶│ Cloudflare Worker│───▶│  Cloudflare D1  │
│  (web/)     │    │  (worker.js)     │    │  (2.6M+ COLAs)  │
└─────────────┘    └────────┬─────────┘    └─────────────────┘
                           │
                           ▼
                   ┌──────────────────┐
                   │    Stripe API    │
                   └──────────────────┘

REQUESTS HANDLED BY WORKER:
- /api/search → Query colas table, return results
- /api/checkout → Create Stripe checkout session
- /api/credits/checkout → Create checkout for credit pack purchase
- /api/enhance → AI-powered company enhancement (uses Claude + web search)
- /api/enhance/status → Check enhancement status / get cached result
- /api/credits → Get user's enhancement credit balance
- /api/company-lookup → Get company_id from company name
- /company/[slug] → SSR company page from D1
- /brand/[slug] → SSR brand page from D1
- /sitemap-*.xml → Proxy to R2 bucket
```

### On-Demand Enhancement System

```
USER CLICKS "ENHANCE"
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ENHANCEMENT FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Check credits (user needs purchased credits)                        │
│  2. Check cache (90-day TTL on enhancements)                           │
│  3. If not cached, run enhancement:                                     │
│     ├─► Query D1 for filing stats, brands, categories, recent filings   │
│     ├─► Google CSE for website discovery + deep crawl for social links      │
│     │   └─► Claude Sonnet 4 for summary generation + news validation   │
│     └─► Returns: website, summary, news (with URLs)                     │
│  4. Cache result in company_enhancements table                          │
│  5. Deduct 1 credit from user                                           │
│  6. Return tearsheet for display + PDF download (html2pdf.js)           │
│                                                                         │
│  Cost per enhancement: ~$0.20-0.35 (Claude API + up to 5 web searches)  │
│  Credit price: $1.67-2.00 per credit (sold in packs)                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Credit Purchase System

```
USER BUYS CREDITS
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CREDIT PURCHASE FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Credit Packs (defined in worker.js):                                   │
│  ├─► pack_10: 10 credits for $20 ($2.00/credit)                        │
│  └─► pack_25: 25 credits for $40 ($1.60/credit)                        │
│                                                                         │
│  Purchase Flow:                                                         │
│  1. User selects pack on account.html                                   │
│  2. Frontend calls POST /api/credits/checkout                           │
│  3. Worker creates Stripe checkout session with inline pricing          │
│     └─► Uses price_data (no pre-created Stripe price IDs needed)       │
│  4. User completes Stripe checkout                                      │
│  5. Stripe webhook (checkout.session.completed) fires                   │
│  6. Worker checks metadata.type === 'credit_purchase'                   │
│  7. Credits added to user_preferences.enhancement_credits               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Classification Logic

When records are synced, they get a `signal` classification:

```
FOR EACH NEW RECORD:
  │
  ├─► Company NOT in company_aliases?
  │   └─► signal = NEW_COMPANY
  │
  ├─► Company exists, but (company_id, brand_name) not seen?
  │   └─► signal = NEW_BRAND
  │
  ├─► Company+Brand exists, but (company_id, brand_name, fanciful_name) not seen?
  │   └─► signal = NEW_SKU
  │
  └─► All three exist?
      └─► signal = REFILE
```

**KNOWN ISSUE:** Classification happens at scrape time, not by chronological approval_date order. If records are scraped out of order, earlier filings may get wrong signals (e.g., 08/01 = NEW_SKU, 08/06 = NEW_BRAND when it should be reversed). Also, if a brand changes companies, it's marked NEW_BRAND again for the new company. **FIX PLANNED:** Bottom-up reclassification after full backfill to sort by approval_date first.

---

## Project Overview

BevAlc Intelligence is a B2B SaaS platform tracking TTB COLA filings (beverage alcohol label approvals). It provides a searchable database of 2.6M+ records with weekly email reports for subscribers.

**Live Site**: https://bevalcintel.com

**Pricing Tiers:**
- **Free**: Basic search, blurred signals, 2-month data delay
- **Pro** ($99/month): Full access to all categories, real-time data, CSV exports, watchlists

---

## Subscription Tier System

### Tier Behavior

| Feature | Free | Pro |
|---------|------|-----|
| Search database | Yes | Yes |
| View signals | No (blurred) | All |
| CSV export | No | Unlimited |
| Watchlist | No | Yes |
| Company Intelligence | No | Yes |
| Weekly email reports | Basic summary | Full reports |
| Data access | 2-month delay | Real-time |

### Tier Detection Flow
```
1. Frontend fetches /api/user/preferences?email=...
2. Response includes: { is_pro: true/false, tier: "pro" | null }
3. Frontend uses is_pro to show "Pro" badge and unlock features
4. Pro users have full access to all categories and features
```

---

## Folder Structure

```
bevalc-intelligence/
├── .claude/
│   ├── CLAUDE.md              # THIS FILE - project architecture
│   ├── CLAUDE-CONTENT.md      # Content automation (LinkedIn posts)
│   ├── agents/                # Content subagents
│   └── commands/              # Custom slash commands
├── .github/workflows/
│   ├── daily-sync.yml         # Daily 9pm ET: scrape TTB, sync to D1
│   ├── watchlist-alerts.yml    # Daily 11:30am ET: send watchlist alerts
│   ├── weekly-report.yml      # Friday 2pm ET: send weekly report emails
│   ├── weekly-permits-sync.yml # Tuesday 6am ET: sync TTB permits
│   └── e2e-tests.yml          # Manual: Playwright E2E tests
├── emails/
│   ├── send.js                # Send email via Resend
│   ├── test-email.js          # Test email tool
│   ├── components/Layout.jsx  # Shared email layout
│   └── templates/
│       ├── Welcome.jsx              # Signup confirmation
│       ├── WeeklyReport.jsx         # Free users
│       ├── ProWeeklyReport.jsx      # Pro users (all categories)
│       └── WatchlistAlert.jsx       # Watchlist match notifications
├── scripts/
│   ├── lib/
│   │   ├── __init__.py
│   │   └── d1_utils.py        # SHARED: D1 operations (d1_execute, insert, etc.)
│   ├── weekly_update.py       # Main weekly scraper + D1 sync
│   ├── send_weekly_report.py  # Query D1 + send weekly emails\n│   ├── send_watchlist_alerts.py # Match watchlists + send alerts\n│   ├── weekly_report.py       # Generate weekly report data
│   ├── cola_worker.py         # Core scraping logic (Selenium)
│   ├── batch_classify.py      # Reclassify historical records
│   ├── normalize_companies.py # One-time: fuzzy match company names
│   ├── sync_permits.py        # Weekly: sync TTB permits to D1
│   └── generate_sitemaps.py   # Generate sitemaps → upload to R2
├── skills/
│   ├── carousel/
│   │   ├── SKILL.md           # Carousel generation skill
│   │   ├── generate-carousel.js  # Main generator script
│   │   └── out/               # Generated PDFs (gitignored)
│   └── remotion/
│       ├── SKILL.md           # Video generation skill
│       ├── README.md          # Full documentation
│       └── bevalc-videos/     # Remotion project
│           ├── src/Root.tsx   # Video data + compositions
│           └── out/           # Rendered videos (gitignored)
├── templates/                 # LinkedIn post templates
├── web/
│   ├── index.html             # Landing page
│   ├── database.html          # Search page
│   ├── account.html           # User account/settings\n│   ├── preferences.html       # Email preferences page
│   ├── database.js            # Search UI logic
│   ├── auth.js                # Authentication
│   ├── ttb-categories.js      # Category dropdown data
│   └── style.css
├── worker/
│   ├── worker.js              # Cloudflare Worker (API + SSR pages)
│   └── wrangler.toml          # Worker configuration
├── data/
│   └── ttb-categories.json    # Master TTB code hierarchy
└── RUNBOOK.md                 # Operational procedures
```

---

## Key Scripts Explained

### `scripts/lib/d1_utils.py` (SHARED MODULE)
Common D1 operations used by both weekly_update.py and daily_sync.py:
- `d1_execute(sql, params)` - Execute SQL against D1 API
- `escape_sql_value(value)` - Escape values for inline SQL
- `d1_insert_batch(records)` - Batch insert COLA records
- `make_slug(text)` - Convert text to URL slug
- `update_brand_slugs(records)` - Add brands to brand_slugs table
- `add_new_companies(records)` - Add to companies/company_aliases tables
- `get_company_id(company_name)` - Lookup normalized company_id

### `scripts/weekly_update.py`
Main weekly pipeline. Run: `python weekly_update.py`
- Uses Selenium to scrape TTB website (last 14 days by default)
- Inserts records to D1 with INSERT OR IGNORE (handles duplicates)
- Classifies records (NEW_COMPANY/NEW_BRAND/NEW_SKU/REFILE)
- Outputs `logs/needs_enrichment.json` (brands needing websites)

### `scripts/send_weekly_report.py`
Sends weekly emails. Run: `python send_weekly_report.py`
- Queries D1 for week's statistics
- Renders React Email templates
- Sends via Resend API to free and pro users

### `scripts/cola_worker.py`
Core scraping class used by weekly_update.py:
- `ColaWorker` - Handles browser, CAPTCHA, pagination
- `process_date_range(start, end)` - Scrape a date range

### `scripts/precompute_category_stats.py`
Precomputes hub page stats to avoid slow GROUP BY queries on large categories:
- Runs after daily-sync in GitHub Actions
- Caches total filings, top 20 companies, top 20 brands per category
- Wine (1.88M records) and Beer (470K) were taking 13-17 seconds without cache
- With cache, all hub pages load in <1 second

### `scripts/sync_ttb_statistics.py`
Syncs TTB distilled spirits production statistics to D1:
- Downloads monthly and yearly CSVs from TTB website
- Parses production volumes, producer counts, withdrawals
- Inserts to `ttb_spirits_stats` table (INSERT OR REPLACE)
- Logs sync status to `ttb_stats_sync_log`

Run: `python sync_ttb_statistics.py` (full sync) or `--status` (check coverage)

### `scripts/generate_spirits_articles.py`
Generates analysis articles from TTB spirits statistics:
- `--auto` - Generate articles for latest available data
- `--monthly 2024 11` - Generate specific month recap
- `--yearly 2024` - Generate annual analysis
- `--category whisky` - Generate category deep dive
- `--linkedin` - Generate short LinkedIn post

Output: `scripts/content-queue/spirits-*.md`

---

## Database Schema (Cloudflare D1)

### `colas` - 2.6M+ COLA records
| Column | Type | Notes |
|--------|------|-------|
| ttb_id | TEXT | Primary key (unique TTB ID) |
| brand_name | TEXT | e.g., "JACK DANIELS" |
| fanciful_name | TEXT | e.g., "OLD NO. 7" |
| class_type_code | TEXT | TTB code like "BWN" |
| origin_code | TEXT | "D" domestic, "I" import |
| approval_date | TEXT | MM/DD/YYYY format |
| status | TEXT | "APPROVED", "SURRENDERED", etc. |
| company_name | TEXT | Raw name from TTB |
| state | TEXT | Company state |
| year | INT | From approval_date |
| month | INT | From approval_date |
| signal | TEXT | NEW_COMPANY, NEW_BRAND, NEW_SKU, REFILE |
| refile_count | INT | Number of refiles for this SKU |
| category | TEXT | Indexed: Whiskey, Vodka, Tequila, Rum, Gin, Brandy, Wine, Beer, Liqueur, Cocktails, Other |

### `companies` - Normalized company entities (~31K)
| Column | Type | Notes |
|--------|------|-------|
| id | INT | Primary key |
| canonical_name | TEXT | Normalized name |
| display_name | TEXT | Display name |
| slug | TEXT | URL slug |
| match_key | TEXT | Uppercase for matching |
| total_filings | INT | Count of filings |

### `company_aliases` - Maps raw names to normalized companies
| Column | Type | Notes |
|--------|------|-------|
| raw_name | TEXT | Exact name from TTB (unique) |
| company_id | INT | FK to companies.id |

### `brand_slugs` - Fast lookup for SEO pages (~350K)
| Column | Type | Notes |
|--------|------|-------|
| slug | TEXT | Primary key |
| brand_name | TEXT | Original brand name |
| filing_count | INT | (Note: may be stale) |

### `user_preferences` - Pro user settings
| Column | Type | Notes |
|--------|------|-------|
| email | TEXT | Primary key |
| stripe_customer_id | TEXT | Stripe customer ID |
| is_pro | INT | 1 if active subscription |
| tier | TEXT | "pro" for paid users |
| categories | TEXT | JSON array of report categories |
| receive_free_report | INT | 1 to receive free weekly summary |
| enhancement_credits | INT | Purchased credits balance |
| preferences_token | TEXT | Unique token for settings access |

### `company_enhancements` - Cached AI enhancement results
| Column | Type | Notes |
|--------|------|-------|
| company_id | INT | Primary key (FK to companies.id) |
| company_name | TEXT | Company display name |
| website_url | TEXT | Discovered website |
| website_confidence | TEXT | "high" or "medium" |
| filing_stats | TEXT | JSON: {total, first_filing, last_filing, last_12_months, trend} |
| distribution_states | TEXT | JSON array of state codes |
| brand_portfolio | TEXT | JSON array of {name, filings} |
| category_breakdown | TEXT | JSON: {CODE: count, ...} |
| summary | TEXT | AI-generated company summary |
| news | TEXT | JSON array of {title, date, source, url} |
| enhanced_at | TEXT | ISO timestamp |
| enhanced_by | TEXT | Email of user who triggered |
| expires_at | TEXT | Cache expiry (90 days from enhanced_at) |

### `enhancement_credits` - Credit transaction log
| Column | Type | Notes |
|--------|------|-------|
| id | INT | Primary key (auto-increment) |
| email | TEXT | User email |
| type | TEXT | 'purchase', 'used', 'expired' |
| amount | INT | Positive for grants, negative for usage |
| balance_after | INT | Balance after transaction |
| stripe_payment_id | TEXT | For purchases |
| company_id | INT | For usage (which company was enhanced) |
| created_at | TEXT | ISO timestamp |

### `category_stats` - Precomputed hub page stats
| Column | Type | Notes |
|--------|------|-------|
| category | TEXT | Primary key (Whiskey, Wine, etc.) |
| total_filings | INT | Total COLA count for category |
| week_filings | INT | Filings in last 7 days |
| month_new_companies | INT | New companies in last 30 days |
| top_companies | TEXT | JSON array of top 20 companies |
| top_brands | TEXT | JSON array of top 20 brands |
| updated_at | TEXT | ISO timestamp of last refresh |

### `watchlist` - Pro user tracked items
| Column | Type | Notes |
|--------|------|-------|
| email | TEXT | User email |
| type | TEXT | "brand" or "company" |
| value | TEXT | The tracked name |

### `permits` - TTB Federal Permits (~82K)
| Column | Type | Notes |
|--------|------|-------|
| permit_number | TEXT | Primary key (e.g., "CA-I-12345") |
| owner_name | TEXT | Legal entity name |
| operating_name | TEXT | DBA name |
| street | TEXT | Premises address |
| city | TEXT | City |
| state | TEXT | State code |
| zip | TEXT | ZIP code |
| county | TEXT | County (self-reported) |
| industry_type | TEXT | Importer, Wholesaler, Wine Producer, Distilled Spirits Plant |
| is_new | INT | 1 if issued in last 7 days |
| company_id | INT | FK to companies (matched via name) |
| first_seen_at | TEXT | When we first saw this permit |
| updated_at | TEXT | Last sync timestamp |

**Permit Stats (as of Jan 2026):**
- Total permits: 82,350
- Matched to COLA companies: 21,591 (26%)
- Unmatched (potential leads): 60,759 (74%)
- Importers without COLAs: 13,537
- Wine Producers without COLAs: 12,740
- Distilleries without COLAs: 2,963

### `ttb_spirits_stats` - TTB production statistics
| Column | Type | Notes |
|--------|------|-------|
| year | INT | Year of data |
| month | INT | Month (NULL for yearly aggregates) |
| statistical_group | TEXT | Category group (e.g., "1-Distilled Spirits Production") |
| statistical_detail | TEXT | Specific category (e.g., "1-Whisky") |
| count_ims | INT | Number of industry members reporting |
| value | INT | Volume (proof gallons, pounds, or count) |
| is_redacted | INT | 1 if data was suppressed by TTB |

Data source: TTB Distilled Spirits Statistics (2012-present)
Categories: Whisky, Vodka, Brandy, Rum, Gin, Cordials, Neutral Spirits

### `ttb_stats_sync_log` - Statistics sync history
| Column | Type | Notes |
|--------|------|-------|
| data_type | TEXT | 'monthly' or 'yearly' |
| records_synced | INT | Count of records inserted/updated |
| last_data_year | INT | Most recent year in data |
| last_data_month | INT | Most recent month (for monthly) |
| synced_at | TEXT | ISO timestamp |
| status | TEXT | 'success', 'error', 'partial' |

---

## Environment Variables

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts, Worker |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 API access) |
| `RESEND_API_KEY` | send_weekly_report.py, worker.js |
| `STRIPE_SECRET_KEY` | Worker (checkout, webhooks) |
| `STRIPE_PRICE_ID` | Worker (Pro subscription) |
| `ANTHROPIC_API_KEY` | Worker (enhancement web search) |

---

## Common Commands

```bash
# Deploy Cloudflare Worker
cd worker && npx wrangler deploy

# Test Worker locally
cd worker && npx wrangler dev

# Run weekly update manually
cd scripts
python weekly_update.py              # Full run (14 days)
python weekly_update.py --dry-run    # Preview only
python weekly_update.py --days 7     # Custom lookback

# Send weekly report manually
python send_weekly_report.py

# Email preview
cd emails && npm run dev             # Preview at localhost:3001

# Reclassify historical records (if needed)
python batch_classify.py

# Add enhancement credits to a user
npx wrangler d1 execute bevalc-colas --remote --command "UPDATE user_preferences SET enhancement_credits = enhancement_credits + 10 WHERE email = 'user@example.com'"

# Check user's subscription
npx wrangler d1 execute bevalc-colas --remote --command "SELECT email, is_pro, tier, enhancement_credits FROM user_preferences WHERE email = 'user@example.com'"

# Grant Pro access to a user
npx wrangler d1 execute bevalc-colas --remote --command "UPDATE user_preferences SET is_pro = 1, tier = 'pro' WHERE email = 'user@example.com'"

# Clear user's watchlist
npx wrangler d1 execute bevalc-colas --remote --command "DELETE FROM watchlist WHERE email = 'user@example.com'"

# View user's watchlist
npx wrangler d1 execute bevalc-colas --remote --command "SELECT * FROM watchlist WHERE email = 'user@example.com'"

# Clear enhancement cache for a company (force re-enhancement)
npx wrangler d1 execute bevalc-colas --remote --command "DELETE FROM company_enhancements WHERE company_id = 12345"

# Find company_id by name (for cache clearing)
npx wrangler d1 execute bevalc-colas --remote --command "SELECT company_id, company_name, website_url FROM company_enhancements WHERE company_name LIKE '%CompanyName%'"

# View all cached enhancements
npx wrangler d1 execute bevalc-colas --remote --command "SELECT company_id, company_name, website_url, enhanced_at FROM company_enhancements ORDER BY enhanced_at DESC LIMIT 20"

# TTB Statistics - sync and generate content
cd scripts
python sync_ttb_statistics.py              # Full sync (monthly + yearly)
python sync_ttb_statistics.py --status     # Check data coverage
python generate_spirits_articles.py --auto # Generate articles for latest data
python generate_spirits_articles.py --monthly 2024 11  # Specific month
python generate_spirits_articles.py --yearly 2024      # Annual analysis
```

---

## Content Automation

See `CLAUDE-CONTENT.md` for full documentation.
See `.claude/agents/content-writer.md` for voice guide and verification procedures.

**Main Command:** `/weekly-content` - Generates LinkedIn posts from D1 data

**Content Philosophy:**
- Focus on CREATION, not administration ("brands launched" not "filings submitted")
- Provide CONTEXT through multi-year trends and seasonal patterns
- Tell the STORY behind the data

**LinkedIn Content Types:**
1. **Weekly Intelligence Brief** (Monday 9am) - Brand creation summary, YoY context
2. **Market Movers** (Wednesday 10am) - New companies entering market
3. **Intent Signals** (Thursday 10am) - Brand launch velocity anomalies
4. **Category Analysis** (Friday 10am) - Multi-year category deep dive

**Output:** `scripts/content-queue/linkedin-drafts-YYYY-MM-DD.md`

**Tone:** Professional, data-forward, no emojis, no "filings" language

**MANDATORY: Data Verification Process**

Every content file must include verified data. The process:

1. **Run D1 queries FIRST** - Execute all required queries before writing
2. **Document calculations** - Show math for every percentage/comparison
3. **Include Raw Data Reference** - End every content file with queries + results
4. **Cross-reference claims** - Every number must trace to a query result

A single wrong number destroys credibility. See `content-writer.md` for detailed procedures.

---

## Video Generation (Remotion)

See `skills/remotion/README.md` for full documentation.

**Quick Commands:**
```bash
cd skills/remotion/bevalc-videos

# Preview in browser
npm run dev

# Render LinkedIn square video (RECOMMENDED)
npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4

# Output: skills/remotion/bevalc-videos/out/weekly-recap-square.mp4
```

**Available Formats:**
| Composition | Dimensions | Platform |
|-------------|------------|----------|
| `WeeklyRecapSquare` | 1080x1080 | LinkedIn feed (recommended) |
| `WeeklyRecap` | 1920x1080 | YouTube, presentations |
| `WeeklyRecapVertical` | 1080x1920 | Instagram Stories, TikTok |

**Video Content (6 scenes, ~18 seconds):**
1. TitleCard - Headline with date range
2. ComparisonCard - Current vs prior 2-week period
3. StatsGrid - New brands, companies, products
4. CategoryBreakdown - Horizontal bar chart
5. Leaderboard - Top launcher per category
6. EndCard - CTA to bevalcintel.com

**CRITICAL: Data must come from D1 queries - NEVER fabricate numbers.**

Update data in `skills/remotion/bevalc-videos/src/Root.tsx` before rendering.

---

## Carousel Generation (LinkedIn PDFs)

See `skills/carousel/SKILL.md` for full documentation.

**Quick Commands:**
```bash
cd skills/carousel

# Install dependencies (first time only)
npm install

# Generate with sample data
npm run generate:sample

# Generate with custom data.json
npm run generate

# Output: skills/carousel/out/carousel-YYYY-MM-DD.pdf
```

**Carousel Structure (6 slides, 1080x1080):**
1. Hook - Big headline: "X New Brands Launched"
2. Comparison - This week vs prior week with delta
3. Stats Grid - New companies, brands, products
4. Category Breakdown - Horizontal bar chart
5. Leaderboard - Top 5 brand launchers
6. CTA - "Track Brand Launches" + bevalcintel.com

**Data Format:** Same JSON structure as Remotion videos (see `skills/carousel/SKILL.md`)

**Design System:** Matches Remotion videos (dark navy bg, teal accent, Inter font)

**LinkedIn Upload:** Upload the PDF as a document post. LinkedIn converts it to a swipeable carousel.

---

## TTB Statistics Content

See `.claude/commands/spirits-report.md` for full documentation.

**Main Command:** `/spirits-report` - Generates articles from TTB production statistics

**Data Source:** TTB Distilled Spirits Statistics
- URL: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics
- Coverage: 2012 to present
- Update frequency: Monthly (45 days after month end)
- Sync schedule: Weekly (Wednesday 3am UTC via GitHub Action)

**Article Types:**
1. **Monthly Recap** - Production summary with YoY comparisons
2. **Annual Analysis** - Comprehensive year-end industry review
3. **Category Deep Dive** - Focused analysis on single category (whisky, vodka, etc.)
4. **LinkedIn Post** - Short-form social content

**Output:** `scripts/content-queue/spirits-*.md`

**Templates:** `templates/spirits-*.md`

**Writing Rules:**
- NO em dashes (use commas, periods, parentheses)
- NO AI phrases ("it's worth noting", "delve into", "landscape")
- Every paragraph must contain specific numbers
- All data from D1 queries, never fabricated
- Trade publication tone, not press release

---

## Programmatic SEO

**URLs:**
- `/company/[slug]` - Company pages (SSR from D1)
- `/brand/[slug]` - Brand pages (SSR from D1)
- `/category/[code]/[year]` - Category pages

**Sitemaps:** Pre-generated in R2:
- `/sitemap.xml` - Index
- `/sitemap-companies.xml` - All companies
- `/sitemap-brands-1.xml` through `-6.xml` - All brands (split for 50k limit)

**IMPORTANT:** Sitemaps are actively being indexed by Google. DO NOT change sitemap structure or URLs - they must remain stable.

**Paywall:** Pro content blurred for free users. Uses `bevalc_pro=1` cookie.
- Test: `?pro=grant` (enable) / `?pro=revoke` (disable)

---

## Technical Notes

**D1 Batch Insert:** Use inline SQL values, not parameterized queries (SQLite ~999 param limit). The `d1_insert_batch()` function handles this.

**TTB Date Fields:**
- `approval_date` - Original approval date (stored in record)
- "Date Completed" - When action was completed (search filter only)
- These are DIFFERENT. A 2018 label surrendered in 2026 keeps approval_date=2018.

**Company Normalization:** Raw company names are mapped to normalized `company_id` via `company_aliases` table. This handles "ABC Inc" vs "ABC Inc." as the same company.

**Tier Badge Display:** All pages (index.html, database.js, account.html, glossary.html, legal.html, success.html) check `data.is_pro` from the preferences API and show "Pro" badge for paid users.

**PDF Generation:** Company reports use jsPDF for precise control. The report uses coordinate-based positioning with:
- `textWithLink()` for clickable URLs (website, news articles)
- `splitTextToSize()` for text wrapping
- Category grouping (TTB subcodes → parent categories via `getCategoryName()`)
- Signal badges (NEW_COMPANY, NEW_BRAND, etc.)

**Enhancement API:** When user clicks Enhance from a brand modal:
- The clicked brand name is passed to `/api/enhance` (not just top-filing brand)
- Claude uses this brand name in search queries for better relevance
- Rate limit retry: 10s, 30s, 60s delays (max 3 attempts) for Claude API 429 errors

**Hub Page Caching:** Hub pages (e.g., /whiskey, /wine) are cached for 5 minutes (`max-age=300`). Stats come from `category_stats` table, updated by `precompute_category_stats.py` after each daily sync. If hub pages show stale data, wait 5 min or check if precompute ran.

**Date Parsing:** The `cola_worker.py` scraper parses `approval_date` (MM/DD/YYYY) into separate `year`, `month`, `day` columns for indexed date queries. All three must be populated for date-range queries to work.

---

## Session Management

**At END of session, Claude MUST:**
1. Update this CLAUDE.md if architecture changed
2. Update RUNBOOK.md if new procedures added
3. Offer to commit: `git add -A && git commit -m "..." && git push`

**At START of session, Claude SHOULD:**
1. Read this file to understand current state
2. Ask what the user wants to accomplish

---

## To-Do List

- [ ] Figure out a way to convince people they can steal business from competitors by monitoring established brands (competitive intelligence angle - track when competitors file new SKUs, line extensions, or enter new categories)

---

## Session Log (2026-01-26)

### Landing Page Conversion Optimization

**Expert Panel Review:** Ran the landing page through 10 simulated experts (Ogilvy, Nielsen, Wiebe, Laja, Krug, Cialdini, Ive, Patel, Dunford, Suellentrop). Initial average score: 78/100.

**Changes Made:**
1. **Hero Section:**
   - Updated subheadline: "Get immediate alerts when new brands, distilleries, wineries, and breweries enter the market. Close deals while competitors are still searching."
   - Changed CTA from "Access Our Data Free" to "See This Week's New Companies"
   - Added trust badges (Official TTB data, Updated daily, 20+ years history)
   - Added product preview card showing sample data with signal badges

2. **Messaging Updates:**
   - Replaced "filing" language with "labels/approvals" throughout (user preference)
   - Removed "scrape" - now says "ingest federal approval data daily"
   - Updated "How It Works" to 3 clear numbered steps with sophisticated language (signal engine, entity resolution, pattern detection)

3. **Pricing:**
   - Updated to $299/month (from $99)
   - Added value anchor: "One closed deal covers your entire year"

4. **ICP Targeting (Service Providers):**
   - Packaging & Label Printers
   - Compliance Consultants
   - Co-Packers & Bottlers
   - Creative & Branding Agencies
   - Brokers & Distributor Scouts
   - Flavor Houses & Ingredient Suppliers

5. **Mobile Optimization:**
   - Trust badges stack vertically on mobile
   - Hero CTA button text wraps properly
   - Use cases grid goes single-column on phones
   - Product preview card full-width with proper spacing

**Strategic Direction (from user's ChatGPT consultation):**
- Position as "BevAlc Launch Intelligence" not just a database
- Primary ICP: Service providers who profit from being early (not brands)
- Product roadmap: Signal Engine → Lead Engine → Pipeline Engine
- Key differentiator: "You compete with sales teams being late, not API access players"
