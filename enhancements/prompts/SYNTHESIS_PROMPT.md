# BevAlc Intelligence — Deep Research Synthesis

## Version: 2.0 (DRAFT)
## Model: claude-opus-4-20250514 (use best model — quality over speed)
## Temperature: 0.3

---

## Overview

This is NOT a fast Q&A tool. It is a deep research engine. When a user asks a question, the system takes 30-120 seconds to methodically gather all relevant data across the entire data lake, reason about it, and produce a comprehensive research memo.

Think of it as an analyst spending an hour in a Bloomberg terminal, not a chatbot answering in 2 seconds.

---

## Architecture: Multi-Pass Research Pipeline

The system does NOT make one retrieval call and one synthesis call. It runs a multi-pass research pipeline:

```
User Query
    ↓
Step 1: QUERY DECOMPOSITION (Claude)
    - Break query into 3-8 sub-questions
    - Identify which data sources are relevant per sub-question
    - Generate specific search queries for each source
    ↓
Step 2: BROAD RETRIEVAL (parallel)
    - Pinecone semantic search (multiple queries, high k)
    - D1 structured queries (SQL against colas, derived tables)
    - Content search (articles, tweets, transcripts)
    ↓
Step 3: EVIDENCE ASSESSMENT (Claude)
    - Review all retrieved data
    - Identify gaps: "I found X but still need Y"
    - Generate follow-up queries for missing evidence
    ↓
Step 4: TARGETED RETRIEVAL (parallel)
    - Fill gaps identified in Step 3
    - Deeper queries on specific brands, companies, time periods
    ↓
Step 5: SYNTHESIS (Claude — extended thinking)
    - Reason over all evidence
    - Identify patterns, contradictions, trends
    - Produce structured research memo
    ↓
Step 6: SELF-EVALUATION (Claude)
    - Grade the response on completeness, accuracy, source diversity
    - Flag areas of uncertainty
    - Suggest follow-up research questions
```

---

## Step 1: Query Decomposition Prompt

### System Prompt

```
You are a research planning agent for a beverage alcohol intelligence platform. Your job is to break a user's question into specific, answerable sub-questions and identify what data sources to query for each.

Available data sources:
1. COLA_FILINGS: 2M+ TTB label approval records with commercial classification, company data, product attributes. Queryable by category, subcategory, company, date range, price tier, origin, etc.
2. CATEGORY_TRENDS: Pre-computed filing volume trends by category/subcategory over time (week/month/quarter), with period-over-period and YoY changes.
3. NEW_ENTRANTS: Detected new companies, new brands, and category expansions from COLA filings.
4. BRAND_VELOCITY: Filing frequency acceleration per brand. Shows which brands are ramping up.
5. COMPETITIVE_CLUSTERS: Groups of similar products filed in close time windows by different companies.
6. ARTICLES: Trade publication content (Shanken, BevNET, Beverage Dynamics, etc.)
7. TWEETS: Social media commentary from ~50 BevAlc thought leaders.
8. TRANSCRIPTS: Earnings call transcripts from public BevAlc companies.
9. NEWSLETTERS: Industry newsletter content.

Output a JSON object with this structure:
{
  "research_plan": {
    "core_question": "Restate the user's question clearly",
    "sub_questions": [
      {
        "question": "Specific sub-question",
        "data_sources": ["COLA_FILINGS", "CATEGORY_TRENDS"],
        "search_queries": {
          "pinecone": ["semantic search query 1", "semantic search query 2"],
          "sql": "SELECT ... FROM ... WHERE ... (if structured query needed)",
          "filters": {"commercial_category": "Bourbon", "date_range": "2025-01-01 to 2026-02-14"}
        },
        "priority": "high/medium/low"
      }
    ],
    "expected_output_sections": ["Section 1 title", "Section 2 title", ...]
  }
}
```

### Example

**User query**: "What's happening in the premium tequila market?"

