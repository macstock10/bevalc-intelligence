-- TTB Distilled Spirits Statistics Schema
-- Data source: https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/statistics

-- Monthly and yearly statistics (yearly has month = NULL)
CREATE TABLE IF NOT EXISTS ttb_spirits_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER,  -- NULL for yearly aggregates
    statistical_group TEXT NOT NULL,  -- e.g., "1-Distilled Spirits Production"
    statistical_category TEXT NOT NULL,  -- e.g., "0-Category Total"
    statistical_detail TEXT NOT NULL,  -- e.g., "1-Whisky"
    count_ims INTEGER,  -- Number of industry members reporting
    value INTEGER,  -- The metric value (proof gallons, pounds, count)
    is_redacted INTEGER DEFAULT 0,  -- 1 if data was suppressed
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(year, month, statistical_group, statistical_category, statistical_detail)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_spirits_stats_year ON ttb_spirits_stats(year);
CREATE INDEX IF NOT EXISTS idx_spirits_stats_year_month ON ttb_spirits_stats(year, month);
CREATE INDEX IF NOT EXISTS idx_spirits_stats_group ON ttb_spirits_stats(statistical_group);
CREATE INDEX IF NOT EXISTS idx_spirits_stats_detail ON ttb_spirits_stats(statistical_detail);

-- Producer rankings by size tier
CREATE TABLE IF NOT EXISTS ttb_producer_rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    size_tier TEXT NOT NULL,  -- e.g., "0-50K PG", "50K-100K PG", etc.
    producer_count INTEGER,  -- Number of producers in this tier
    total_removals INTEGER,  -- Total proof gallons removed
    avg_removals INTEGER,  -- Average removals per producer
    pct_of_total REAL,  -- Percentage of total industry removals
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(year, size_tier)
);

CREATE INDEX IF NOT EXISTS idx_producer_rankings_year ON ttb_producer_rankings(year);

-- Track data freshness and sync status
CREATE TABLE IF NOT EXISTS ttb_stats_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_type TEXT NOT NULL,  -- 'monthly', 'yearly', 'producer_rankings'
    source_url TEXT,
    records_synced INTEGER,
    last_data_year INTEGER,  -- Most recent year in the data
    last_data_month INTEGER,  -- Most recent month (for monthly data)
    synced_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'success',  -- 'success', 'error', 'partial'
    error_message TEXT
);

-- Generated articles/content
CREATE TABLE IF NOT EXISTS ttb_stats_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_type TEXT NOT NULL,  -- 'monthly_recap', 'yearly_analysis', 'category_deep_dive'
    year INTEGER NOT NULL,
    month INTEGER,  -- NULL for yearly articles
    category TEXT,  -- NULL for overview, or specific like 'Whisky', 'Vodka'
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,  -- Full article markdown
    excerpt TEXT,  -- Short summary for listings
    data_snapshot TEXT,  -- JSON of key stats used in article
    status TEXT DEFAULT 'draft',  -- 'draft', 'published', 'archived'
    created_at TEXT DEFAULT (datetime('now')),
    published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_type ON ttb_stats_articles(article_type);
CREATE INDEX IF NOT EXISTS idx_articles_year_month ON ttb_stats_articles(year, month);
CREATE INDEX IF NOT EXISTS idx_articles_status ON ttb_stats_articles(status);

-- Reference table for statistical groups (for easier querying)
CREATE TABLE IF NOT EXISTS ttb_stat_groups (
    code TEXT PRIMARY KEY,  -- e.g., "1"
    name TEXT NOT NULL,  -- e.g., "Distilled Spirits Production"
    full_code TEXT,  -- e.g., "1-Distilled Spirits Production"
    description TEXT,
    unit TEXT  -- 'proof_gallons', 'wine_gallons', 'pounds', 'count'
);

-- Seed reference data for statistical groups
INSERT OR IGNORE INTO ttb_stat_groups (code, name, full_code, unit) VALUES
('01', 'Count of IMs', '01-Count of IMs', 'count'),
('1', 'Distilled Spirits Production', '1-Distilled Spirits Production', 'proof_gallons'),
('2', 'Raw Materials Used', '2-Raw Materials Used', 'pounds'),
('3', 'Bottled in Bond for Domestic Use', '3-Bottled in Bond for Domestic Use', 'proof_gallons'),
('4', 'Tax Paid Withdrawals', '4-Tax Paid Withdrawals', 'proof_gallons'),
('5', 'Withdrawn Tax Free', '5-Withdrawn Tax Free', 'proof_gallons'),
('6', 'Bottled For Domestic Use', '6-Bottled For Domestic Use (in WG)', 'wine_gallons'),
('7', 'Bottled For Export', '7-Bottled For Export (in WG)', 'wine_gallons'),
('8', 'Domestic Whisky Bottled in Bond', '8-Domestic Whisky Bottled in Bond', 'proof_gallons'),
('9', 'Spirits Denatured', '9-Spirits Denatured', 'proof_gallons'),
('10', 'Other Ingredients Mixed with Spirits', '10-Other Ingredients Mixed with Spirits', 'wine_gallons'),
('11', 'Bottled Imports', '11-Bottled Imports', 'proof_gallons'),
('12', 'Bulk Imports', '12-Bulk Imports', 'proof_gallons');
