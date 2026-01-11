-- Migration 002: Add credit columns to user_preferences
-- Run with: npx wrangler d1 execute bevalc-colas --remote --file=../scripts/migrations/002_user_credits.sql

-- Add credit tracking columns
ALTER TABLE user_preferences ADD COLUMN enhancement_credits INTEGER DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN monthly_enhancements_used INTEGER DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN monthly_reset_date TEXT;
