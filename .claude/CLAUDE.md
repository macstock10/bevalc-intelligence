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

## Related Documentation

- **CLAUDE.md** (this file) - Project architecture, database schema, deployment
- **CLAUDE-CONTENT.md** - Content automation infrastructure (agents, commands, skills)
- **RUNBOOK.md** - Operational procedures, deployment, rollback

## Folder Structure

```
bevalc-intelligence/
├── .claude/
│   ├── CLAUDE.md, CLAUDE-CONTENT.md
│   ├── agents/                # 7 content automation subagents
│   └── commands/              # 5 custom slash commands
├── .github/workflows/         # weekly-update.yml, weekly-report.yml
├── emails/                    # React Email + Resend system
│   ├── send.js, test-email.js, index.js
│   ├── components/Layout.jsx
│   └── templates/             # WeeklyReport, ProWeeklyReport, Welcome
├── scripts/
│   ├── weekly_update.py       # TTB scraper + D1 sync
│   ├── weekly_report.py       # PDF report generator
│   ├── send_weekly_report.py  # Query D1 + send weekly email
│   ├── normalize_companies.py # Company name normalization
│   ├── generate_sitemaps.py   # Static sitemaps → R2
│   ├── batch_classify.py      # Batch classify historical records
│   ├── cola_worker.py         # Historical TTB scraper (by month)
│   ├── content-automation/    # PowerShell automation
│   └── src/email_sender.py    # Python wrapper for email
├── skills/                    # Claude skill definitions
├── templates/                 # Content templates
├── reference/                 # Reference documentation
├── web/                       # Frontend (Netlify)
│   ├── index.html, database.html, account.html
│   ├── database.js, ttb-categories.js, auth.js, style.css
│   └── _redirects, robots.txt
├── worker/                    # Cloudflare Worker
│   ├── worker.js
│   └── wrangler.toml
├── data/ttb-categories.json   # Master TTB code hierarchy
└── RUNBOOK.md
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Static Site    │────▶│ Cloudflare Worker│────▶│  Cloudflare D1  │
│  (Netlify)      │     │  (API Gateway)   │     │  (1M+ COLAs)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │    Stripe API    │
                        └──────────────────┘

GitHub Actions (Weekly): weekly_update.py → weekly_report.py → send_weekly_report.py
```

### Data Flow

1. **Weekly Update** (Fridays 9pm ET): Scrape TTB → sync to D1 → classify records
2. **Weekly Report** (Saturdays 9am ET): Query D1 → generate PDF → send via Resend
3. **API Layer** (`worker.js`): Search, filters, CSV export, Stripe, user prefs, watchlist, SEO pages
4. **Frontend** (`web/`): Static HTML/JS → API calls to Worker

### Key Integration Points

- **Stripe Webhooks**: `checkout.session.completed` → creates `user_preferences` in D1
- **Category Mapping**: `TTB_CODE_CATEGORIES` shared between worker.js and database.js
- **Email System**: React Email templates sent via Resend API

## Common Commands

```bash
# Deploy Cloudflare Worker
cd worker && npx wrangler deploy

# Test Worker locally
cd worker && npx wrangler dev

# Python scripts (use venv)
cd scripts && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt
python weekly_update.py              # Full run
python weekly_update.py --dry-run    # Preview
python weekly_report.py

# Email System
cd emails && npm install && npm run dev    # Preview at localhost:3001
node emails/test-email.js                  # Interactive test tool
```

## Environment Variables

