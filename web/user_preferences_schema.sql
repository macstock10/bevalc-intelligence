-- User Preferences Schema for BevAlc Intelligence
-- Run this once via: wrangler d1 execute bevalc-colas --remote --file=user_preferences_schema.sql

-- Create user preferences table (does NOT touch colas table)
CREATE TABLE IF NOT EXISTS user_preferences (
    email TEXT PRIMARY KEY,
    stripe_customer_id TEXT,
    is_pro INTEGER DEFAULT 0,
    tier TEXT DEFAULT NULL,                    -- 'category_pro' ($79) or 'premier' ($149)
    tier_category TEXT DEFAULT NULL,           -- Selected category for category_pro users
    category_changed_at TEXT DEFAULT NULL,     -- Timestamp of last category change (for 1-week cooldown)
    preferences_token TEXT UNIQUE,
    categories TEXT DEFAULT '[]',              -- JSON array for premier users (multi-category)
    receive_free_report INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_user_prefs_token ON user_preferences(preferences_token);

-- Index for finding pro users
CREATE INDEX IF NOT EXISTS idx_user_prefs_pro ON user_preferences(is_pro);

-- Index for finding users by tier
CREATE INDEX IF NOT EXISTS idx_user_prefs_tier ON user_preferences(tier);
