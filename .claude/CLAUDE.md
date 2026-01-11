# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## How Everything Runs (Execution Flow)

This is the most important section. Read this first to understand how the system works.

### Scheduled Data Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WEEKLY CYCLE                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FRIDAY 9pm ET (GitHub Actions: weekly-update.yml)                      │
│  └─► weekly_update.py                                                   │
│       ├─► 1. Scrape last 14 days from TTB website                       │
│       ├─► 2. Insert records to D1 (colas table)                         │
│       ├─► 3. Add new brands to brand_slugs (for SEO pages)              │
│       ├─► 4. Add new companies to companies/company_aliases             │
│       └─► 5. Classify: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE       │
│                                                                         │
│  SATURDAY 9am ET (GitHub Actions: weekly-report.yml)                    │
│  └─► send_weekly_report.py                                              │
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
**Price**: $79/month (Pro subscription via Stripe)

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
│   ├── weekly-update.yml      # Friday 9pm: scrape + sync + classify
│   └── weekly-report.yml      # Saturday 9am: send emails
├── emails/
│   ├── send.js                # Send email via Resend
│   ├── test-email.js          # Test email tool
│   ├── components/Layout.jsx  # Shared email layout
│   └── templates/
│       ├── Welcome.jsx        # Signup confirmation
│       ├── WeeklyReport.jsx   # Free users
│       └── ProWeeklyReport.jsx # Pro users
├── scripts/
│   ├── lib/
│   │   ├── __init__.py
│   │   └── d1_utils.py        # SHARED: D1 operations (d1_execute, insert, etc.)
│   ├── weekly_update.py       # Main weekly scraper + D1 sync
│   ├── send_weekly_report.py  # Query D1 + send emails
│   ├── cola_worker.py         # Core scraping logic (Selenium)
│   ├── batch_classify.py      # Reclassify historical records
│   ├── normalize_companies.py # One-time: fuzzy match company names
│   └── generate_sitemaps.py   # Generate sitemaps → upload to R2
├── skills/                    # Claude skill definitions
├── templates/                 # LinkedIn post templates
├── web/
│   ├── index.html             # Landing page
│   ├── database.html          # Search page
│   ├── account.html           # User account/settings
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
| categories | TEXT | JSON array of preferred categories |
| enhancement_credits | INT | Purchased credits balance |
| monthly_enhancements_used | INT | (Unused - credits now purchased) |
| monthly_reset_date | TEXT | (Unused - credits now purchased) |

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
| news | TEXT | JSON array of {title, date, source} |
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

# Check user's credit balance
npx wrangler d1 execute bevalc-colas --remote --command "SELECT email, enhancement_credits FROM user_preferences WHERE email = 'user@example.com'"

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

**Main Command:** `/weekly-content` - Generates 4 LinkedIn posts from D1 data

**LinkedIn Content Types:**
1. **Weekly Intelligence Brief** (Monday 9am) - Filing stats, top filers
2. **Market Movers** (Wednesday 10am) - New market entrants
3. **Intent Signals** (Thursday 10am) - Filing velocity anomalies
4. **Category Analysis** (Friday 10am) - Category deep dive

**Output:** `scripts/content-queue/linkedin-drafts-YYYY-MM-DD.md`

**Tone:** Professional, data-forward, no emojis

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

**PDF Generation:** Company reports use html2pdf.js (not jsPDF). The report is built as HTML with inline styles, rendered in a hidden container, then converted to PDF. This gives full control over typography and layout.

---

## Session Management

**At END of session, Claude MUST:**
1. Update this CLAUDE.md if architecture changed
2. Update RUNBOOK.md if new procedures added
3. Offer to commit: `git add -A && git commit -m "..." && git push`

**At START of session, Claude SHOULD:**
1. Read this file to understand current state
2. Ask what the user wants to accomplish
