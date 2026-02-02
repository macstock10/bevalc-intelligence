/**
 * Type definitions for SEC RAG system
 */

// Document types
export type DocType = '10-K' | '10-Q' | '8-K' | '20-F' | '6-K' | 'CALL';

export type Section =
  | 'MD&A'
  | 'Risk Factors'
  | 'Business'
  | 'Financial Statements'
  | 'Controls and Procedures'
  | 'Legal Proceedings'
  | 'Market Risk'
  | 'Selected Financial Data'
  | 'Exhibit'   // 8-K exhibits (99.1 press releases, earnings releases, etc.)
  | 'Other';

// EDGAR filing metadata
export interface EdgarFiling {
  accessionNumber: string;
  filingDate: string;      // YYYY-MM-DD
  periodEndDate: string;   // YYYY-MM-DD
  form: string;            // 10-K, 10-Q, etc.
  fileUrl: string;         // Direct link to filing HTML
  cik: string;
}

// Parsed document
export interface ParsedDocument {
  ticker: string;
  company: string;
  docType: DocType;
  filingDate: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter?: number;  // 1-4 for 10-Q, undefined for 10-K
  accessionNumber: string;
  sourceUrl: string;
  sections: ParsedSection[];
}

export interface ParsedSection {
  type: Section;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

// Chunk for vector store
export interface DocumentChunk {
  id: string;              // Unique chunk ID
  content: string;         // Chunk text
  tokenCount: number;

  // Required metadata for retrieval
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  ticker: string;
  company: string;
  docType: DocType;
  filingDate: string;      // YYYY-MM-DD
  periodEnd: string;       // YYYY-MM-DD
  fiscalYear: number;
  fiscalQuarter?: number;
  section: Section;
  sourceUrl: string;
  accessionNumber: string;
  chunkIndex: number;      // Position within document
}

// Earnings call specific
export interface EarningsCall {
  ticker: string;
  company: string;
  callDate: string;        // YYYY-MM-DD
  fiscalYear: number;
  fiscalQuarter: number;
  title: string;
  participants: CallParticipant[];
  transcript: CallSegment[];
  sourceUrl: string;
}

export interface CallParticipant {
  name: string;
  title?: string;
  isExecutive: boolean;
  isAnalyst: boolean;
}

export interface CallSegment {
  speaker: string;
  role: 'executive' | 'analyst' | 'operator';
  content: string;
}

// Query types
export interface QueryFilters {
  tickers?: string[];
  docTypes?: DocType[];
  startDate?: string;      // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD
  sections?: Section[];
}

export interface QueryIntent {
  originalQuery: string;
  tickers: string[];       // Detected or default
  docTypes: DocType[];     // Detected or default
  dateWindow: {
    start: string;
    end: string;
  };
  sections?: Section[];
}

// Retrieved chunk with score
export interface RetrievedChunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
  score: number;           // Vector similarity score
  rerankScore?: number;    // Cohere rerank score
}

// Citation format
export interface Citation {
  ticker: string;
  company: string;
  docType: DocType;
  filingDate: string;
  fiscalYear: number;
  fiscalQuarter?: number;
  section: Section;
  sourceUrl: string;
  quote: string;           // Verbatim substring from chunk
  chunkId: string;
}

// Query response
export interface QueryResponse {
  answerMarkdown: string;
  citations: Citation[];
  retrievalDebug: {
    query: string;
    filters: QueryFilters;
    retrievedChunks: Array<{
      id: string;
      score: number;
      ticker: string;
      docType: DocType;
      section: Section;
    }>;
    rerankedTop: Array<{
      id: string;
      rerankScore: number;
      ticker: string;
      docType: DocType;
      section: Section;
    }>;
    tokenUsage: {
      embedding: number;
      context: number;
      generation: number;
    };
    latencyMs: {
      retrieval: number;
      rerank: number;
      generation: number;
      total: number;
    };
  };
}

// Error response when insufficient coverage
export interface InsufficientCoverageResponse {
  error: 'insufficient_coverage';
  message: string;
  searched: {
    tickers: string[];
    dateRange: { start: string; end: string };
    docTypes: DocType[];
  };
  chunksRetrieved: number;
}
