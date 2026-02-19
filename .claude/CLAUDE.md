# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## What This Product Is

**BevAlc Intelligence** is a B2B SaaS platform that helps service providers find new beverage alcohol companies before their competitors do.

**Live Site**: https://bevalcintel.com

### Target ICP (Service Providers)

Our customers are businesses that sell to beverage brands. They use our data to find new prospects early:

- **Packaging & Label Printers** - Need to reach brands before they finalize label designs
- **Compliance Consultants** - Help new brands navigate TTB regulations
- **Co-Packers & Bottlers** - Production capacity for brands without facilities
- **Creative & Branding Agencies** - Design, marketing for launch
- **Brokers & Distributor Scouts** - Finding new products to represent
- **Flavor Houses & Ingredient Suppliers** - Sell to producers

**Value Proposition**: "Get immediate alerts when new brands, distilleries, wineries, and breweries enter the market. Close deals while competitors are still searching."

### Pricing

- **Free**: Basic search, blurred signals, 2-month data delay
- **Pro** ($99/month): Real-time data, signal access, CSV exports, watchlists, company intelligence

### Key Insight

NEW_COMPANY signal in COLAs doesn't mean they're a new business. They may have existed for years with a permit but just now submitted their first COLA. Service providers care about "new to market" activity regardless of company age.

---

## How Everything Runs

### Data Pipeline (Automated)

| Schedule | Script | What It Does |
|----------|--------|--------------|
| Daily 9pm ET | `weekly_update.py --days 7` | Scrape TTB, sync to D1, classify signals |
| ↳ chained | `backfill_images.py` | Download label images → R2 (limit 1000) |
| ↳ chained | `run_ocr.py` | Google Cloud Vision OCR on images (limit 1000) |
| ↳ chained | `run_enrichment.py` | Claude Haiku LLM enrichment (limit 1000, 2026+ only) |
| Daily 11:30am ET | `send_watchlist_alerts.py` | Email alerts for watchlist matches |
| Friday 2pm ET | `send_weekly_report.py` | Weekly summary emails |
| Tuesday 6am ET | `sync_permits.py` | Sync 82K TTB permits |
| Weekdays 10am/2pm/6pm ET | `sec_ingest_filings.py` | Poll SEC EDGAR for new filings |
| Saturday 10am ET | `sec_compute_mda_diffs.py` | Compute MD&A year-over-year diffs |

### Signal Classification

```
NEW_COMPANY  → Company not seen before in our database
NEW_BRAND    → Company exists, but this brand name is new
NEW_SKU      → Company+Brand exists, but new product variant
REFILE       → All three exist (label update/renewal)
```

### Live Architecture

```
Netlify (web/) → Cloudflare Worker (worker.js) → Cloudflare D1 (2.8M+ COLAs)
                                ↓
                          Stripe API
```

**API Endpoints:**
- `/api/search` - Query database
- `/api/checkout` - Stripe checkout
- `/api/enrich-company` - AI company intelligence (uses credits)
- `/api/sec/*` - SEC Research endpoints (filings, 8-K events, RAG query, MD&A diffs)
- `/company/[slug]` - SSR company pages
- `/brand/[slug]` - SSR brand pages

---

## Database Schema (Cloudflare D1)

### Core Tables

**`colas`** - 2.8M+ label approval records (38 enrichment columns added via migration 010)
- `ttb_id` (PK), `brand_name`, `fanciful_name`, `company_name`, `state`
- `approval_date`, `year`, `month`, `day`
- `signal` (NEW_COMPANY/NEW_BRAND/NEW_SKU/REFILE)
- `category` (Whiskey, Vodka, Wine, Beer, etc.)

**`companies`** - ~31K normalized companies
- `id` (PK), `canonical_name`, `display_name`, `slug`, `total_filings`

**`company_aliases`** - Maps raw TTB names → company_id
- Handles "ABC Inc" vs "ABC Inc." as same company

**`user_preferences`** - Pro user settings
- `email` (PK), `is_pro`, `tier`, `enhancement_credits`, `stripe_customer_id`

**`watchlist`** - Pro user tracked items
- `email`, `type` (brand/company), `value`

**`permits`** - 82K TTB federal permits
- `permit_number` (PK), `owner_name`, `operating_name`, `street`, `city`, `state`
- `company_id` (FK when matched - 26% match rate)

**`company_enrichments`** - Cached AI company intelligence (50+ columns)
- `company_id` (PK), `website`, `brief`, `industry`, `employee_count`, `expires_at` (90-day TTL)

**`company_contacts`** - Enriched company contacts (multi-row per company)
- `id` (PK), `company_id` (FK), `full_name`, `title`, `email`, `linkedin_url`

**`email_verification_codes`** - Magic code login
- `email` (PK), `code_hash`, `expires_at`, `attempts`, `send_count`, `send_window_start`

### SEC Research Tables

**`sec_companies`** - Tracked public beverage alcohol companies
- `id`, `ticker`, `cik`, `company_name`, `company_id` (FK)

**`sec_filings`** - Individual SEC filings (10-K, 10-Q, 8-K)
- `id`, `sec_company_id`, `accession_number`, `filing_type`, `filing_date`
- `fiscal_year`, `fiscal_quarter`, `edgar_url`, `processing_status`

**`sec_filing_sections`** - Parsed sections (MD&A, Risk Factors, etc.)
- `id`, `filing_id`, `section_type`, `content`, `content_hash`

**`sec_filing_chunks`** - RAG chunks for vector search
- `id`, `filing_id`, `section_id`, `chunk_index`, `content`, `vector_id`

