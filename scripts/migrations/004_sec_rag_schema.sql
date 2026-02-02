-- SEC RAG System Schema
-- Migration: 004_sec_rag_schema.sql
--
-- Tracks RAG queries, document uploads, and usage analytics

-- Query logging for analytics and debugging
CREATE TABLE IF NOT EXISTS sec_rag_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    query TEXT NOT NULL,
    filters TEXT,                    -- JSON: tickers, docTypes, dateRange
    chunks_retrieved INTEGER,        -- How many chunks from vector search
    chunks_used INTEGER,             -- How many chunks after rerank
    latency_ms INTEGER,              -- Total query latency
    created_at TEXT DEFAULT (datetime('now'))
);

-- Index for user query history
CREATE INDEX IF NOT EXISTS idx_sec_rag_queries_email ON sec_rag_queries(email);
CREATE INDEX IF NOT EXISTS idx_sec_rag_queries_created ON sec_rag_queries(created_at);

-- Document tracking for OpenAI vector store
CREATE TABLE IF NOT EXISTS sec_rag_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    company_name TEXT NOT NULL,
    doc_type TEXT NOT NULL,          -- 10-K, 10-Q, 8-K, 20-F, 6-K, CALL
    filing_date TEXT NOT NULL,       -- YYYY-MM-DD
    period_end TEXT,                 -- YYYY-MM-DD
    fiscal_year INTEGER,
    fiscal_quarter INTEGER,
    accession_number TEXT,           -- SEC accession number (unique for filings)
    source_url TEXT,                 -- EDGAR URL or transcript source
    r2_key TEXT,                     -- R2 storage key for raw file
    openai_file_id TEXT,             -- OpenAI file ID in vector store
    chunk_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    processing_status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(ticker, doc_type, filing_date, accession_number)
);

-- Indexes for document queries
CREATE INDEX IF NOT EXISTS idx_sec_rag_documents_ticker ON sec_rag_documents(ticker);
CREATE INDEX IF NOT EXISTS idx_sec_rag_documents_doc_type ON sec_rag_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_sec_rag_documents_filing_date ON sec_rag_documents(filing_date);
CREATE INDEX IF NOT EXISTS idx_sec_rag_documents_status ON sec_rag_documents(processing_status);

-- Chunk tracking (optional - for detailed debugging)
CREATE TABLE IF NOT EXISTS sec_rag_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    section TEXT,                    -- MD&A, Risk Factors, etc.
    content_hash TEXT,               -- For deduplication
    token_count INTEGER,
    openai_file_id TEXT,             -- Each chunk uploaded as separate file
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES sec_rag_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_sec_rag_chunks_document ON sec_rag_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_sec_rag_chunks_section ON sec_rag_chunks(section);

-- Update sec_query_cache to ensure it exists with correct schema
CREATE TABLE IF NOT EXISTS sec_query_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash TEXT UNIQUE NOT NULL,
    query_text TEXT NOT NULL,
    filters TEXT,
    response TEXT NOT NULL,          -- JSON response
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_query_cache_hash ON sec_query_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_sec_query_cache_expires ON sec_query_cache(expires_at);
