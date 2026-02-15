-- Migration 011: Company Enrichments & Contacts
-- New structured tables for the company enrichment pipeline.
-- Does NOT drop old company_enhancements table (kept for rollback).

CREATE TABLE IF NOT EXISTS company_enrichments (
    company_id INTEGER PRIMARY KEY,
    company_name TEXT NOT NULL,

    -- Website / Firmographics
    website_url TEXT,
    website_title TEXT,
    website_description TEXT,
    industry TEXT,
    employee_count_range TEXT,
    founding_year INTEGER,
    revenue_range TEXT,
    entity_type TEXT,
    incorporation_state TEXT,
    incorporation_date TEXT,

    -- Domain Intel
    domain_registered_date TEXT,
    domain_registrar TEXT,
    tech_stack TEXT,
    has_ecommerce INTEGER DEFAULT 0,
    has_age_verification INTEGER DEFAULT 0,

    -- Google Places
    google_place_id TEXT,
    google_rating REAL,
    google_review_count INTEGER,
    google_category TEXT,
    google_address TEXT,
    google_phone TEXT,
    google_hours TEXT,
    google_photos_count INTEGER,

    -- Consumer Platforms
    untappd_brewery_id TEXT,
    untappd_rating REAL,
    untappd_checkin_count INTEGER,
    untappd_beer_count INTEGER,
    vivino_winery_id TEXT,
    vivino_rating REAL,
    vivino_review_count INTEGER,
    vivino_wine_count INTEGER,

    -- Funding
    funding_total TEXT,
    funding_stage TEXT,
    funding_investors TEXT,
    last_funding_date TEXT,
    last_funding_amount TEXT,

    -- Social
    instagram_handle TEXT,
    instagram_followers INTEGER,
    tiktok_handle TEXT,
    tiktok_followers INTEGER,
    facebook_url TEXT,
    twitter_handle TEXT,
    linkedin_url TEXT,

    -- Trademark
    trademark_serial_number TEXT,
    trademark_filing_date TEXT,
    trademark_status TEXT,
    trademark_registration_date TEXT,

    -- Meta
    enriched_at TEXT NOT NULL,
    enrichment_sources TEXT,
    enrichment_version TEXT DEFAULT '1.0',
    last_enriched_by TEXT,
    ai_brief TEXT
);

CREATE INDEX IF NOT EXISTS idx_company_enrichments_enriched_at ON company_enrichments(enriched_at);

-- Contacts table: multiple rows per company
CREATE TABLE IF NOT EXISTS company_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    full_name TEXT,
    title TEXT,
    email TEXT,
    email_verified INTEGER DEFAULT 0,
    email_verification_score REAL,
    linkedin_url TEXT,
    linkedin_headline TEXT,
    phone TEXT,
    source TEXT,
    is_decision_maker INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company_id ON company_contacts(company_id);
