-- Email verification codes for login/activation
CREATE TABLE IF NOT EXISTS email_verification_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    send_count INTEGER DEFAULT 0,
    send_window_start TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_codes_expires ON email_verification_codes(expires_at);