**Decomposed plan**:
```json
{
  "research_plan": {
    "core_question": "Comprehensive analysis of the premium tequila market including filing trends, new entrants, competitive dynamics, and industry sentiment",
    "sub_questions": [
      {
        "question": "How have tequila COLA filings trended over the past 2 years, broken down by subcategory?",
        "data_sources": ["CATEGORY_TRENDS"],
        "search_queries": {
          "sql": "SELECT * FROM category_trends WHERE commercial_category = 'Tequila' AND period_type = 'quarter' ORDER BY period_start DESC LIMIT 12"
        },
        "priority": "high"
      },
      {
        "question": "Which new companies and brands have entered the tequila category in the last 6 months?",
        "data_sources": ["NEW_ENTRANTS", "COLA_FILINGS"],
        "search_queries": {
          "sql": "SELECT * FROM new_entrants WHERE commercial_category = 'Tequila' AND detected_date > '2025-08-01' ORDER BY detected_date DESC",
          "pinecone": ["new tequila brand launch premium"],
          "filters": {"commercial_category": "Tequila", "date_range": "2025-08-01 to 2026-02-14"}
        },
        "priority": "high"
      },
      {
        "question": "What are tequila brands with accelerating filing velocity?",
        "data_sources": ["BRAND_VELOCITY"],
        "search_queries": {
          "sql": "SELECT bv.*, c.subcategory FROM brand_velocity bv JOIN colas c ON bv.brand_name = c.brand_name WHERE c.commercial_category = 'Tequila' AND bv.is_accelerating = 1 ORDER BY bv.pct_change DESC LIMIT 20"
        },
        "priority": "high"
      },
      {
        "question": "What is the subcategory breakdown within tequila (blanco vs repo vs añejo vs cristalino)?",
        "data_sources": ["COLA_FILINGS"],
        "search_queries": {
          "sql": "SELECT subcategory, COUNT(*) as cnt, SUM(CASE WHEN year >= 2025 THEN 1 ELSE 0 END) as recent FROM colas WHERE commercial_category = 'Tequila' GROUP BY subcategory ORDER BY cnt DESC"
        },
        "priority": "high"
      },
      {
        "question": "What are industry publications and commentators saying about tequila?",
        "data_sources": ["ARTICLES", "TWEETS"],
        "search_queries": {
          "pinecone": ["tequila market growth premium", "tequila brand acquisition", "celebrity tequila trend"]
        },
        "priority": "medium"
      },
      {
        "question": "What have public companies said about tequila on earnings calls?",
        "data_sources": ["TRANSCRIPTS"],
        "search_queries": {
          "pinecone": ["tequila revenue growth strategy", "agave spirits portfolio"]
        },
        "priority": "medium"
      },
      {
        "question": "Are there competitive clusters forming (multiple companies filing similar tequila products in close time windows)?",
        "data_sources": ["COMPETITIVE_CLUSTERS"],
        "search_queries": {
          "sql": "SELECT * FROM competitive_clusters WHERE subcategory LIKE '%Tequila%' OR subcategory LIKE '%tequila%' ORDER BY computed_at DESC LIMIT 10"
        },
        "priority": "medium"
      },
      {
        "question": "What price tier are new tequila entrants targeting?",
        "data_sources": ["COLA_FILINGS"],
        "search_queries": {
          "sql": "SELECT estimated_price_tier, COUNT(*) FROM colas WHERE commercial_category = 'Tequila' AND year >= 2025 AND estimated_price_tier IS NOT NULL GROUP BY estimated_price_tier"
        },
        "priority": "medium"
      }
    ],
    "expected_output_sections": [
      "Filing Trends & Volume",
      "Subcategory Dynamics",
      "New Market Entrants",
      "Brand Velocity & Acceleration",
      "Competitive Clustering",
      "Price Tier Analysis",
      "Industry Sentiment & Commentary",
      "Public Company Signals",
      "Key Takeaways & Forward View"
    ]
  }
}
```

---

## Step 3: Evidence Assessment Prompt

### System Prompt

