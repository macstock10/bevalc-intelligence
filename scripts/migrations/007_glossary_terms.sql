-- Glossary terms table for SSR glossary pages
-- Each row is a full glossary term page at /glossary/[term_slug]/

CREATE TABLE IF NOT EXISTS glossary_terms (
    term_slug TEXT PRIMARY KEY,
    term_name TEXT NOT NULL,
    category TEXT NOT NULL,
    definition TEXT NOT NULL,
    plain_english TEXT NOT NULL,
    technical_detail TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    related_terms TEXT NOT NULL DEFAULT '[]',   -- JSON array of slugs
    faqs TEXT NOT NULL DEFAULT '[]',            -- JSON array of {q, a}
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_glossary_category ON glossary_terms(category);
