# BevAlc Intelligence — Project Overview

## What We're Building

BevAlc Intelligence (bevalcintel.com) is a data intelligence platform for the beverage alcohol industry. It transforms raw TTB COLA filings, label images, trade publication content, earnings transcripts, and social media commentary into actionable commercial intelligence.

Two products share the same data infrastructure:

1. **Intelligence Query Tool** — A natural language interface where users ask questions like "what are the emerging trends in American single malt" and receive AI-synthesized answers citing COLA filings, trade press, earnings calls, and social commentary. Think AlphaSense, but purpose-built for BevAlc at 1/10th the price.

2. **Lead Generation Tool** — Identifies new brands, new market entrants, and distribution opportunities from COLA filing patterns. Enriches leads with contact data, company intelligence, and competitive positioning. Delivers actionable opportunities to distributors, brokers, and service providers.

## Target Customers

- M&A advisors and brokers evaluating BevAlc brands
- Institutional investors and PE firms doing BevAlc deals
- Large brand owners doing competitive intelligence (Diageo, Constellation, Brown-Forman strategy teams)
- Distributors identifying new brands and products before they hit shelves
- Service providers (label printers, compliance firms, packaging companies) finding new customers

## Competitive Positioning

**COLA Cloud** (colacloud.us) is the closest competitor on COLA data. They have 2.6M records, 4.6M label images, barcode extraction, and a single `llm_category` field. They sell data access via API, web UI, and Snowflake. They are a data infrastructure company.

We differentiate on three dimensions:
1. **Richer per-record enrichment** — Multi-field commercial taxonomy (category, subcategory, flavor profile, production method, price tier, etc.) vs. their single category string
2. **Derived intelligence** — Category trends, new entrant detection, brand velocity, competitive clustering. They have none of this.
3. **Unstructured data layer** — Twitter commentary, trade pub articles, newsletters, earnings transcripts synthesized alongside COLA data. They will never build this.

We are not a data access company. We are an intelligence company.

## Technical Stack

| Layer | Tool | Purpose |
|---|---|---|
| Database | Cloudflare D1 | Primary data store for all COLA and enrichment data |
| Image Storage | Cloudflare R2 | Label images (originals + thumbnails) |
| OCR | Google Cloud Vision API | Text extraction from label images |
| Barcode Detection | pyzbar (Python) | UPC/EAN extraction from label images |
| LLM Enrichment | Claude API (Anthropic) | Commercial classification and field extraction |
| Embeddings | OpenAI text-embedding-3-large | Vectorizing content for semantic search |
| Vector Database | Pinecone | Similarity search over embeddings |
| Reranking | Cohere Rerank | Quality filtering of search results |
| Synthesis | Claude API (Anthropic) | Generating answers from retrieved context |
| Social Ingestion | X API (pay-per-use) | Tracking BevAlc thought leaders on Twitter |
| Article Scraping | Firecrawl | Extracting clean text from trade publications |
| Newsletter Ingestion | Cloudflare Email Workers | Receiving and parsing newsletters |
| Orchestration | Cloudflare Workers | Cron jobs, queues, pipeline triggers |
| Batch Processing | Lightweight VM (Hetzner/DO) | Long-running image download and OCR jobs |
| Frontend | Next.js on Vercel | Web application |
| Domain | bevalcintel.com | Production domain |

## Data Sources

### Structured (already ingested)
- TTB COLA filings (2M+ records in Cloudflare D1)

### Structured (to be added)
- Label images from TTB (OCR text, barcodes, visual data)
- SEC filings and earnings transcripts for public BevAlc companies
- State control board pricing data

### Unstructured (to be added)
- Twitter/X posts from ~50 industry accounts
- Trade publications (Shanken, BevNET, Beverage Dynamics, etc.)
- Industry newsletters and Substacks
- Press releases (PR Newswire, GlobeNewsWire filtered to BevAlc)

## Key Files

| File | Purpose |
|---|---|
| `docs/architecture/OVERVIEW.md` | This file. Project summary. |
| `docs/architecture/DATA_MODEL.md` | Complete database schema |
| `docs/architecture/PIPELINE.md` | Processing pipeline flow |
| `docs/architecture/DECISIONS.md` | Technical decision log |
| `docs/prompts/ENRICHMENT_PROMPT.md` | Claude classification prompt |
| `docs/prompts/SYNTHESIS_PROMPT.md` | Claude query synthesis prompt |
| `docs/taxonomy/TAXONOMY.md` | Commercial product taxonomy |
| `docs/specs/*.md` | Individual pipeline component specs |
| `docs/validation/QUALITY_SCORECARD.md` | Accuracy tracking |

## API Keys & Configuration

All keys stored in `.env` (gitignored). Services configured:
- Google Cloud Vision (project: bevalc-intel, $250 billing alert set)
- Anthropic Claude API
- OpenAI API
- Pinecone
- Cohere
- X/Twitter API (pay-per-use available)
- Firecrawl

Google service account JSON stored in project root (gitignored).
