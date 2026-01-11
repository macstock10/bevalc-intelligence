-- Migration 001: Enhancement System Tables
-- Run with: npx wrangler d1 execute bevalc-colas --remote --file=../scripts/migrations/001_enhancement_tables.sql

-- Cached enhancement results (by normalized company_id)
CREATE TABLE IF NOT EXISTS company_enhancements (
    company_id INTEGER PRIMARY KEY,
    company_name TEXT,
    website_url TEXT,
    website_confidence TEXT,
    contacts TEXT,
    social_links TEXT,
    news TEXT,
    filing_stats TEXT,
    distribution_states TEXT,
    brand_portfolio TEXT,
    category_breakdown TEXT,
    summary TEXT,
    tearsheet_html TEXT,
    enhanced_at TEXT,
    enhanced_by TEXT,
    expires_at TEXT
);

-- Enhancement credit transactions
CREATE TABLE IF NOT EXISTS enhancement_credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER,
    stripe_payment_id TEXT,
    company_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Index for fast balance lookups
CREATE INDEX IF NOT EXISTS idx_credits_email ON enhancement_credits(email);

-- Index for looking up enhancements by company name
CREATE INDEX IF NOT EXISTS idx_enhancements_name ON company_enhancements(company_name);