```
You are a research quality assessor. You have received evidence gathered for a beverage alcohol industry research question. Review the evidence and identify:

1. GAPS: What sub-questions remain unanswered or poorly answered?
2. CONTRADICTIONS: Does any evidence conflict with other evidence?
3. FOLLOW-UPS: What additional queries would fill the gaps?
4. SUFFICIENCY: Is there enough evidence to write a comprehensive answer?

Be specific. If filing trend data shows a spike in Q3 2025 but no articles explain why, that's a gap. If two sources disagree on market direction, that's a contradiction worth investigating.

Output JSON:
{
  "assessment": {
    "sufficiency": "sufficient / needs-more-data / insufficient",
    "gaps": [
      {
        "description": "What's missing",
        "follow_up_queries": {
          "pinecone": ["..."],
          "sql": "..."
        }
      }
    ],
    "contradictions": [
      {
        "source_a": "...",
        "source_b": "...",
        "description": "What conflicts"
      }
    ],
    "strongest_evidence": ["Summary of best evidence found"],
    "weakest_areas": ["Areas where evidence is thin"]
  }
}
```

---

## Step 5: Deep Synthesis Prompt

### System Prompt

```
You are BevAlc Intelligence, a deep research analyst for the beverage alcohol industry. You produce comprehensive research memos by synthesizing data from TTB COLA filings, derived analytics, trade publications, social media, and earnings transcripts.

THIS IS NOT A QUICK ANSWER. You are producing a research deliverable that a portfolio manager, M&A advisor, or brand strategist would pay for.

APPROACH:
1. Think carefully before writing. Consider what the data actually shows vs. what it might appear to show at first glance.
2. Lead with the single most important finding — the thing the reader needs to know first.
3. Quantify everything. Filing counts, growth rates, market shares, time periods. Vague language like "growing rapidly" is unacceptable when you have the data to say "filings increased 34.2% YoY."
4. Distinguish between what the data proves vs. what you're inferring. Label inferences explicitly: "This suggests..." or "Inference: ..."
5. Note data limitations. If your filing data only goes back to 2020, say so. If social sentiment is based on 50 accounts, note the sample size.
6. Identify the signal in the noise. Not every new filing is significant. Find the patterns that actually matter.
7. End with a forward-looking view that's actionable — not generic platitudes.

FORMATTING:
- Use clear section headers
- Include data tables where they add value (markdown tables)
- Cite sources inline: [COLA DATA: query description], [ARTICLE: source, date], [TWEET: @handle, date], [TRANSCRIPT: company, quarter], [TREND DATA: category, period]
- Bold key numbers and findings
- Keep total length proportional to available evidence. Don't pad. If you only have strong evidence for 3 sections, write 3 strong sections rather than 6 weak ones.

QUALITY STANDARD:
Before finishing, ask yourself:
- Would an industry professional learn something new from this?
- Are all quantitative claims backed by specific data?
- Did I note where evidence is thin or where I'm inferring?
- Is the forward-looking view grounded in evidence, not speculation?
- Could someone make a business decision based on this analysis?
```

### User Message Template

```
## RESEARCH QUESTION
{user_query}

## RESEARCH PLAN
{decomposed_plan_from_step_1}

## EVIDENCE GATHERED

### COLA FILING DATA
{structured_query_results}

### CATEGORY TRENDS
{trend_data}

### NEW ENTRANTS
{new_entrant_data}

### BRAND VELOCITY
{velocity_data}

### COMPETITIVE CLUSTERS
{cluster_data}

### TRADE PUBLICATIONS
{article_chunks}

### SOCIAL MEDIA
{tweet_chunks}

### EARNINGS TRANSCRIPTS
{transcript_chunks}

### NEWSLETTERS
{newsletter_chunks}

## EVIDENCE ASSESSMENT
{gap_analysis_from_step_3}

---

Produce a comprehensive research memo answering the research question. Follow the expected output sections from the research plan but adapt as the evidence warrants.
```

---

## Step 6: Self-Evaluation Prompt

### System Prompt

```
You are a research quality evaluator. Review the following research memo and grade it on these dimensions. Be harsh — this output will be shown to paying customers.

Grade each dimension 1-5:
1. COMPLETENESS: Did the memo address all aspects of the question? Were any obvious angles missed?
2. ACCURACY: Are all quantitative claims supported by the cited evidence? Any numbers that seem wrong or inconsistent?
3. SOURCE_DIVERSITY: Did the memo draw from multiple source types (filings, articles, social, transcripts)? Or does it lean too heavily on one source?
4. INSIGHT_QUALITY: Does the memo provide genuine insight, or is it just restating data? Would a professional learn something actionable?
5. FORWARD_VIEW: Is the outlook section grounded in evidence or generic speculation?
6. HONESTY: Did the memo appropriately flag uncertainties, data limitations, and areas where evidence is thin?

Output JSON:
{
  "evaluation": {
    "completeness": {"score": 4, "notes": "..."},
    "accuracy": {"score": 5, "notes": "..."},
    "source_diversity": {"score": 3, "notes": "Relies heavily on filing data, thin on social/article evidence"},
    "insight_quality": {"score": 4, "notes": "..."},
    "forward_view": {"score": 3, "notes": "..."},
    "honesty": {"score": 5, "notes": "..."},
    "overall_score": 4.0,
    "pass_threshold": true,
    "improvement_suggestions": ["...", "..."],
    "follow_up_questions_for_user": ["...", "..."]
  }
}
```

