# SEC RAG XBRL Financial Data Flow

This document describes how XBRL financial facts are ingested from EDGAR and stored for analytics.

## Goal
Provide structured, comparable financial data (including non-GAAP when tagged) alongside narrative RAG content.

## Source
- SEC XBRL Company Facts API:
  - `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`

## Ingestion Flow
1. `scripts/sec-rag/ingest.ts` pulls the same set of filings selected for narrative ingestion.
2. `scripts/sec-rag/lib/xbrl.ts` fetches Company Facts for the CIK.
3. Facts are filtered to only those with `accn` matching the filings being processed.
4. Each fact is normalized into a row and upserted into D1.

## Storage
Table: `sec_xbrl_facts`

Key columns:
- `cik`, `ticker`, `accession_number`
- `taxonomy`, `concept`, `label`
- `unit`, `value_num`, `value_text`
- `period_start`, `period_end`, `fiscal_year`, `fiscal_period`
- `segment_json` for dimensional breakdowns

## Non-GAAP Coverage
Company-specific extensions and non-GAAP metrics are included automatically when they are tagged in XBRL.

## Migration Required
Apply the migration before ingestion:
```bash
cd scripts
npx wrangler d1 execute bevalc-colas --remote --file=./migrations/006_sec_xbrl_facts.sql
```

## Troubleshooting
- If XBRL ingest is too slow, pass `--skip-xbrl` to `npm run ingest`.
- If D1 rejects inserts, reduce batch size in `scripts/sec-rag/lib/d1.ts`.
