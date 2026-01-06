# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Management

**At the END of every working session, Claude MUST:**
1. Update this CLAUDE.md with any new files, features, or architecture changes
2. Update PROJECT_MAP.md if folder structure changed
3. Update RUNBOOK.md if new procedures were added
4. Commit changes with message "Update context docs after [brief description]"

**At the START of every session, Claude SHOULD:**
1. Read this file, PROJECT_MAP.md, and RUNBOOK.md
2. Ask what the user wants to accomplish
3. Reference these docs to understand current state

---

## Project Overview

BevAlc Intelligence is a B2B SaaS platform tracking TTB COLA filings (beverage alcohol label approvals). It provides a searchable database of 1M+ records with weekly email reports for subscribers.

**Live Site**: https://bevalcintel.com
**GitHub**: https://github.com/macstock10/bevalc-intelligence

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

# Manual TTB scraping (older CLI approach)
python -m src.cli scrape --days 7
python -m src.cli resume  # Resume interrupted scrape
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
│  │                 │   │                 │   │   Loops.so     │ │
│  └─────────────────┘   └─────────────────┘   └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **TTB Scraping** (`weekly_update.py`): Uses Selenium to scrape TTB COLA website, stores in local SQLite, syncs to Cloudflare D1
2. **API Layer** (`worker/worker.js`): Cloudflare Worker handles all API requests - search, filters, Stripe checkout/webhooks, user preferences
3. **Frontend** (`web/`): Static HTML/JS makes API calls to Worker, handles auth state via localStorage
4. **Reports** (`weekly_report.py`): Queries D1, generates PDF with ReportLab/Matplotlib, uploads to R2, sends via Loops

### Key Integration Points

- **Stripe Webhooks**: Worker receives `checkout.session.completed` → creates `user_preferences` record in D1 → syncs to Loops
- **Category Mapping**: Both `worker.js` and `database.js` share `TTB_CODE_CATEGORIES` mapping (TTB codes → categories like Whiskey, Vodka)
- **D1 Sync**: `weekly_update.py` uses INSERT OR IGNORE for deduplication, classifies records as NEW_BRAND/NEW_SKU/REFILE

## Key Files

| File | Purpose |
|------|---------|
| `worker/worker.js` | All API endpoints - search, export, Stripe, user prefs, watchlist |
| `worker/wrangler.toml` | Worker deployment config with D1 database binding |
| `web/database.js` | Frontend search/filter logic, category mapping, watchlist toggle |
| `web/database.html` | Main database UI - search, filters, results table |
| `web/account.html` | Pro user account page - preferences, watchlist management |
| `web/auth.js` | Stripe checkout, Pro user detection |
| `scripts/weekly_update.py` | TTB scraper + D1 sync (main automation) |
| `scripts/weekly_report.py` | PDF report generator |
| `scripts/send_weekly_report.py` | R2 upload + Loops email |

## Environment Variables

All secrets in GitHub Secrets (Actions) and local `.env`:

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts, Worker |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 API) |
| `CLOUDFLARE_R2_*` | send_weekly_report.py |
| `LOOPS_API_KEY` | Worker (sync), send_weekly_report.py |
| `STRIPE_SECRET_KEY` | Worker (checkout/webhooks) |
| `STRIPE_PRICE_ID` | Worker (checkout) |

## Database Schema (D1)

**`colas`** table: 1M+ COLA records
- `ttb_id` (PK), `brand_name`, `fanciful_name`, `class_type_code`, `origin_code`, `approval_date`, `status`, `company_name`, `state`, `year`, `month`, `signal` (NEW_BRAND/NEW_SKU/REFILE)

**`user_preferences`** table: Pro user category subscriptions
- `email` (PK), `stripe_customer_id`, `is_pro`, `preferences_token`, `categories` (JSON array), `receive_free_report`

**`watchlist`** table: Pro user watchlist (brands/companies to track)
- `id` (PK), `email`, `type` (brand/company), `value`, `created_at`
- Unique constraint on (email, type, value)

```sql
-- Create watchlist table (run via wrangler d1 execute)
CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email, type, value)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_email ON watchlist(email);
CREATE INDEX IF NOT EXISTS idx_watchlist_type_value ON watchlist(type, value);
```

## Current State (Last Updated: 2026-01-05)

### What's Working
- [x] Frontend deployed on Netlify
- [x] D1 database with 1M+ records
- [x] Search/filter functionality with approval_date sorting
- [x] Pro user features (CSV export, watchlist storage + display)
- [x] GitHub Actions weekly update workflow (paths fixed)
- [x] Watchlist API endpoints (add/remove/check/counts)
- [x] Watchlist syncs to Loops.so (watchlist_items contact property)
- [ ] Weekly report automation (not yet tested)
- [ ] Watchlist email alerts (needs Loops template + weekly_update.py logic)

### Known Issues
1. Weekly report workflow not yet tested
2. Need to verify R2 upload and Loops email sending work in Actions
3. Watchlist email alerts not implemented - requires:
   - Loops transactional email template for alerts
   - Logic in weekly_update.py to check new COLAs against watchlists
   - Send alerts via Loops API

### Technical Notes

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

## UI Notes

**Database Table Columns**: TTB ID column was removed. Table now starts with Brand Name, followed by Fanciful Name, Class/Type, Origin, Approval Date, Status, Company, State.

**Watchlist Track Options**: When viewing a COLA detail modal, Pro users see "Track" pills for Brand and Company only. Subcategory and Keyword options were removed to keep it simple.

**Hero Email Form**: The top email signup form on index.html shows an inline confirmation message (same as footer form) instead of redirecting to a thank-you page.
