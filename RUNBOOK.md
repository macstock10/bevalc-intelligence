# BevAlc Intelligence - Runbook

## Quick Reference

| Task | Command / Action |
|------|------------------|
| Deploy frontend | Push to main → Netlify auto-deploys |
| Deploy worker | `cd worker && npx wrangler deploy` |
| Run scraper manually | GitHub Actions → Daily TTB Sync → Run workflow |
| Run report manually | GitHub Actions → Weekly Report → Run workflow |
| Regenerate sitemaps | `cd scripts && python generate_sitemaps.py` |
| Generate LinkedIn video | `cd skills/remotion/bevalc-videos && npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4` |
| Generate LinkedIn posts | `/weekly-content` in Claude Code |
| Sync TTB statistics | `cd scripts && python sync_ttb_statistics.py` |
| Generate spirits articles | `cd scripts && python generate_spirits_articles.py --auto` |
| Check logs | GitHub Actions → click workflow run → view logs |

## Deployment

### Frontend (Netlify)
- **Trigger**: Automatic on push to `main`
- **Source**: `/web` folder
- **URL**: https://bevalcintel.com
- **Dashboard**: https://app.netlify.com/projects/bevalc-intelligence

### Cloudflare Worker
- **Deploy**: `cd worker && npx wrangler deploy`
- **Dashboard**: https://dash.cloudflare.com ? Workers & Pages
- **Config**: `worker/wrangler.toml` contains D1 binding (database_id)
- **Note**: Worker code in `worker/worker.js` - do NOT edit in Cloudflare dashboard

### GitHub Actions (Scheduled)
- **Daily TTB Sync**: Daily 9pm ET (2am UTC)
- **Weekly Report**: Fridays 2pm ET (7pm UTC)
- **TTB Statistics Sync**: Wednesdays 10pm ET (3am UTC)
- **Manual trigger**: Actions tab → select workflow → Run workflow

## Rollback Procedures

### Frontend broke after deploy
1. Go to Netlify ? Deploys
2. Find last working deploy
3. Click ? "Publish deploy"

### Worker broke
1. Go to Cloudflare dashboard ? Workers
2. Click on worker ? Deployments
3. Roll back to previous version

### Bad data in D1
1. Identify bad records (ttb_id range or date)
2. Run delete query via Cloudflare dashboard:
```sql
   DELETE FROM colas WHERE approval_date > '2026-01-01';
```

### GitHub Action failed
1. Check logs for error
2. Fix code locally
3. Push to main
4. Re-run workflow manually

## Monitoring

### Check if scraper ran
1. GitHub Actions ? Daily TTB Sync: Daily 9pm ET (2am UTC)
2. Look for recent successful run
3. Check logs for "Synced to D1: X new COLAs"

### Check D1 record count
```sql
SELECT COUNT(*) FROM colas;
SELECT COUNT(*) FROM colas WHERE approval_date > date('now', '-7 days');
```

### Check R2 for reports
- Cloudflare dashboard ? R2 ? bevalc-reports bucket
- Look for `weekly/{date}/` folders

## Historical Data Scraping

### Using cola_worker.py
The `cola_worker.py` script scrapes historical COLA data from TTB by month. It's resume-safe and can run multiple instances in parallel.

```bash
cd scripts

# Single month
python cola_worker.py --name worker_1 --months 2014-01

# Multiple months
python cola_worker.py --name worker_1 --months 2014-01 2014-02 2014-03

# Full year
python cola_worker.py --name worker_1 --year 2014

# Check status
python cola_worker.py --name worker_1 --status
```

## Reclassifying Historical Records

### When to Reclassify
- After changing classification logic (e.g., switching to normalized company_id)
- After fixing company normalization data
- After importing historical data

### Running Batch Classification
```bash
cd scripts
python batch_classify.py --analyze    # Check current state
python batch_classify.py --dry-run    # Preview changes
python batch_classify.py              # Run full classification (takes ~15 min)
```

The script:
1. Fetches all 1.6M records from D1
2. Processes chronologically to identify first-time filings
3. Updates signal and refile_count for all records
4. Uses normalized company_id via company_aliases table

## Common Issues

### "CAPTCHA detected" in scraper logs
- TTB is blocking. Script will wait 30s and retry.
- If persistent, may need to reduce scraping frequency.

### "D1 API error: 429"
- Rate limited. Script batches at 500 records.
- Reduce D1_BATCH_SIZE if needed.

### "too many SQL variables" in D1 insert
- SQLite has ~999 parameter limit per query.
- Scripts use inline SQL values (not parameterized) to avoid this.
- See `escape_sql_value()` function in weekly_update.py.

### "Claude API rate limit exceeded" in enhancement
- Enhancement retries automatically (10s, 30s, 60s delays, max 3 attempts)
- If still failing, wait 2+ minutes and retry
- For testing, space out enhancement requests
- Low volume (5-10 per user) should not hit limits in production

### Netlify deploy shows "Not Found"
- Check Build settings ? Publish directory = `web`
- Or check `netlify.toml` has `publish = "web"`

### GitHub Action fails on "Install dependencies"
- Check `scripts/requirements.txt` for typos
- Ensure all imports in scripts have matching requirements

## Adding New Features

### New frontend page
1. Create HTML file in `web/`
2. Push to main
3. Netlify auto-deploys

