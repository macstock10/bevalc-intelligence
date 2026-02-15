-- Migration 010: Add enrichment columns to colas table
-- All columns nullable since existing records won't have values until processed
-- through the LLM enrichment pipeline.

-- Classification
ALTER TABLE colas ADD COLUMN super_category TEXT;
ALTER TABLE colas ADD COLUMN commercial_category TEXT;
ALTER TABLE colas ADD COLUMN subcategory TEXT;

-- Product details
ALTER TABLE colas ADD COLUMN product_description TEXT;
ALTER TABLE colas ADD COLUMN flavor_profile TEXT;
ALTER TABLE colas ADD COLUMN production_method TEXT;
ALTER TABLE colas ADD COLUMN barrel_type TEXT;
ALTER TABLE colas ADD COLUMN finishing_process TEXT;
ALTER TABLE colas ADD COLUMN age_years INTEGER;

-- Boolean flags (0/1)
ALTER TABLE colas ADD COLUMN is_cask_strength INTEGER;
ALTER TABLE colas ADD COLUMN is_single_barrel INTEGER;
ALTER TABLE colas ADD COLUMN is_limited_release INTEGER;
ALTER TABLE colas ADD COLUMN is_organic INTEGER;
ALTER TABLE colas ADD COLUMN is_gluten_free INTEGER;

-- Market / packaging
ALTER TABLE colas ADD COLUMN estimated_price_tier TEXT;
ALTER TABLE colas ADD COLUMN target_market TEXT;
ALTER TABLE colas ADD COLUMN packaging_format TEXT;
ALTER TABLE colas ADD COLUMN parent_company TEXT;

-- Derived signals
ALTER TABLE colas ADD COLUMN is_new_brand INTEGER;
ALTER TABLE colas ADD COLUMN is_line_extension INTEGER;
ALTER TABLE colas ADD COLUMN is_label_refresh INTEGER;

-- Label contact info (LLM-consolidated from OCR)
ALTER TABLE colas ADD COLUMN label_website TEXT;
ALTER TABLE colas ADD COLUMN label_email TEXT;
ALTER TABLE colas ADD COLUMN label_phone TEXT;
ALTER TABLE colas ADD COLUMN label_social_media TEXT;
ALTER TABLE colas ADD COLUMN label_tagline TEXT;

-- Production / sourcing
ALTER TABLE colas ADD COLUMN distilled_in TEXT;
ALTER TABLE colas ADD COLUMN bottled_by TEXT;
ALTER TABLE colas ADD COLUMN bottled_in TEXT;
ALTER TABLE colas ADD COLUMN imported_by TEXT;
ALTER TABLE colas ADD COLUMN year_established INTEGER;

-- Raw OCR extraction
ALTER TABLE colas ADD COLUMN tasting_notes_raw TEXT;

-- Enrichment metadata
ALTER TABLE colas ADD COLUMN field_sources TEXT;
ALTER TABLE colas ADD COLUMN enrichment_confidence TEXT;
ALTER TABLE colas ADD COLUMN taxonomy_feedback TEXT;
ALTER TABLE colas ADD COLUMN prompt_version TEXT;
ALTER TABLE colas ADD COLUMN processing_status TEXT DEFAULT 'raw';
ALTER TABLE colas ADD COLUMN enriched_at TEXT;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_colas_super_category ON colas(super_category);
CREATE INDEX IF NOT EXISTS idx_colas_commercial_category ON colas(commercial_category);
CREATE INDEX IF NOT EXISTS idx_colas_enriched_at ON colas(enriched_at);
CREATE INDEX IF NOT EXISTS idx_colas_processing_status ON colas(processing_status);
