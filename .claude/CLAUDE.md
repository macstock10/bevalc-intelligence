# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## Current State (March 2026)

**Status: Cost reduction mode.** No customers. Pivoting distribution model.

- **Cloudflare Worker**: DISABLED. Was causing $2,000+/month in D1 charges from unindexed queries amplified by crawler/bot traffic (2+ trillion rows read/month). Do NOT re-enable without adding Cache API caching first.
- **Netlify frontend**: Still serves static HTML but all dynamic features (search, auth, Stripe, SSR pages) are broken without the worker.
- **Data pipeline**: Still running (free). Database stays current with daily TTB scrapes and weekly permit syncs.
- **Paid workflows**: All disabled (cron schedules commented out). Can be triggered manually from GitHub Actions UI.

---

## What This Product Is

**BevAlc Intelligence** is a B2B SaaS platform that helps service providers find new beverage alcohol companies before their competitors do.

**Live Site**: https://bevalcintel.com (static pages only — worker disabled)

### Key Insight

NEW_COMPANY signal in COLAs doesn't mean they're a new business. They may have existed for years with a permit but just now submitted their first COLA. Service providers care about "new to market" activity regardless of company age.

---

## How Everything Runs

### Data Pipeline

| Schedule | Script | What It Does | Cost |
|----------|--------|--------------|------|
| Daily 9pm ET | `weekly_update.py --days 7` | Scrape TTB, sync to D1, classify signals | **Free** |
| Tuesday 6am ET | `sync_permits.py` | Sync 82K TTB permits | **Free** |

### Disabled Workflows (manual dispatch only)

| Workflow | Script | Why Disabled | Cost When Running |
|----------|--------|--------------|-------------------|
| Post-Scrape Images | `backfill_images.py` | Chained — dispatch commented out in daily-sync.yml | Free (R2 storage) |
| Post-Scrape OCR | `run_ocr.py` | Chained from images | ~$1.50/run (Google Cloud Vision) |
| Post-Scrape Enrichment | `run_enrichment.py` | Chained from OCR | ~$0.25-5/run (Anthropic Haiku) |
| Watchlist Alerts | `send_watchlist_alerts.py` | No subscribers | Resend email costs |
| Weekly Report | `send_weekly_report.py` | No subscribers | Resend email costs |
| SEC RAG Sync | `scripts/sec-rag/ingest.ts` | No users | OpenAI + Cohere API |
| TTB Statistics Sync | `sync_ttb_statistics.py` | No users | Anthropic API |
| E2E Tests | Playwright | Worker disabled | Free |

**To re-enable the pipeline chain:** Uncomment the dispatch block in `daily-sync.yml` (line ~112). The chain resumes: Images → OCR → Enrichment automatically.

### Pipeline Architecture

Scripts talk directly to D1 via Cloudflare REST API (`d1_utils.py`). They do NOT need the worker. The worker only serves the web frontend.

```
GitHub Actions → Cloudflare D1 REST API (via CLOUDFLARE_API_TOKEN)
                 Cloudflare R2 (via R2 access keys)
                 External APIs (TTB, Anthropic, Google, OpenAI, etc.)
```

### Signal Classification

```
NEW_COMPANY  → Company not seen before in our database
NEW_BRAND    → Company exists, but this brand name is new
NEW_SKU      → Company+Brand exists, but new product variant
REFILE       → All three exist (label update/renewal)
```

---

## Database Schema (Cloudflare D1)

**Database**: `bevalc-colas` (377c1210-aca8-43a8-b575-7fc2f7e31616)
**Size**: 2.49 GB, ~2.8M+ COLA records, 38 tables

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

**`permits`** - 82K TTB federal permits
- `permit_number` (PK), `owner_name`, `operating_name`, `street`, `city`, `state`
- `company_id` (FK when matched - 26% match rate)

**`user_preferences`** - Pro user settings
- `email` (PK), `is_pro`, `tier`, `enhancement_credits`, `stripe_customer_id`

**`company_enrichments`** - Cached AI company intelligence (50+ columns)
- `company_id` (PK), `website`, `brief`, `industry`, `employee_count`, `expires_at` (90-day TTL)

### Querying Data Directly

```bash
# Ad-hoc queries against remote D1 (free — reads are within 25B free tier)
cd worker && npx wrangler d1 execute bevalc-colas --remote --command "SELECT company_name, brand_name, signal, approval_date FROM colas WHERE signal = 'NEW_COMPANY' ORDER BY year DESC, month DESC, day DESC LIMIT 10"

# Count records
cd worker && npx wrangler d1 execute bevalc-colas --remote --command "SELECT COUNT(*) FROM colas"
```

---

## Folder Structure

