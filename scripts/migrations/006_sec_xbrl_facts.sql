-- Migration: Store SEC XBRL facts for numeric financial data

CREATE TABLE IF NOT EXISTS sec_xbrl_facts (
  id TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  ticker TEXT,
  accession_number TEXT NOT NULL,
  form TEXT,
  filing_date TEXT,
  period_start TEXT,
  period_end TEXT,
  fiscal_year INTEGER,
  fiscal_period TEXT,
  taxonomy TEXT NOT NULL,
  concept TEXT NOT NULL,
  label TEXT,
  unit TEXT,
  value_text TEXT,
  value_num REAL,
  frame TEXT,
  segment_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_xbrl_facts_cik ON sec_xbrl_facts(cik);
CREATE INDEX IF NOT EXISTS idx_sec_xbrl_facts_accession ON sec_xbrl_facts(accession_number);
CREATE INDEX IF NOT EXISTS idx_sec_xbrl_facts_concept ON sec_xbrl_facts(concept);
CREATE INDEX IF NOT EXISTS idx_sec_xbrl_facts_period_end ON sec_xbrl_facts(period_end);
CREATE INDEX IF NOT EXISTS idx_sec_xbrl_facts_filing_date ON sec_xbrl_facts(filing_date);