### New API endpoint
1. Edit `worker/worker.js`
2. Test locally with `wrangler dev`
3. Deploy with `wrangler deploy`

### New scheduled script
1. Create script in `scripts/`
2. Add workflow file in `.github/workflows/`
3. Add required secrets to GitHub

## Sitemaps

Sitemaps are pre-generated and stored in R2 for performance (240K+ brand URLs caused timeouts when generated dynamically).

### Automatic Regeneration
The weekly GitHub Action automatically regenerates sitemaps after `weekly_update.py` runs:
1. `weekly_update.py` scrapes TTB and syncs new COLAs to D1
2. `generate_sitemaps.py` queries D1 and uploads new sitemaps to R2
3. Worker serves sitemaps from R2 (24h edge cache)

### Manual Regeneration
If sitemaps need updating outside the weekly cycle:
```bash
cd scripts && python generate_sitemaps.py
```

### Sitemap Files (in R2 bucket)
- `sitemaps/sitemap.xml` - Index file
- `sitemaps/sitemap-static.xml` - Static pages (~62 URLs)
- `sitemaps/sitemap-companies.xml` - Company pages (~21k URLs)
- `sitemaps/sitemap-brands-{1-6}.xml` - Brand pages (~240k URLs total)

### Check Sitemap Health
```bash
curl -s -o /dev/null -w "%{http_code}" https://bevalcintel.com/sitemap.xml
curl -s -o /dev/null -w "%{http_code}" https://bevalcintel.com/sitemap-brands-1.xml
```

## Video Generation (LinkedIn)

Weekly market activity videos for LinkedIn using Remotion.

### Quick Start
```bash
cd skills/remotion/bevalc-videos

# Preview in browser
npm run dev

# Render LinkedIn square video (RECOMMENDED)
npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4

# Output: skills/remotion/bevalc-videos/out/weekly-recap-square.mp4
```

### Before Rendering
**CRITICAL: Update data in `src/Root.tsx` with real D1 query results.**

```bash
# Get signal breakdown
npx wrangler d1 execute bevalc-colas --remote --command="SELECT signal, COUNT(*) as count FROM colas WHERE year = 2026 AND month = 1 AND day >= 10 GROUP BY signal"

# Get category breakdown
npx wrangler d1 execute bevalc-colas --remote --command="SELECT category, COUNT(*) as count FROM colas WHERE signal = 'NEW_BRAND' AND year = 2026 AND month = 1 AND day >= 10 GROUP BY category ORDER BY count DESC"
```

### Available Formats
| Composition | Dimensions | Platform |
|-------------|------------|----------|
| `WeeklyRecapSquare` | 1080x1080 | LinkedIn feed (recommended) |
| `WeeklyRecap` | 1920x1080 | YouTube, presentations |
| `WeeklyRecapVertical` | 1080x1920 | Instagram Stories |

### Posting to LinkedIn
1. Render: `npx remotion render WeeklyRecapSquare out/weekly-recap-square.mp4`
2. Upload as native video to LinkedIn
3. Add caption from `/weekly-content` generated posts

See `skills/remotion/README.md` for full documentation.

---

## TTB Distilled Spirits Statistics

Production statistics from TTB covering all US distilled spirits (whisky, vodka, rum, gin, brandy, cordials).

### Data Source
- **URL**: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics
- **Coverage**: 2012 to present
- **Update frequency**: Monthly (45 days after month end), Yearly (60 days after year end)

### Automatic Sync
GitHub Action runs every Wednesday at 3am UTC (10pm ET Tuesday):
1. Downloads monthly + yearly CSVs from TTB
2. Syncs to `ttb_spirits_stats` table in D1
3. Generates articles for new data

### Manual Sync
```bash
cd scripts

# Full sync (monthly + yearly)
python sync_ttb_statistics.py

# Check sync status
python sync_ttb_statistics.py --status

# Monthly data only
python sync_ttb_statistics.py --monthly
```

### Generate Content
```bash
cd scripts

# Auto-generate for latest data
python generate_spirits_articles.py --auto

# Specific month
python generate_spirits_articles.py --monthly 2024 11

# Annual analysis
python generate_spirits_articles.py --yearly 2024

# Category deep dive
python generate_spirits_articles.py --category whisky

# LinkedIn post
python generate_spirits_articles.py --linkedin
```

Output: `scripts/content-queue/spirits-*.md`

### Check Data Coverage
```sql
-- Latest monthly data
SELECT MAX(year) as year, MAX(month) as month
FROM ttb_spirits_stats WHERE month IS NOT NULL;

-- Latest yearly data
SELECT MAX(year) as year FROM ttb_spirits_stats WHERE month IS NULL;

-- Production by category (latest year)
SELECT statistical_detail, value, count_ims
FROM ttb_spirits_stats
WHERE year = 2024 AND month IS NULL
AND statistical_group LIKE '1-Distilled Spirits Production%'
ORDER BY value DESC;
```

### Skill Command
Use `/spirits-report` in Claude Code to generate articles interactively.

---

## Contacts / Resources

- **TTB COLA Database**: https://ttbonline.gov/colasonline/publicSearchColasBasic.do
- **TTB Spirits Statistics**: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics
- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **Netlify Dashboard**: https://app.netlify.com
- **Resend Dashboard**: https://resend.com/emails
- **GitHub Repo**: https://github.com/macstock10/bevalc-intelligence
