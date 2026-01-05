# BevAlc Intelligence - Runbook

## Quick Reference

| Task | Command / Action |
|------|------------------|
| Deploy frontend | Push to main ? Netlify auto-deploys |
| Deploy worker | `cd worker && npx wrangler deploy` |
| Run scraper manually | GitHub Actions ? Weekly COLA Update ? Run workflow |
| Run report manually | GitHub Actions ? Weekly Report ? Run workflow |
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
- **Note**: Worker code in `worker/worker.js` — do NOT edit in Cloudflare dashboard

### GitHub Actions (Scheduled)
- **Weekly COLA Update**: Mondays 6am UTC (1am EST)
- **Weekly Report**: Mondays 8am UTC (3am EST)
- **Manual trigger**: Actions tab ? select workflow ? Run workflow

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

## Common Issues

### "CAPTCHA detected" in scraper logs
- TTB is blocking. Script will wait 30s and retry.
- If persistent, may need to reduce scraping frequency.

### "D1 API error: 429"
- Rate limited. Script batches at 500 records.
- Reduce D1_BATCH_SIZE if needed.

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

## Contacts / Resources

- **TTB COLA Database**: https://ttbonline.gov/colasonline/publicSearchColasBasic.do
- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **Netlify Dashboard**: https://app.netlify.com
- **Loops Dashboard**: https://app.loops.so
- **GitHub Repo**: https://github.com/macstock10/bevalc-intelligence
