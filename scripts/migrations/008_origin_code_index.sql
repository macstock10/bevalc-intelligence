-- Add index on origin_code for location page queries
CREATE INDEX IF NOT EXISTS idx_colas_origin_code ON colas(origin_code);

-- Composite index for state+category queries (location category pages)
CREATE INDEX IF NOT EXISTS idx_colas_origin_category ON colas(origin_code, category);
