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
| Daily 11:30am ET | `send_watchlist_alerts.py` | Email alerts for watchlist matches |
| Friday 2pm ET | `send_weekly_report.py` | Weekly summary emails |
| Tuesday 6am ET | `sync_permits.py` | Sync 82K TTB permits |

### Signal Classification

```
NEW_COMPANY  → Company not seen before in our database
NEW_BRAND    → Company exists, but this brand name is new
NEW_SKU      → Company+Brand exists, but new product variant
REFILE       → All three exist (label update/renewal)
```

### Live Architecture

```
Netlify (web/) → Cloudflare Worker (worker.js) → Cloudflare D1 (2.6M+ COLAs)
                                ↓
                          Stripe API
```

**API Endpoints:**
- `/api/search` - Query database
- `/api/checkout` - Stripe checkout
- `/api/enhance` - AI company intelligence (uses credits)
- `/company/[slug]` - SSR company pages
- `/brand/[slug]` - SSR brand pages

---

## Database Schema (Cloudflare D1)

### Core Tables

**`colas`** - 2.6M+ label approval records
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

**`company_enhancements`** - Cached AI intelligence results
- `company_id` (PK), `website_url`, `summary`, `news`, `expires_at` (90-day TTL)

---

## Folder Structure

```
bevalc-intelligence/
├── .claude/CLAUDE.md        # THIS FILE
├── .github/workflows/       # GitHub Actions (daily-sync, alerts, reports)
├── emails/templates/        # React Email templates (Welcome, WeeklyReport, etc.)
├── scripts/
│   ├── lib/d1_utils.py      # Shared D1 operations
│   ├── weekly_update.py     # Main scraper
│   ├── send_weekly_report.py
│   ├── send_watchlist_alerts.py
│   └── sync_permits.py
├── web/                     # Frontend (Netlify)
│   ├── index.html           # Landing page
│   ├── database.html        # Search UI
│   └── account.html         # User settings
├── worker/
│   ├── worker.js            # Cloudflare Worker (API + SSR)
│   └── wrangler.toml
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
| `ANTHROPIC_API_KEY` | Company enhancement |

---

## Technical Notes

- **Company Normalization**: Raw TTB names mapped to `company_id` via `company_aliases`. Handles variants like "Name, Name LLC" by checking all comma-separated parts.
- **D1 Batch Insert**: Use inline SQL values, not parameterized queries (SQLite ~999 param limit)
- **Hub Page Caching**: Category pages cached 5 min via `category_stats` table
- **Programmatic SEO**: `/company/[slug]` and `/brand/[slug]` pages SSR from D1. Sitemaps in R2.

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

---

## Session Management

**At END of session**: Update this file if architecture changed, offer to commit.

**At START of session**: Read this file, ask what user wants to accomplish.
