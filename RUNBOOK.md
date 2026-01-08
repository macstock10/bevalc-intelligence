# BevAlc Intelligence - Runbook

## Quick Reference

| Task | Command / Action |
|------|------------------|
| Deploy frontend | Push to main ? Netlify auto-deploys |
| Deploy worker | `cd worker && npx wrangler deploy` |
| Run scraper manually | GitHub Actions ? Weekly COLA Update ? Run workflow |
| Run report manually | GitHub Actions ? Weekly Report ? Run workflow |
| Regenerate sitemaps | `cd scripts && python generate_sitemaps.py` |
| Check logs | GitHub Actions ? click workflow run ? view logs |

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
- **Weekly COLA Update**: Fridays 9pm ET (Saturday 2am UTC)
- **Weekly Report**: Saturdays 9am ET (2pm UTC)
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
1. GitHub Actions ? Weekly COLA Update
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

### Pre-built 2014 Scrapers
12 batch files for scraping each month of 2014:
```
scripts/scrape_2014_01.bat through scrape_2014_12.bat
```

Run in parallel (4 terminals recommended):
- Terminal 1: Jan, Feb, Mar
- Terminal 2: Apr, May, Jun
- Terminal 3: Jul, Aug, Sep
- Terminal 4: Oct, Nov, Dec

Each creates its own database in `data/2014_XX.db`.

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

## Contacts / Resources

- **TTB COLA Database**: https://ttbonline.gov/colasonline/publicSearchColasBasic.do
- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **Netlify Dashboard**: https://app.netlify.com
- **Resend Dashboard**: https://resend.com/emails
- **GitHub Repo**: https://github.com/macstock10/bevalc-intelligence
