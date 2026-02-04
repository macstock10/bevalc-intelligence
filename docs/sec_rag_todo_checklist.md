# SEC RAG Follow‑Up Checklist

Use this checklist after returning home to finish the XBRL integration and validate quality.

## Auth & Migration
- [x] Fix Cloudflare auth (valid `CLOUDFLARE_API_TOKEN` or OAuth login).
- [x] Apply migration:
  ```bash
  cd scripts
  npx wrangler d1 execute bevalc-colas --remote --file=./migrations/006_sec_xbrl_facts.sql
  ```

## Re‑ingest
- [x] Run SEC RAG ingest to populate XBRL + Exhibit 99.1 data:
  ```bash
  cd scripts/sec-rag
  npm run ingest -- --backfill
  ```
  Optional:
  - `--incremental` (last 7 days)
  - `--skip-xbrl` (narrative only)

## QA Validation
*(Requires Pro login at https://bevalcintel.com/research.html)*

- [ ] Run 2–3 SEC RAG queries and confirm:
  - [ ] Earnings calls prioritized for management‑said questions.
  - [ ] Recent filings dominate (last 6–12 months).
  - [ ] Multi‑company queries show ticker diversity.
  - [ ] Coverage section lists tickers, doc types, and date range.

**Suggested test queries:**
1. "What has management said about premiumization trends?"
2. "What are the revenue trends across beverage companies in 2024-2025?"
3. "How is Constellation Brands performing in the beer segment?"

## Notes (fill in when done)
- Auth method used: CLOUDFLARE_API_TOKEN (existing from .env)
- Migration applied at: 2026-02-03 (006_sec_xbrl_facts.sql - 6 queries, 4.57ms)
- Re‑ingest completed at: 2026-02-03 (390 filings, 10,992 chunks, ~10.5M tokens)
- Queries tested: *(manual testing required - API requires Pro auth)*
- Bug fixed: `parser.ts:156` - added missing `confidence` destructuring
