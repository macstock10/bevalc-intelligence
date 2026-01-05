-- Add signal column to colas table
-- Values: NEW_BRAND, NEW_SKU, REFILE, or NULL (for historical records)

ALTER TABLE colas ADD COLUMN signal TEXT;

-- Create index for faster queries by signal
CREATE INDEX IF NOT EXISTS idx_colas_signal ON colas(signal);
