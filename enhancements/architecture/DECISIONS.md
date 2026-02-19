# BevAlc Intelligence — Technical Decision Log

## Purpose

This document records key technical and design decisions with rationale. Reference this before revisiting any settled decision.

---

## D001: Database — Cloudflare D1
**Date**: 2026-02
**Decision**: Keep Cloudflare D1 as primary database.
**Rationale**: Already in production with 2M+ COLA records. D1 is free/cheap, pairs naturally with Workers and R2. SQLite-compatible.
**Risk**: D1 max size is 10GB on paid plan. Monitor as enrichment columns add data. If approaching limit, move large text fields (ocr_text) to R2 as JSON files, or migrate to managed PostgreSQL (Neon/Supabase).
**Revisit if**: Database size exceeds 7GB, or query performance degrades on analytical queries.

## D002: Image Storage — Cloudflare R2
**Date**: 2026-02
**Decision**: Store all label images in Cloudflare R2.
**Rationale**: R2 has no egress fees (unlike S3). Pairs with D1 and Workers. Cost-effective for 5M+ images.
**Alternatives rejected**: S3 (egress costs), local storage (not scalable).

## D003: OCR — Google Cloud Vision API
**Date**: 2026-02
**Decision**: Use Google Cloud Vision DOCUMENT_TEXT_DETECTION for label OCR.
**Rationale**: Industry-standard accuracy on printed text. Handles curved/stylized label text better than open-source alternatives. $1.50/1K images is acceptable at our scale.
**Alternatives rejected**: Tesseract (lower accuracy on stylized labels), AWS Textract (more expensive, no clear accuracy advantage), Azure Computer Vision (comparable but less familiar).
**Revisit if**: Google accuracy proves poor on specific label types (handwritten, heavily stylized). May need supplemental OCR for those cases.

## D004: LLM Enrichment — Claude Sonnet via Batch API
**Date**: 2026-02
**Decision**: Use Claude Sonnet for commercial classification, run via Anthropic Batch API.
**Rationale**: Batch API is 50% cheaper than real-time. Sonnet is sufficient for structured extraction; Opus reserved for edge cases. Temperature 0 for deterministic output.
**Cost**: ~$1K for full 2.6M record backfill via batch.
**Alternatives rejected**: GPT-4o (comparable but Anthropic ecosystem preferred), local LLM (insufficient accuracy for taxonomy classification), rule-based system (too rigid for 150+ subcategories).

## D005: Embeddings — OpenAI text-embedding-3-large
**Date**: 2026-02
**Decision**: Use OpenAI's text-embedding-3-large (3072 dimensions) for all vector embeddings.
**Rationale**: Best-in-class retrieval quality. Industry standard. Reasonable cost.
**Alternatives rejected**: Cohere embed-v3 (good but less ecosystem support), open-source models (lower quality, self-hosting overhead).

## D006: Vector Database — Pinecone
**Date**: 2026-02
**Decision**: Pinecone Standard tier for vector storage and search.
**Rationale**: Managed service, no ops overhead. $70/month is acceptable. Good metadata filtering. Fast queries.
**Alternatives rejected**: Weaviate (more complex), Qdrant (self-hosted overhead), pgvector (limited scale in D1/SQLite context).

## D007: Reranking — Cohere Rerank
**Date**: 2026-02
**Decision**: Use Cohere Rerank to filter and reorder Pinecone results before synthesis.
**Rationale**: Dramatically improves relevance of retrieved context. Cheap per-query cost. Bridges the gap between embedding similarity and actual relevance.

## D008: Taxonomy Approach — Constrained LLM Classification
**Date**: 2026-02
**Decision**: Maintain a manual taxonomy (TAXONOMY.md) with ~150 subcategories. Claude must choose from valid values only.
**Rationale**: Constrained output ensures data consistency. Taxonomy reflects commercial language, not regulatory language. Manual curation captures domain knowledge that automated clustering would miss.
**Process**: Iterate taxonomy based on real filing data via `taxonomy_feedback` field. Review and update quarterly.
**Revisit if**: Taxonomy exceeds 300 subcategories (diminishing returns on granularity), or if filing patterns show categories need restructuring.

## D009: Content Scraping — Firecrawl
**Date**: 2026-02
**Decision**: Use Firecrawl for trade publication scraping.
**Rationale**: Handles JS rendering, anti-bot protections, and content extraction in one API call. $50/month. Saves weeks of custom scraper development.
**Alternatives rejected**: Puppeteer/Playwright (works but maintenance burden per site), BeautifulSoup (no JS rendering), Diffbot (more expensive).

## D010: Social Media — X API Pay-Per-Use
**Date**: 2026-02
**Decision**: Use X API on pay-per-use credit model to track ~50 BevAlc accounts.
**Rationale**: Pay-per-use avoids the $100/month Basic tier commitment. Credits consumed only when polling. Estimated $50-100/month for our volume.

## D011: Frontend — Next.js on Vercel
**Date**: 2026-02
**Decision**: Next.js deployed on Vercel for the web application.
**Rationale**: Fast deployment, good DX, SSR for SEO, generous free tier.

## D012: Batch Processing — Lightweight VM
**Date**: 2026-02
**Decision**: Use a cheap VM (Hetzner or DigitalOcean) for long-running batch jobs (image download backfill, OCR backfill).
**Rationale**: Cloudflare Workers have execution time limits (30s on free, 15min on paid). Image backfill of 5M images needs to run for days. A $5-10/month VM handles this.
**Note**: Daily incremental processing (600 COLAs/day) can run on Workers. VM is for one-time backfill.

## D013: Product Naming — Separate Intelligence and Lead Gen
**Date**: 2026-02
**Decision**: Market two products (Intelligence Query Tool + Lead Generation Tool) on the same platform (bevalcintel.com).
**Rationale**: Different buyer personas and value props. Intelligence buyers want answers to strategic questions. Lead gen buyers want actionable contacts and opportunities. Same data, different interfaces and pricing.

## D014: Pricing Model — Per-Seat Monthly Subscription
**Date**: 2026-02
**Decision**: $99-199/month per seat.
**Rationale**: Standard B2B SaaS model. Low enough for individual analysts to expense, high enough for meaningful revenue. 200 seats = $360K/year. Infrastructure cost < $10K/year = 95%+ gross margin.

## D015: Anonymity Constraint
**Date**: 2026-02
**Decision**: All customer-facing operations must maintain Mac's complete anonymity per Goldman Sachs compliance requirements.
**Implications**: No personal branding, no face-to-face meetings, no direct outreach using real name. Distribution through partners, affiliates, and automated channels only. Product sells itself through SEO, content marketing, and word-of-mouth.

---

## Template for New Decisions

```
## DXXX: [Short title]
**Date**: YYYY-MM
**Decision**: [What was decided]
**Rationale**: [Why]
**Alternatives rejected**: [What else was considered and why it was rejected]
**Revisit if**: [Conditions that would trigger reconsideration]
```
