# SEC RAG Recency & Retrieval Behavior

This document explains how the SEC research backend prioritizes recent information, earnings calls, ticker diversity, and explicit coverage output.

## Retrieval Flow
1. Parse intent from query.
2. Retrieve candidates from Vectorize (with metadata filters when possible).
3. Post-filter by ticker/docType/date window.
4. CALL fallback (Vectorize) if CALL requested and none survived.
5. CALL fallback (D1) if still empty.
6. Rerank with Cohere + keyword overlap + recency boost (+ CALL/Q&A boosts).
7. Enforce ticker diversity for multi-company queries.
8. Generate grounded answer with Claude.
9. Append a system-generated Coverage section summarizing evidence scope.

## Recency Rules
### Default window
- Default lookback is **12 months**.

### "Current" queries
If the query contains terms like:
`current, currently, right now, latest, recent, today, this quarter`

Then:
- Date window tightens to **last 180 days**.
- CALL selection prefers last 180 days if available.

### Recency boost
Applied during rerank:
- <= 90 days: +0.60
- <= 180 days: +0.45
- <= 365 days: +0.25
- <= 730 days: +0.10
- Older: +0.02

## CALL & Q&A Priority
- "Management said / earnings call" -> CALL chunks get explicit rerank boosts.
- "Q&A / analyst / questions" -> Q&A sections get a larger boost.
- CALL chunks are sorted most-recent-first before selection.

## 8-K Exhibit Coverage
- Filing index is scanned for Exhibit 99.1 (press release / earnings release).
- If found, the exhibit is ingested as an explicit Exhibit section with its own source URL.

## Ticker Diversity
For multi-company queries:
- If the query does not specify a ticker (broad market): max **2 chunks per ticker**.
- Otherwise: max **3 chunks per ticker**.
- Remaining slots filled by remaining highest-ranked chunks.

## Output Formatting (Answer/Sources/Coverage)
- Answer uses short paragraphs, no verbatim quotes.
- Each sentence ends with a citation.
- Sources list includes verbatim quotes, newest -> oldest.
- Coverage section is system-generated from metadata (tickers, doc types, date range, amendments, exhibit count).

## Key Files
- `worker/sec_research.js` (recency, CALL/Q&A priority, diversity, coverage output)
- `scripts/sec-rag/ingest.ts` (filing and exhibit ingestion)
- `scripts/sec-rag/lib/parser.ts` (section detection and exhibit parsing)
- `scripts/sec-rag/lib/chunker.ts` (chunk offsets and metadata)