| Variable | Used By |
|----------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | All scripts, Worker |
| `CLOUDFLARE_D1_DATABASE_ID` | All scripts |
| `CLOUDFLARE_API_TOKEN` | Scripts (D1 API) |
| `CLOUDFLARE_R2_*` | send_weekly_report.py (bucket access) |
| `RESEND_API_KEY` | emails/send.js, email_sender.py |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` | Worker |

## Database Schema (D1)

**`colas`** - 1M+ COLA records
- `ttb_id` (PK), `brand_name`, `fanciful_name`, `class_type_code`, `origin_code`, `approval_date`, `status`, `company_name`, `state`, `year`, `month`, `signal`, `refile_count`

**`companies`** - Normalized entities (25K from 34K raw names)
- `id`, `canonical_name`, `display_name`, `match_key`, `total_filings`, `variant_count`, `first_filing`, `last_filing`

**`company_aliases`** - Maps raw `company_name` → `company_id`
- `raw_name` (UNIQUE), `company_id` (FK → companies)

**`brands`** - Brand entities (257K)
- `brand_key`, `company_key`, `brand_name`, `first_seen_date`, `filing_count`

**`brand_slugs`** - Fast slug lookup for SEO (240K)
- `slug` (PK), `brand_name`, `filing_count`

**`user_preferences`** - Pro user settings
- `email` (PK), `stripe_customer_id`, `is_pro`, `categories` (JSON), `receive_free_report`

**`watchlist`** - Pro user tracked items
- `email`, `type` (brand/company), `value`

```sql
-- Query filings by normalized company
SELECT c.canonical_name, COUNT(*) as filings
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
GROUP BY c.id ORDER BY filings DESC;
```

## Content Automation

See `CLAUDE-CONTENT.md` for full documentation.

**Quick commands:**
- `/weekly-content` - Full pipeline
- `/company-spotlight <company>` - Company content
- `/trend-report <category>` - Category trends
- `/absurd-story` - Creative story from data
- `/scan-news` - Industry news scan

## Current State (Last Updated: 2026-01-08)

### Working Features
- Frontend on Netlify, D1 with 1M+ records
- Search/filter with category/subcategory cascading (11→67→420 codes)
- Pro features: CSV export, watchlist, category preferences
- React Email + Resend (WeeklyReport, ProWeeklyReport, Welcome)
- Company normalization (26% reduction via fuzzy matching)
- Programmatic SEO (~262K pages: companies, brands, categories)
- Signal classification (NEW_COMPANY/NEW_BRAND/NEW_SKU/REFILE) + refile counts
- SEO page paywall (blur + upgrade modal for free users)
- Database URL filtering (?signal=, ?date_from=, etc.)

### Known Issues
1. Scraping vulnerability - data accessible via SEO pages + sitemap
   - Consider: rate limiting, limiting data shown, honeypot entries

## Programmatic SEO Pages

**URLs:** `/company/[slug]`, `/brand/[slug]`, `/category/[category]/[year]`

**Sitemap:** Pre-generated in R2, split for Google's 50k limit:
- `/sitemap.xml` → index pointing to child sitemaps
- `/sitemap-static.xml`, `/sitemap-companies.xml`, `/sitemap-brands-1.xml` through `-6.xml`

**How served:** Netlify `_redirects` proxies to Worker → renders HTML from D1

**Features:** JSON-LD structured data, internal linking, edge caching (1hr browser, 24hr edge)

**Company pages:** Show brands, DBA names ("Also operates as:"), filing entity column, location

**Paywall:** Uses `bevalc_pro=1` cookie. Test with `?pro=grant` / `?pro=revoke`

## Technical Notes

**D1 Batch Insert Limit**: Use inline SQL values, not parameterized queries (SQLite ~999 param limit)

**COLA Classification**: Uses normalized `company_id` via `company_aliases` table:
1. NEW_COMPANY - `company_id` never seen
2. NEW_BRAND - company exists, `(company_id, brand_name)` never seen
3. NEW_SKU - company+brand exists, `(company_id, brand_name, fanciful_name)` never seen
4. REFILE - all three exist

**Chronological sorting** for batch_classify.py:
```sql
ORDER BY COALESCE(year, 9999) ASC, COALESCE(month, 99) ASC,
         CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ASC, ttb_id ASC
```
Do NOT sort by `approval_date` string (MM/DD/YYYY sorts wrong lexicographically).

**Subcategory filtering**: Use exact TTB code matching via `TTB_CODE_TO_CATEGORY`, not LIKE patterns.

## UI Notes

- Database table: Brand Name, Fanciful Name, Class/Type, Origin, Approval Date, Status, Company, State
- Modal links: Brand → `/brand/[slug]`, Company → `/company/[slug]`
- Track pills: Brand and Company only (Subcategory/Keyword removed)
- Mobile: Track pills use `flex-direction: column` to prevent overflow

## Email System

**Templates** (`emails/templates/`):
- `Welcome.jsx` - Triggered on signup (sent by worker.js)
- `WeeklyReport.jsx` - Free users (Saturday cron)
- `ProWeeklyReport.jsx` - Pro users with watchlist, spikes, full data

**User segments** (from `user_preferences`):
- Free: `subscribed_free_report = 1 AND is_pro = 0`
- Pro: `is_pro = 1`

**Testing:**
```bash
cd emails && npm run dev           # Preview at localhost:3001
node test-email.js --email x@x.com --template weekly-report
```

**Sending:**
```python
from scripts.src.email_sender import send_weekly_report, send_welcome
send_welcome(to="user@example.com", first_name="John")
```

**Brand colors:** Primary teal `#0d9488`, Text `#1e293b`
