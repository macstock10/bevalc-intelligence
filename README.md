# BevAlc Intelligence

A B2B SaaS platform for beverage alcohol industry intelligence, powered by TTB COLA filing data.

**Live Site:** https://bevalcintel.com

## What It Does

BevAlc Intelligence tracks all TTB (Alcohol and Tobacco Tax and Trade Bureau) label approvals for alcoholic beverages in the United States. We provide:

- **Searchable database** of 2.4M+ COLA records
- **Competitive intelligence signals** (new companies, new brands, filing velocity)
- **Email alerts** when watched brands or companies file new labels
- **AI-powered company enhancement** with website discovery and news
- **SEO pages** for every company and brand

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Netlify   │────▶│ Cloudflare Worker│────▶│  Cloudflare D1  │
│   (web/)    │     │   (worker.js)    │     │  (2.4M+ COLAs)  │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Stripe  │  │  Resend  │  │  Claude  │
        │ Payments │  │  Emails  │  │    AI    │
        └──────────┘  └──────────┘  └──────────┘
```

## Data Pipeline

**Daily (9pm ET):** GitHub Actions runs weekly_update.py
- Scrapes trailing 7 days from TTB website
- Syncs to Cloudflare D1
- Classifies records: NEW_COMPANY → NEW_BRAND → NEW_SKU → REFILE

**Daily (11:30am ET):** Watchlist alerts sent to subscribers

**Friday (2pm ET):** Weekly report emails sent

## Project Structure

```
bevalc-intelligence/
├── .claude/              # Claude Code context and commands
│   ├── CLAUDE.md         # Main architecture doc (READ THIS FIRST)
│   ├── commands/         # Slash commands (/weekly-content, etc.)
│   └── agents/           # Content generation agents
├── .github/workflows/    # GitHub Actions (daily-sync, weekly-report)
├── emails/               # React Email templates
├── scripts/              # Python scraping and sync scripts
│   ├── weekly_update.py  # Main scraper + D1 sync
│   ├── cola_worker.py    # Core Selenium scraping logic
│   └── lib/d1_utils.py   # Shared D1 operations
├── web/                  # Static frontend (Netlify)
├── worker/               # Cloudflare Worker (API + SSR)
└── RUNBOOK.md            # Operational procedures
```

## Key Files

| File | Purpose |
|------|---------|
| .claude/CLAUDE.md | **Read this first** - full architecture docs |
| worker/worker.js | API endpoints + SSR company/brand pages |
| scripts/weekly_update.py | Daily scraper pipeline |
| RUNBOOK.md | How to deploy, rollback, troubleshoot |

## Quick Start

### Deploy Frontend
```bash
# Automatic on push to main via Netlify
```

### Deploy Worker
```bash
cd worker && npx wrangler deploy
```

### Run Scraper Manually
```bash
cd scripts
python weekly_update.py --days 7
```

### Preview Emails
```bash
cd emails && npm run dev
```

## Environment Variables

Required secrets (set in GitHub Actions and Cloudflare):

| Variable | Used For |
|----------|----------|
| CLOUDFLARE_ACCOUNT_ID | D1 database access |
| CLOUDFLARE_D1_DATABASE_ID | D1 database ID |
| CLOUDFLARE_API_TOKEN | Cloudflare API |
| RESEND_API_KEY | Email delivery |
| STRIPE_SECRET_KEY | Payment processing |
| ANTHROPIC_API_KEY | AI enhancement |

## Pricing Tiers

- **Free**: Basic search, blurred signals
- **Category Pro** ($29/mo): Full access to one category
- **Premier** ($79/mo): Full access to all categories

## Documentation

- **Architecture**: .claude/CLAUDE.md
- **Operations**: RUNBOOK.md
- **Content Automation**: .claude/CLAUDE-CONTENT.md

## License

Proprietary - All rights reserved.
