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
```

### Live System Architecture

```
USER REQUEST
     │
     ▼
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Netlify    │───▶│ Cloudflare Worker│───▶│  Cloudflare D1  │
│  (web/)     │    │  (worker.js)     │    │  (1.9M+ COLAs)  │
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
│     ├─► Call Claude Sonnet 4 with web_search tool (max 5 searches)      │
│     │   └─► Multi-strategy search: company name, brand name, industry   │
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

---

## Project Overview

BevAlc Intelligence is a B2B SaaS platform tracking TTB COLA filings (beverage alcohol label approvals). It provides a searchable database of 1.9M+ records with weekly email reports for subscribers.

**Live Site**: https://bevalcintel.com

**Pricing Tiers:**
- **Free**: Basic search, blurred signals, locked Pro features
- **Category Pro** ($29/month): Full access to ONE selected category
- **Premier** ($79/month): Full access to ALL categories

---

## Subscription Tier System

### Tier Behavior

| Feature | Free | Category Pro | Premier |
|---------|------|--------------|---------|
| Search database | Yes | Yes | Yes |
| View signals | No (blurred) | Own category only | All |
| CSV export | No | Own category only | All |
| Watchlist | No | Own category only | All |
| Company Intelligence | No | Own category only | All |
| Weekly email reports | Basic summary | Own category | All subscribed |

### Category Pro Specifics
- User selects ONE category (Whiskey, Vodka, Tequila, etc.)
- Can change category once per week (7-day cooldown)
- When category changes, watchlist is automatically cleared
- Signals/exports outside their category show same as Free tier
- Mobile badge shows "Pro", Premier shows "Premier"

### Tier Detection Flow
```
1. Frontend fetches /api/user/preferences?email=...
2. Response includes: { tier: "category_pro" | "premier", tier_category: "Whiskey" | null }
3. Frontend uses tier to show correct badge and unlock features
4. For Category Pro, hasRecordAccess checks if record's category matches tier_category
```

### Upgrade Path
- Category Pro → Premier: Uses /api/stripe/upgrade-subscription with prorated billing
- Stripe webhook updates tier in D1 database

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
│   └── e2e-tests.yml          # Manual: Playwright E2E tests
├── emails/
│   ├── send.js                # Send email via Resend
│   ├── test-email.js          # Test email tool
│   ├── components/Layout.jsx  # Shared email layout
│   └── templates/
│       ├── Welcome.jsx              # Signup confirmation
│       ├── WeeklyReport.jsx         # Free users
│       ├── ProWeeklyReport.jsx      # Premier users (all categories)
│       ├── CategoryProWeeklyReport.jsx  # Category Pro users (single category)
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
│   └── generate_sitemaps.py   # Generate sitemaps → upload to R2
├── skills/                    # Claude skill definitions
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

---

## Database Schema (Cloudflare D1)

### `colas` - 1.9M+ COLA records
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

### `companies` - Normalized company entities (~25K)
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

### `brand_slugs` - Fast lookup for SEO pages (~240K)
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
| tier | TEXT | "category_pro" or "premier" |
| tier_category | TEXT | Selected category for Category Pro users |
| category_changed_at | TEXT | ISO timestamp of last category change |
| categories | TEXT | JSON array of report categories (Premier) |
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

### `watchlist` - Pro user tracked items
| Column | Type | Notes |
|--------|------|-------|
| email | TEXT | User email |
| type | TEXT | "brand" or "company" |
| value | TEXT | The tracked name |

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

# Check user's subscription and tier
npx wrangler d1 execute bevalc-colas --remote --command "SELECT email, is_pro, tier, tier_category, category_changed_at, enhancement_credits FROM user_preferences WHERE email = 'user@example.com'"

# Reset category change cooldown (allow immediate category switch)
npx wrangler d1 execute bevalc-colas --remote --command "UPDATE user_preferences SET category_changed_at = NULL WHERE email = 'user@example.com'"

# Upgrade user to Premier tier
npx wrangler d1 execute bevalc-colas --remote --command "UPDATE user_preferences SET tier = 'premier' WHERE email = 'user@example.com'"

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
```

---

## Content Automation

See `CLAUDE-CONTENT.md` for full documentation.
See `.claude/agents/content-writer.md` for voice guide and verification procedures.

**Main Command:** `/weekly-content` - Generates 4 LinkedIn posts from D1 data

**LinkedIn Content Types:**
1. **Weekly Intelligence Brief** (Monday 9am) - Filing stats, top filers
2. **Market Movers** (Wednesday 10am) - New market entrants
3. **Intent Signals** (Thursday 10am) - Filing velocity anomalies
4. **Category Analysis** (Friday 10am) - Category deep dive

**Output:** `scripts/content-queue/linkedin-drafts-YYYY-MM-DD.md`

**Tone:** Professional, data-forward, no emojis

**MANDATORY: Data Verification Process**

Every content file must include verified data. The process:

1. **Run D1 queries FIRST** - Execute all required queries before writing
2. **Document calculations** - Show math for every percentage/comparison
3. **Include Raw Data Reference** - End every content file with queries + results
4. **Cross-reference claims** - Every number must trace to a query result

A single wrong number destroys credibility. See `content-writer.md` for detailed procedures.

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

**Tier Badge Display:** All pages (index.html, database.js, account.html, glossary.html, legal.html, success.html) check `data.tier` from the preferences API and show "Premier" or "Pro" badge accordingly. The comparison uses `.toLowerCase()` for case-insensitive matching.

**Category Change Behavior:** When a Category Pro user changes their selected category:
1. The `category_changed_at` timestamp is set (starts 7-day cooldown)
2. The user's watchlist is automatically cleared (old items aren't relevant)
3. The weekly report email will use the new category

**PDF Generation:** Company reports use jsPDF for precise control. The report uses coordinate-based positioning with:
- `textWithLink()` for clickable URLs (website, news articles)
- `splitTextToSize()` for text wrapping
- Category grouping (TTB subcodes → parent categories via `getCategoryName()`)
- Signal badges (NEW_COMPANY, NEW_BRAND, etc.)

**Enhancement API:** When user clicks Enhance from a brand modal:
- The clicked brand name is passed to `/api/enhance` (not just top-filing brand)
- Claude uses this brand name in search queries for better relevance
- Rate limit retry: 10s, 30s, 60s delays (max 3 attempts) for Claude API 429 errors

---

## Session Management

**At END of session, Claude MUST:**
1. Update this CLAUDE.md if architecture changed
2. Update RUNBOOK.md if new procedures added
3. Offer to commit: `git add -A && git commit -m "..." && git push`

**At START of session, Claude SHOULD:**
1. Read this file to understand current state
2. Ask what the user wants to accomplish
