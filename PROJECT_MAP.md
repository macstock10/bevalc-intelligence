# BevAlc Intelligence - Project Map

## Architecture Overview
```
User Browser
     �
     ?
+-------------+     +------------------+
�   Netlify   �     �  Cloudflare D1   �
�  (web/)     �----?�  (1M+ records)   �
+-------------+     +------------------+
                            �
                            ?
                    +------------------+
                    �  Cloudflare R2   �
                    �  (PDF storage)   �
                    +------------------+
                            �
                            ?
                    +------------------+
                    �    Loops.so      �
                    �  (Email sends)   �
                    +------------------+

GitHub Actions (Weekly):
  weekly_update.py ? Scrapes TTB ? Updates D1
  weekly_report.py ? Queries D1 ? Generates PDF ? Uploads to R2
  send_weekly_report.py ? Queries D1 subscribers ? Sends via Loops
```

## Folder Structure
```
bevalc-intelligence/
+-- .claude/                 # Claude Code context
�   +-- CLAUDE.md
+-- .github/
�   +-- workflows/
�       +-- weekly-update.yml    # Scrapes TTB, updates D1
�       +-- weekly-report.yml    # Generates + sends reports
+-- scripts/
�   +-- requirements.txt
�   +-- weekly_update.py         # TTB scraper + D1 sync
�   +-- weekly_report.py         # PDF report generator
�   +-- send_weekly_report.py    # R2 upload + email send
�   +-- src/                     # Shared modules
+-- web/                         # Frontend (Netlify)
�   +-- index.html
�   +-- database.html
�   +-- database.js
�   +-- auth.js
�   +-- style.css
�   +-- worker.js                # Copy of Cloudflare Worker
+-- worker/                      # Cloudflare Worker source
�   +-- worker.js
�   +-- wrangler.toml             # Worker deployment config
+-- data/                        # Local only (gitignored)
+-- reports/                     # Generated reports (gitignored)
+-- logs/                        # Script logs (gitignored)
+-- .env                         # Secrets (gitignored)
+-- .gitignore
+-- netlify.toml
+-- PROJECT_MAP.md               # This file
+-- RUNBOOK.md                   # Operations guide
```

## Data Flow

### Weekly Update (Sunday 2am UTC)
1. `weekly_update.py` scrapes last 14 days from TTB
2. New COLAs saved to local SQLite (data/consolidated_colas.db)
3. New records synced to Cloudflare D1
4. Records classified as NEW_BRAND / NEW_SKU / REFILE

### Weekly Report (Sunday 4am UTC)
1. `weekly_report.py` queries D1 for all historical data
2. Computes metrics (unique SKUs, new brands, etc.)
3. Generates PDF with charts and tables
4. Saves to reports/{date}/bevalc_weekly_snapshot_{date}.pdf

### Report Distribution (Sunday 4:30am UTC)
1. `send_weekly_report.py` finds latest PDF
2. Uploads to Cloudflare R2
3. Queries D1 for subscribers (subscribed_free_report = 1)
4. Sends email via Loops with PDF link

## Key Files

| File | Purpose |
|------|---------|
| `web/database.js` | Frontend search/filter logic, watchlist toggle |
| `web/account.html` | Pro user account page, watchlist display |
| `web/auth.js` | Stripe + user auth |
| `worker/worker.js` | API endpoints (search, export, watchlist, Stripe) |
| `worker/wrangler.toml` | Worker deployment config with D1 binding |
| `scripts/weekly_update.py` | TTB scraper + D1 sync |
| `scripts/weekly_report.py` | PDF generator |

## Environment Variables

Required in `.env` (local) or GitHub Secrets:

| Variable | Used By |
|----------|---------|
| CLOUDFLARE_ACCOUNT_ID | All scripts |
| CLOUDFLARE_D1_DATABASE_ID | All scripts |
| CLOUDFLARE_API_TOKEN | All scripts |
| CLOUDFLARE_R2_ACCESS_KEY_ID | send_weekly_report.py |
| CLOUDFLARE_R2_SECRET_ACCESS_KEY | send_weekly_report.py |
| CLOUDFLARE_R2_BUCKET_NAME | send_weekly_report.py |
| CLOUDFLARE_R2_PUBLIC_URL | send_weekly_report.py |
| LOOPS_API_KEY | send_weekly_report.py |
| LOOPS_TRANSACTIONAL_ID | send_weekly_report.py |
