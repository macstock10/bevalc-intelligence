# SEC RAG Follow‑Up Checklist

Use this checklist after returning home to finish the XBRL integration and validate quality.

## Auth & Migration
- [ ] Fix Cloudflare auth (valid `CLOUDFLARE_API_TOKEN` or OAuth login).
- [ ] Apply migration:
  ```bash
  cd scripts
  npx wrangler d1 execute bevalc-colas --remote --file=./migrations/006_sec_xbrl_facts.sql
  ```

## Re‑ingest
- [ ] Run SEC RAG ingest to populate XBRL + Exhibit 99.1 data:
  ```bash
  cd scripts/sec-rag
  npm run ingest -- --backfill
  ```
  Optional:
  - `--incremental` (last 7 days)
  - `--skip-xbrl` (narrative only)

## QA Validation
- [ ] Run 2–3 SEC RAG queries and confirm:
  - [ ] Earnings calls prioritized for management‑said questions.
  - [ ] Recent filings dominate (last 6–12 months).
  - [ ] Multi‑company queries show ticker diversity.
  - [ ] Coverage section lists tickers, doc types, and date range.

## Notes (fill in when done)
- Auth method used:
- Migration applied at:
- Re‑ingest completed at:
- Queries tested:
