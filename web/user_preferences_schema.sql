-- User Preferences Schema for BevAlc Intelligence
-- Run this once via: wrangler d1 execute bevalc-colas --remote --file=user_preferences_schema.sql

-- Create user preferences table (does NOT touch colas table)
CREATE TABLE IF NOT EXISTS user_preferences (
    email TEXT PRIMARY KEY,
    stripe_customer_id TEXT,
    is_pro INTEGER DEFAULT 0,
    preferences_token TEXT UNIQUE,
    categories TEXT DEFAULT '[]',
    receive_free_report INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_user_prefs_token ON user_preferences(preferences_token);

-- Index for finding pro users
CREATE INDEX IF NOT EXISTS idx_user_prefs_pro ON user_preferences(is_pro);
