-- Migration: Store SEC RAG chunk content in D1 for quote validation
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS sec_rag_chunks_content (
    id TEXT PRIMARY KEY,           -- Vectorize chunk ID
    ticker TEXT,
    doc_type TEXT,
    filing_date TEXT,
    section TEXT,
    source_url TEXT,
    accession_number TEXT,
    fiscal_year INTEGER,
    fiscal_quarter INTEGER,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_rag_chunks_content_ticker ON sec_rag_chunks_content(ticker);
CREATE INDEX IF NOT EXISTS idx_sec_rag_chunks_content_doc_type ON sec_rag_chunks_content(doc_type);
CREATE INDEX IF NOT EXISTS idx_sec_rag_chunks_content_filing_date ON sec_rag_chunks_content(filing_date);