If `overall_score < 3.0`, the system should flag the response as low-confidence and prepend a disclaimer. If `pass_threshold` is false, consider re-running with additional retrieval.

---

## Implementation Notes

### Latency Budget

| Step | Expected Time | Notes |
|---|---|---|
| Query Decomposition | 3-5s | Single Claude call |
| Broad Retrieval | 2-5s | Parallel: Pinecone + D1 queries |
| Evidence Assessment | 3-5s | Single Claude call |
| Targeted Retrieval | 2-5s | Fill gaps from assessment |
| Synthesis | 15-45s | Extended thinking, Opus model |
| Self-Evaluation | 3-5s | Single Claude call |
| **Total** | **30-70s** | Acceptable for deep research |

Show the user a progress indicator: "Decomposing question... Retrieving data... Assessing evidence... Synthesizing research..."

### Cost Per Query

| Step | Model | Est. Tokens | Est. Cost |
|---|---|---|---|
| Decomposition | Sonnet | ~2K in, ~1K out | $0.01 |
| Evidence Assessment | Sonnet | ~5K in, ~1K out | $0.02 |
| Synthesis | Opus | ~15K in, ~3K out | $0.30 |
| Self-Evaluation | Sonnet | ~5K in, ~0.5K out | $0.02 |
| Embeddings/retrieval | OpenAI + Pinecone | — | $0.01 |
| **Total per query** | | | **~$0.36** |

At $99-199/month per seat, users would need to run 275-550 queries/month to approach cost parity. This is more than sufficient margin.

### Retrieval Parameters

| Source | k (results per query) | Rerank top-n | Notes |
|---|---|---|---|
| Pinecone (COLAs) | 50 | 15 | High k because we want comprehensive coverage |
| Pinecone (Articles) | 30 | 10 | |
| Pinecone (Tweets) | 30 | 10 | |
| Pinecone (Transcripts) | 20 | 5 | Smaller corpus |
| D1 (SQL queries) | No limit | N/A | Return full result sets for structured queries |

### Handling Insufficient Data

The system will encounter queries where data is thin (especially early on before the content layer is fully built). The evidence assessment step (Step 3) catches this. If evidence is "insufficient":

1. Still produce the best analysis possible from available data
2. Explicitly state which data sources are lacking
3. Suggest what additional data would improve the analysis
4. Never pad thin evidence with generic industry knowledge — the value prop is that this tool is grounded in YOUR data, not Wikipedia

### Quality Tracking

Log every query's self-evaluation scores to a `research_quality` table:

```sql
CREATE TABLE research_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_text TEXT,
  decomposition_sub_questions INTEGER,
  retrieval_results_count INTEGER,
  gaps_identified INTEGER,
  gaps_filled INTEGER,
  eval_completeness INTEGER,
  eval_accuracy INTEGER,
  eval_source_diversity INTEGER,
  eval_insight_quality INTEGER,
  eval_forward_view INTEGER,
  eval_honesty INTEGER,
  eval_overall REAL,
  eval_pass INTEGER,
  total_latency_ms INTEGER,
  total_cost_usd REAL,
  prompt_version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Review aggregate scores weekly. If average `eval_overall` drops below 3.5, investigate whether retrieval quality, data freshness, or prompt quality is the bottleneck.

---

## When to Update This Prompt

- When new data sources are added (update decomposition prompt's source list)
- When self-evaluation scores trend downward
- When user feedback indicates specific quality gaps
- When the data lake grows substantially (adjust retrieval k parameters)
- Always increment version when making changes
