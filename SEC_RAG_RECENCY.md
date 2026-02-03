# SEC RAG Recency & Retrieval Behavior

This document explains how the SEC research backend prioritizes recent information, earnings calls, and ticker diversity.

## Retrieval Flow
1. Parse intent from query.
2. Retrieve candidates from Vectorize.
3. Post‑filter by ticker/docType/date window.
4. CALL fallback (Vectorize) if CALL requested and none survived.
5. CALL fallback (D1) if still empty.
6. Rerank with Cohere + recency boost.
7. Enforce ticker diversity for multi‑company queries.
8. Generate answer with Claude.

## Recency Rules
### Default window
- Default lookback is **12 months**.

### “Current” queries
If the query contains terms like:
`current, currently, right now, latest, recent, today, this quarter`

Then:
- Date window tightens to **last 180 days**.
- CALL selection prefers last 180 days if available.

### Recency boost
Applied during rerank:
- ≤ 90 days: +0.45
- ≤ 180 days: +0.30
- ≤ 365 days: +0.15
- Older: +0

## CALL & Q&A Priority
- “Management said / earnings call” → CALL chunks prioritized.
- “Q&A / analyst / questions” → Q&A sections prioritized.
- CALL chunks are sorted **most‑recent first** before selection.

## Ticker Diversity
For multi‑company queries:
- Max **3 chunks per ticker** (round‑robin).
- Remaining slots filled by remaining highest‑ranked chunks.

## Output Formatting (Answer/Sources)
- Answer uses **short paragraphs**, no verbatim quotes.
- Each sentence ends with a citation.
- Sources list includes **verbatim quotes**, newest → oldest.

## Key Files
- `worker/sec_research.js` (recency, CALL/Q&A priority, diversity, formatting)
- `scripts/sec-rag/earningscall_ingest.ts` (CALL ingestion)
- `scripts/sec-rag/transcripts_ingest.ts` (manual transcript ingestion)