**`sec_8k_events`** - Parsed material events from 8-K filings
- `id`, `filing_id`, `item_number`, `headline`, `summary`, `priority`

**`sec_mda_diffs`** - MD&A comparison results
- `id`, `current_filing_id`, `previous_filing_id`, `ai_summary`, `boilerplate_score`

---

## Folder Structure

```
bevalc-intelligence/
├── .claude/CLAUDE.md        # THIS FILE
├── .github/workflows/       # GitHub Actions (daily-sync, alerts, reports)
├── emails/templates/        # React Email templates (Welcome, WeeklyReport, etc.)
├── scripts/
│   ├── lib/
│   │   ├── d1_utils.py      # Shared D1 operations
│   │   ├── sec_edgar.py     # SEC EDGAR API client
│   │   └── sec_parser.py    # Filing section parser
│   ├── weekly_update.py     # Main TTB scraper
│   ├── send_weekly_report.py
│   ├── send_watchlist_alerts.py
│   ├── sync_permits.py
│   ├── sec_ingest_filings.py    # SEC filing ingestion
│   ├── sec_process_8k.py        # 8-K event extraction
│   ├── sec_embed_chunks.py      # Vector embeddings
│   └── sec_compute_mda_diffs.py # MD&A diff engine
├── web/                     # Frontend (Netlify)
│   ├── index.html           # Landing page
│   ├── database.html        # Search UI
│   ├── research.html        # SEC Research (8-K events, RAG, MD&A diffs)
│   └── account.html         # User settings
├── worker/
�   +-- worker.js            # Cloudflare Worker (API + SSR, router)
�   +-- sec_research.js       # SEC Research handlers + RAG pipeline
�   +-- wrangler.toml
└── RUNBOOK.md               # Operational procedures
```

---

## Common Commands

```bash
# Deploy worker
cd worker && npx wrangler deploy

# Test locally
cd worker && npx wrangler dev

# Manual scrape
python scripts/weekly_update.py --days 7

# Grant Pro access
npx wrangler d1 execute bevalc-colas --remote --command "UPDATE user_preferences SET is_pro = 1, tier = 'pro' WHERE email = 'user@example.com'"

# Check user
npx wrangler d1 execute bevalc-colas --remote --command "SELECT * FROM user_preferences WHERE email = 'user@example.com'"

# SEC Research: Sync SEC filings (sec-rag pipeline)
cd scripts/sec-rag && npx tsx ingest.ts --incremental

# SEC Research: Backfill SEC filings
cd scripts/sec-rag && npx tsx ingest.ts --backfill

# NOTE: /api/sec/generate-embeddings is deprecated (legacy pipeline)

# SEC Research: Compute MD&A diffs
python scripts/sec_compute_mda_diffs.py --company BF.B

# Apply SEC schema migration
npx wrangler d1 execute bevalc-colas --remote --file=../scripts/migrations/003_sec_filings_schema.sql
```

---

## Environment Variables

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 API) |
| `RESEND_API_KEY` | Email sending |
| `STRIPE_SECRET_KEY` | Worker |
| `ANTHROPIC_API_KEY` | COLA enrichment (Haiku), company brief (Haiku), SEC RAG (Sonnet) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | OCR pipeline (Google Cloud Vision) |
| `VERIFICATION_CODE_PEPPER` | Auth code hashing |

---

## Technical Notes

- **Company Normalization**: Raw TTB names mapped to `company_id` via `company_aliases`. Handles variants like "Name, Name LLC" by checking all comma-separated parts.
- **D1 Batch Insert**: Use inline SQL values, not parameterized queries (SQLite ~999 param limit)
- **D1 CPU Limit**: Pipeline queries MUST filter `year >= 2026` to avoid scanning 2.8M rows. Full-table scans hit D1's CPU time limit (429 error). The `idx_colas_ymd` index makes year-filtered queries fast.
- **Hub Page Caching**: Category pages cached 5 min via `category_stats` table
- **Programmatic SEO**: `/company/[slug]` and `/brand/[slug]` pages SSR from D1. Sitemaps in R2.
- **Auth**: Client-side only (localStorage + cookies). No server-side sessions. Database page has magic code login (6-digit email verification) for cross-device access. Backend: `/api/auth/send-code`, `/api/auth/verify-code`.

---

## Key Decisions (Historical Context)

**ICP Pivot (Jan 2026)**: Shifted from "database for everyone" to specifically targeting service providers who sell to brands. They have urgent need (find prospects early) and clear ROI (one deal covers subscription).

**Pricing**: $99/month for Pro. Value anchor: "One closed deal covers your entire year."

**Lead Enrichment**: No budget for expensive APIs (Clearbit, Apollo). Solution: "User does final click" pattern - provide Google/LinkedIn search links, surface permit data when matched. 74% of permits are unmatched = potential leads for us to surface.

**Signals Language**: Avoid "filings" - use "brands launched," "new companies," "market activity." Focus on CREATION not administration.

**Company Name Matching**: Added variant matching (Jan 2026) to handle comma-separated names like "Big Ditch Brewing Company, Big Ditch Brewing Company LLC" - checks all parts against existing aliases.

---

## To-Do

- [ ] Add search links to company modal (Google, Maps, LinkedIn) - "user does final click"
- [ ] Surface permit data in company modal when match exists
- [ ] Competitive intelligence angle - track when competitors file new SKUs
- [ ] Upgrade SEC RAG model from Sonnet 4 to Sonnet 4.6 (same price, better quality)
- [ ] Top up Anthropic API credits (enrichment pipeline blocked since ~2/17)

---

## Session Management

**At END of session**: Update this file if architecture changed, offer to commit.

**At START of session**: Read this file, ask what user wants to accomplish.
