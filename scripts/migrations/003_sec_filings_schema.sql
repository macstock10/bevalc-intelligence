-- Migration 003: SEC Filings Research System
-- Run with: npx wrangler d1 execute bevalc-colas --remote --file=../scripts/migrations/003_sec_filings_schema.sql

-- Tracked public beverage alcohol companies
CREATE TABLE IF NOT EXISTS sec_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    cik TEXT NOT NULL UNIQUE,
    company_name TEXT NOT NULL,
    company_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Insert initial tracked companies
INSERT OR IGNORE INTO sec_companies (ticker, cik, company_name) VALUES
    ('BF.B', '0000014693', 'Brown-Forman Corporation'),
    ('STZ', '0000016918', 'Constellation Brands, Inc.'),
    ('TAP', '0000024545', 'Molson Coors Beverage Company'),
    ('SAM', '0000949870', 'Boston Beer Company, Inc.'),
    ('MGPI', '0000835011', 'MGP Ingredients, Inc.');

-- Individual SEC filings
CREATE TABLE IF NOT EXISTS sec_filings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sec_company_id INTEGER NOT NULL,
    accession_number TEXT NOT NULL UNIQUE,
    filing_type TEXT NOT NULL,
    filing_date TEXT NOT NULL,
    period_end_date TEXT,
    fiscal_year INTEGER,
    fiscal_quarter INTEGER,
    edgar_url TEXT,
    r2_key TEXT,
    processing_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,
    FOREIGN KEY (sec_company_id) REFERENCES sec_companies(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_filings_company ON sec_filings(sec_company_id);
CREATE INDEX IF NOT EXISTS idx_sec_filings_type ON sec_filings(filing_type);
CREATE INDEX IF NOT EXISTS idx_sec_filings_date ON sec_filings(filing_date);
CREATE INDEX IF NOT EXISTS idx_sec_filings_status ON sec_filings(processing_status);

-- Parsed filing sections (MD&A, Risk Factors, etc.)
CREATE TABLE IF NOT EXISTS sec_filing_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filing_id INTEGER NOT NULL,
    section_type TEXT NOT NULL,
    section_title TEXT,
    content TEXT,
    content_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (filing_id) REFERENCES sec_filings(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_sections_filing ON sec_filing_sections(filing_id);
CREATE INDEX IF NOT EXISTS idx_sec_sections_type ON sec_filing_sections(section_type);

-- RAG chunks for embedding/vector search
CREATE TABLE IF NOT EXISTS sec_filing_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filing_id INTEGER NOT NULL,
    section_id INTEGER,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    vector_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (filing_id) REFERENCES sec_filings(id),
    FOREIGN KEY (section_id) REFERENCES sec_filing_sections(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_chunks_filing ON sec_filing_chunks(filing_id);
CREATE INDEX IF NOT EXISTS idx_sec_chunks_section ON sec_filing_chunks(section_id);
CREATE INDEX IF NOT EXISTS idx_sec_chunks_vector ON sec_filing_chunks(vector_id);

-- Parsed 8-K material events
CREATE TABLE IF NOT EXISTS sec_8k_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filing_id INTEGER NOT NULL,
    item_number TEXT NOT NULL,
    item_title TEXT,
    headline TEXT,
    summary TEXT,
    priority TEXT DEFAULT 'normal',
    raw_content TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (filing_id) REFERENCES sec_filings(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_8k_filing ON sec_8k_events(filing_id);
CREATE INDEX IF NOT EXISTS idx_sec_8k_priority ON sec_8k_events(priority);

-- MD&A diff comparison results
CREATE TABLE IF NOT EXISTS sec_mda_diffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sec_company_id INTEGER NOT NULL,
    current_filing_id INTEGER NOT NULL,
    previous_filing_id INTEGER NOT NULL,
    diff_type TEXT NOT NULL,
    ai_summary TEXT,
    significant_changes TEXT,
    boilerplate_score REAL,
    diff_html TEXT,
    r2_key TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sec_company_id) REFERENCES sec_companies(id),
    FOREIGN KEY (current_filing_id) REFERENCES sec_filings(id),
    FOREIGN KEY (previous_filing_id) REFERENCES sec_filings(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_mda_company ON sec_mda_diffs(sec_company_id);
CREATE INDEX IF NOT EXISTS idx_sec_mda_current ON sec_mda_diffs(current_filing_id);

-- RAG query cache
CREATE TABLE IF NOT EXISTS sec_query_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash TEXT NOT NULL UNIQUE,
    query_text TEXT NOT NULL,
    filters TEXT,
    response TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sec_query_hash ON sec_query_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_sec_query_expires ON sec_query_cache(expires_at);
