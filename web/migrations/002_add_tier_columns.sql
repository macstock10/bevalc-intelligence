-- Migration: Add tier columns for Category Pro ($79) and Premier ($149) pricing
-- Run via: wrangler d1 execute bevalc-colas --remote --file=web/migrations/002_add_tier_columns.sql

-- tier: NULL = free, 'category_pro' = $79 single category, 'premier' = $149 full access
ALTER TABLE user_preferences ADD COLUMN tier TEXT DEFAULT NULL;

-- tier_category: top-level category code for category_pro users (e.g., 'WHISKEY', 'WINE', 'BEER')
ALTER TABLE user_preferences ADD COLUMN tier_category TEXT DEFAULT NULL;

-- category_changed_at: timestamp of last category change (for 1-week cooldown)
ALTER TABLE user_preferences ADD COLUMN category_changed_at TEXT DEFAULT NULL;

-- Index for finding users by tier
CREATE INDEX IF NOT EXISTS idx_user_prefs_tier ON user_preferences(tier);
