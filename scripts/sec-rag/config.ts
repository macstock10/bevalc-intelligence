/**
 * SEC RAG Configuration
 *
 * Tickers, CIKs, and ingestion settings for BevAlc SEC filings
 */

export interface CompanyConfig {
  ticker: string;
  name: string;
  cik: string;  // SEC Central Index Key (10 digits, zero-padded)
  docTypes: ('10-K' | '10-Q' | '8-K' | '20-F' | '6-K' | 'CALL')[];
  isForeignFiler: boolean;
}

export const COMPANIES: CompanyConfig[] = [
  {
    ticker: 'BF.B',
    name: 'Brown-Forman Corporation',
    cik: '0000014693',
    docTypes: ['10-K', '10-Q', '8-K', 'CALL'],
    isForeignFiler: false,
  },
  {
    ticker: 'STZ',
    name: 'Constellation Brands, Inc.',
    cik: '0000016918',
    docTypes: ['10-K', '10-Q', '8-K', 'CALL'],
    isForeignFiler: false,
  },
  {
    ticker: 'TAP',
    name: 'Molson Coors Beverage Company',
    cik: '0000024545',
    docTypes: ['10-K', '10-Q', '8-K', 'CALL'],
    isForeignFiler: false,
  },
  {
    ticker: 'SAM',
    name: 'Boston Beer Company, Inc.',
    cik: '0000949870',
    docTypes: ['10-K', '10-Q', '8-K', 'CALL'],
    isForeignFiler: false,
  },
  {
    ticker: 'MGPI',
    name: 'MGP Ingredients, Inc.',
    cik: '0000835011',
    docTypes: ['10-K', '10-Q', '8-K', 'CALL'],
    isForeignFiler: false,
  },
  {
    ticker: 'DEO',
    name: 'Diageo plc',
    cik: '0001201139',
    docTypes: ['20-F', '6-K', 'CALL'],  // Foreign filer uses 20-F (annual) and 6-K (current)
    isForeignFiler: true,
  },
];

// Map ticker to company for quick lookup
export const TICKER_MAP = new Map(COMPANIES.map(c => [c.ticker, c]));
export const CIK_MAP = new Map(COMPANIES.map(c => [c.cik, c]));

// Ingestion settings
export const INGESTION_CONFIG = {
  // Chunk settings
  chunkMinTokens: 600,
  chunkMaxTokens: 900,
  chunkOverlapPercent: 0.15,  // 15% overlap

  // Historical depth
  backfillYears: {
    '10-K': 5,
    '20-F': 5,
    '10-Q': 3,
    '8-K': 2,
    '6-K': 2,
    'CALL': 2,
  },

  // EDGAR API settings
  edgarUserAgent: 'BevAlcIntelligence/1.0 (hello@bevalcintel.com)',
  edgarRateLimitMs: 100,  // SEC requires max 10 requests/second

  // Sections to extract (skip signatures, procedural content)
  includeSections: [
    'MD&A',           // Management's Discussion and Analysis
    'Risk Factors',
    'Business',
    'Financial Statements',
    'Controls and Procedures',
    'Legal Proceedings',
    'Market Risk',
    'Selected Financial Data',
    'Exhibit',        // 8-K Item 99.1 (press releases, earnings releases)
  ],

  // Boilerplate patterns to dedupe
  boilerplatePatterns: [
    /forward-looking statements/i,
    /safe harbor/i,
    /private securities litigation reform act/i,
    /actual results may differ materially/i,
    /we undertake no obligation to update/i,
  ],
};

// Query defaults
export const QUERY_DEFAULTS = {
  dateWindowQuarters: 8,  // Last 8 quarters
  defaultDocTypes: ['10-K', '10-Q', '20-F', 'CALL'] as const,
  retrieveTopK: 50,       // Get 50 from vector search
  rerankTopK: 15,         // Keep 15 after rerank
  maxContextTokens: 12000, // Max tokens to send to Claude
};

// OpenAI settings
export const OPENAI_CONFIG = {
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 768,
  vectorStoreName: 'bevalc-sec-filings',
};

// Cohere settings
export const COHERE_CONFIG = {
  rerankModel: 'rerank-english-v3.0',
};
