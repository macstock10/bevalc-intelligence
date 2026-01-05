# BevAlc Intelligence - Claude Code Context

## What This Is
B2B SaaS platform tracking TTB COLA filings (1M+ beverage label records) to generate leads for beverage industry suppliers. Pro tier offers CSV exports, watchlists, and automated weekly PDF reports.

## Tech Stack
- **Frontend**: Static HTML/CSS/JS in `/web` → deployed via Netlify
- **Backend**: Cloudflare Worker → D1 database + R2 storage
- **Scripts**: Python in `/scripts` → run via GitHub Actions (scheduled)
- **Email**: Loops.so for transactional emails

## Architecture
```
User → Netlify (static site) → Cloudflare Worker API → D1 database
                                                    → R2 (PDF storage)

GitHub Actions (scheduled):
  weekly_update.py    → scrapes TTB, updates D1
  weekly_report.py    → generates PDF reports → uploads to R2  
  send_weekly_report.py → sends emails via Loops
```

## Key Files
- `/web/` - Frontend HTML/JS/CSS
- `/worker/` - Cloudflare Worker source (deploy via Wrangler)
- `/scripts/` - Python automation scripts
- `/scripts/requirements.txt` - Python dependencies

## Environment Variables (stored in GitHub Secrets)
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_D1_DATABASE_ID  
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_R2_ACCESS_KEY_ID
- CLOUDFLARE_R2_SECRET_ACCESS_KEY
- CLOUDFLARE_R2_BUCKET_NAME
- CLOUDFLARE_R2_PUBLIC_URL
- LOOPS_API_KEY
- LOOPS_TRANSACTIONAL_ID

## Deployment
- **Frontend**: Push to `main` → Netlify auto-deploys from `/web`
- **Worker**: Run `npx wrangler deploy` from `/worker`
- **Scripts**: GitHub Actions runs on schedule (no manual deploy)

## Constraints
- No breaking changes to Pro user features (CSV export, watchlists, reports)
- All changes via git - no Cloudflare dashboard pastes
- Scripts must work with relative paths (no hardcoded C:\ paths)

## Current Priorities
- [Update as needed]