```
bevalc-intelligence/
├── .claude/CLAUDE.md        # THIS FILE
├── .github/workflows/       # GitHub Actions (most disabled — see above)
├── emails/templates/        # React Email templates
├── scripts/
│   ├── lib/
│   │   ├── d1_utils.py      # Shared D1 operations (REST API, not worker)
│   │   ├── sec_edgar.py     # SEC EDGAR API client
│   │   └── sec_parser.py    # Filing section parser
│   ├── weekly_update.py     # Main TTB scraper (ACTIVE)
│   ├── sync_permits.py      # TTB permits (ACTIVE)
│   ├── backfill_images.py   # Label images (DISABLED)
│   ├── run_ocr.py           # Google Cloud Vision (DISABLED)
│   ├── run_enrichment.py    # Claude Haiku enrichment (DISABLED)
│   ├── send_weekly_report.py    # (DISABLED)
│   ├── send_watchlist_alerts.py # (DISABLED)
│   └── sec_*.py             # SEC pipeline (DISABLED)
├── web/                     # Frontend on Netlify (static only)
│   ├── index.html           # Landing page
│   ├── database.html        # Search UI (broken — no worker)
│   ├── research.html        # SEC Research (broken — no worker)
│   └── account.html         # User settings (broken — no worker)
├── worker/
│   ├── worker.js            # Cloudflare Worker — DISABLED
│   ├── sec_research.js      # SEC Research handlers
│   ├── enrichment/          # 10 enrichment modules
│   └── wrangler.toml
└── RUNBOOK.md               # Operational procedures
```

---

## Common Commands

```bash
# Query D1 directly (free)
cd worker && npx wrangler d1 execute bevalc-colas --remote --command "YOUR SQL HERE"

# Manual scrape (if needed)
python scripts/weekly_update.py --days 7

# Deploy worker (DO NOT do this without adding Cache API first!)
# cd worker && npx wrangler deploy

# Test worker locally (safe — uses local D1, costs nothing)
cd worker && npx wrangler dev

# Run any disabled workflow manually from GitHub Actions UI
# Or: gh workflow run "Post-Scrape Images" -f limit="1000"

# Apply D1 migration
cd worker && npx wrangler d1 execute bevalc-colas --remote --file=../scripts/migrations/NNN.sql
```

---

## Environment Variables

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 REST API) |
| `RESEND_API_KEY` | Email sending (disabled) |
| `STRIPE_SECRET_KEY` | Worker (disabled) |
| `ANTHROPIC_API_KEY` | Enrichment (disabled) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | OCR (disabled) |
| `OPENAI_API_KEY` | SEC RAG (disabled) |
| `COHERE_API_KEY` | SEC RAG (disabled) |

---

## Technical Notes

- **D1 Cost Lesson**: Unindexed queries on the 2.8M-row `colas` table + crawler traffic = 2+ trillion rows read/month = $2,000+. The worker has ~500 SELECT statements, many doing full table scans. Before re-enabling the worker, MUST add: (1) Cloudflare Cache API to cache all GET responses, (2) indexes for remaining full-scan queries.
- **D1 CPU Limit**: Pipeline queries MUST filter `year >= 2026` to avoid scanning 2.8M rows. Full-table scans hit D1's CPU time limit (429 error).
- **D1 Free Tier**: 25B rows read, 50M rows written, 5GB storage. Current usage is well within limits with worker disabled.
- **Company Normalization**: Raw TTB names mapped to `company_id` via `company_aliases`. Handles variants like "Name, Name LLC" by checking all comma-separated parts.
- **D1 Batch Insert**: Use inline SQL values, not parameterized queries (SQLite ~999 param limit)

---

## Key Decisions (Historical Context)

**Cost Crisis (Mar 2026)**: D1 bill hit $2,100/month from crawler traffic hitting unindexed SSR queries. Disabled worker entirely. Pipeline continues via D1 REST API. Pivoting distribution model.

**ICP Pivot (Jan 2026)**: Shifted from "database for everyone" to specifically targeting service providers who sell to brands. They have urgent need (find prospects early) and clear ROI (one deal covers subscription).

**Pricing**: $99/month for Pro. Value anchor: "One closed deal covers your entire year."

---

## Before Re-enabling the Worker

If you decide to bring the website back online, these are REQUIRED first:

1. **Add Cloudflare Cache API** — Wrap the entire `fetch()` handler so all GET requests are cached for 1+ hour. This alone would cut 500K daily requests to a few hundred cache misses.
2. **Add missing indexes** — Many queries on `colas` do full table scans. Need EXPLAIN QUERY PLAN audit + CREATE INDEX for all SCAN TABLE results.
3. **Consider removing pSEO pages** — 371K SSR pages (company, brand, location, comparison, best, glossary) are the primary target of crawler traffic. If SEO isn't a priority, remove them entirely.
4. **Add aggressive bot management** — robots.txt crawl-delay, rate limiting per IP.

---

## Session Management

**At END of session**: Update this file if architecture changed, offer to commit.

**At START of session**: Read this file, ask what user wants to accomplish.
