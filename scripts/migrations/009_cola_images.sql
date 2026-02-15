-- Migration 009: Create cola_images and cola_image_barcodes tables
-- Source of truth: enhancements/architecture/DATA_MODEL.md

CREATE TABLE IF NOT EXISTS cola_images (
    id INTEGER PRIMARY KEY,
    ttb_id TEXT NOT NULL,
    image_id TEXT UNIQUE NOT NULL,           -- Format: "{ttb_id}-{sequence}"
    label_type TEXT,                          -- "front", "back", "neck", "strip", "other"
    ttb_original_url TEXT,                    -- Full URL on TTB's site
    r2_key TEXT,                              -- Cloudflare R2 storage key
    r2_thumbnail_key TEXT,                    -- R2 key for web-optimized thumbnail
    width INTEGER,                            -- Image width in pixels
    height INTEGER,                           -- Image height in pixels
    file_size INTEGER,                        -- File size in bytes
    ocr_text TEXT,                            -- Full raw OCR text from image
    ocr_abv REAL,                             -- ABV extracted from OCR text
    ocr_volume_ml INTEGER,                    -- Volume in mL extracted from OCR text
    ocr_proof INTEGER,                        -- Proof extracted from OCR text
    ocr_age_years INTEGER,                    -- Age in years extracted from OCR text
    ocr_website TEXT,                         -- Website URL extracted from OCR text
    ocr_email TEXT,                           -- Email extracted from OCR text
    ocr_phone TEXT,                           -- Phone extracted from OCR text
    ocr_quality_score TEXT,                   -- "good", "partial", "poor", "failed"
    download_status TEXT,                     -- "success", "failed", "timeout", "corrupt", "missing"
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cola_images_ttb_id ON cola_images(ttb_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cola_images_image_id ON cola_images(image_id);

CREATE TABLE IF NOT EXISTS cola_image_barcodes (
    id INTEGER PRIMARY KEY,
    image_id TEXT NOT NULL,                   -- FK → cola_images.image_id
    ttb_id TEXT NOT NULL,                     -- Denormalized for query convenience
    barcode_value TEXT,                       -- Decoded barcode string
    barcode_type TEXT,                        -- "UPC-A", "UPC-E", "EAN-13", "EAN-8", "QR", etc.
    confidence REAL,                          -- Detection confidence 0-1
    bbox_x INTEGER,                           -- Bounding box X coordinate
    bbox_y INTEGER,                           -- Bounding box Y coordinate
    bbox_width INTEGER,                       -- Bounding box width
    bbox_height INTEGER,                      -- Bounding box height
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_barcodes_ttb_id ON cola_image_barcodes(ttb_id);
CREATE INDEX IF NOT EXISTS idx_barcodes_value ON cola_image_barcodes(barcode_value);
