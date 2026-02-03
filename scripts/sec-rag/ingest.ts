#!/usr/bin/env npx tsx
/**
 * SEC Filing Ingestion Script
 *
 * Downloads SEC filings from EDGAR, parses them, chunks them,
 * and uploads to OpenAI vector store.
 *
 * Usage:
 *   npm run ingest -- --backfill           # Full historical backfill
 *   npm run ingest -- --incremental        # Last 7 days only
 *   npm run ingest -- --ticker BF.B        # Single company
 *   npm run ingest -- --tickers STZ,TAP    # Multiple companies
 *   npm run ingest -- --year 2025          # Only filings from a specific year
 *   npm run ingest -- --clear              # Clear vector store first
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });
import { parseArgs } from 'util';
import {
  COMPANIES,
  INGESTION_CONFIG,
  TICKER_MAP,
  type CompanyConfig,
} from './config.js';
import {
  getCompanyFilings,
  filterFilingsByDate,
  downloadFiling,
  downloadFilingByUrl,
  getFilingIndex,
  getFilingDocumentUrl,
  type EdgarFiling,
} from './lib/edgar.js';
import {
  parseFilingHtml,
  parse8K,
  parse6K,
  parseExhibitHtml,
} from './lib/parser.js';
import {
  chunkDocument,
  deduplicateBoilerplate,
  countTokens,
} from './lib/chunker.js';
import { upsertRagChunksContent } from './lib/d1.js';
import {
  getOrCreateVectorStore,
  uploadChunksIndividually,
  clearVectorStore,
} from './lib/vectorstore.js';
import { uploadChunksToVectorize } from './lib/vectorize.js';
import type { DocumentChunk, DocType } from './lib/types.js';
import { ingestXbrlFactsForFilings } from './lib/xbrl.js';

// Parse CLI arguments
const { values: args } = parseArgs({
  options: {
    backfill: { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    ticker: { type: 'string' },
    tickers: { type: 'string' },
    year: { type: 'string' },
    clear: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'skip-xbrl': { type: 'boolean', default: false },
  },
});

async function main() {
  console.log('=== SEC Filing Ingestion ===\n');

  // Validate environment
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable required');
  }

  // Determine which companies to process
  let companies: CompanyConfig[];
  if (args.tickers) {
    const tickerList = String(args.tickers)
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const unknown = tickerList.filter(t => !TICKER_MAP.has(t));
    if (unknown.length > 0) {
      throw new Error(`Unknown tickers: ${unknown.join(', ')}`);
    }
    companies = tickerList.map(t => TICKER_MAP.get(t)!);
  } else if (args.ticker) {
    const company = TICKER_MAP.get(args.ticker);
    if (!company) {
      throw new Error(`Unknown ticker: ${args.ticker}`);
    }
    companies = [company];
  } else {
    companies = [...COMPANIES];
  }

  console.log(`Processing ${companies.length} companies: ${companies.map(c => c.ticker).join(', ')}\n`);

  // Get or create vector store
  const vectorStoreId = await getOrCreateVectorStore();
  console.log(`Vector store ID: ${vectorStoreId}\n`);

  // Clear if requested
  if (args.clear) {
    console.log('Clearing vector store...');
    const deleted = await clearVectorStore(vectorStoreId);
    console.log(`Deleted ${deleted} files\n`);
  }

  // Track stats
  const stats = {
    filingsProcessed: 0,
    chunksCreated: 0,
    chunksUploaded: 0,
    chunksFailed: 0,
    totalTokens: 0,
  };

  // Process each company
  for (const company of companies) {
    console.log(`\n--- ${company.ticker}: ${company.name} ---`);

    try {
      await processCompany(company, vectorStoreId, stats, args);
    } catch (error) {
      console.error(`Error processing ${company.ticker}:`, error);
    }
  }

  // Print summary
  console.log('\n=== Ingestion Complete ===');
  console.log(`Filings processed: ${stats.filingsProcessed}`);
  console.log(`Chunks created: ${stats.chunksCreated}`);
  console.log(`Chunks uploaded: ${stats.chunksUploaded}`);
  console.log(`Chunks failed: ${stats.chunksFailed}`);
  console.log(`Total tokens: ${stats.totalTokens.toLocaleString()}`);
}

async function processCompany(
  company: CompanyConfig,
  vectorStoreId: string,
  stats: typeof stats,
  args: { backfill?: boolean; incremental?: boolean; 'dry-run'?: boolean; year?: string; 'skip-xbrl'?: boolean }
) {
  // Fetch filing list from EDGAR
  console.log(`Fetching filings from EDGAR...`);
  const allFilings = await getCompanyFilings(company.cik, company.docTypes as DocType[]);
  console.log(`Found ${allFilings.length} filings total`);

  // Filter by date
  let filings: EdgarFiling[];
  if (args.incremental) {
    // Last 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    filings = allFilings.filter(f => f.filingDate >= cutoffStr);
    console.log(`Incremental mode: ${filings.length} filings in last 7 days`);
  } else if (args.backfill) {
    // Apply per-doctype backfill limits
    filings = [];
    for (const docType of company.docTypes) {
      const docFilings = allFilings.filter(f => f.form === docType);
      const filtered = filterFilingsByDate(docFilings, docType as DocType, INGESTION_CONFIG.backfillYears);
      filings.push(...filtered);
    }
    console.log(`Backfill mode: ${filings.length} filings within date limits`);
  } else {
    // Default: last year
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    filings = allFilings.filter(f => f.filingDate >= cutoffStr);
    console.log(`Default mode: ${filings.length} filings in last year`);
  }

  if (args.year) {
    const yearStr = String(args.year);
    filings = filings.filter(f => f.filingDate.startsWith(`${yearStr}-`));
    console.log(`Year filter: ${filings.length} filings in ${yearStr}`);
  }

  if (filings.length === 0) {
    console.log('No filings to process');
    return;
  }

  if (!args['dry-run'] && !args['skip-xbrl']) {
    try {
      console.log('Fetching XBRL company facts...');
      const xbrlResult = await ingestXbrlFactsForFilings(
        company.cik,
        company.ticker,
        filings.map(f => ({ accessionNumber: f.accessionNumber, form: f.form }))
      );
      console.log(`XBRL facts: ${xbrlResult.storedFacts} stored (scanned ${xbrlResult.totalFacts})`);
    } catch (error) {
      console.error('XBRL ingestion failed (non-fatal):', error);
    }
  }

  // Process each filing
  const allChunks: DocumentChunk[] = [];

  for (const filing of filings) {
    console.log(`\nProcessing ${filing.form} filed ${filing.filingDate}...`);

    try {
      // Download filing
      const html = await downloadFiling(filing);
      console.log(`  Downloaded ${(html.length / 1024).toFixed(0)} KB`);

      // Parse filing
      let parsed;
      if (filing.form === '8-K') {
        parsed = parse8K(html, filing, company.ticker, company.name);

        // Attempt to pull Exhibit 99.1 from filing index (press release / earnings release)
        try {
          const index = await getFilingIndex(company.cik, filing.accessionNumber);
          const exhibitFile = findExhibit99File(index?.directory?.item || []);
          if (exhibitFile) {
            const exhibitUrl = getFilingDocumentUrl(company.cik, filing.accessionNumber, exhibitFile.name);
            const exhibitHtml = await downloadFilingByUrl(exhibitUrl);
            const exhibitSection = parseExhibitHtml(
              exhibitHtml,
              `Exhibit 99.1 (${exhibitFile.name})`,
              exhibitUrl
            );
            if (exhibitSection) {
              parsed.sections.push(exhibitSection);
              console.log(`  Added Exhibit 99.1 section from ${exhibitFile.name}`);
            }
          }
        } catch (e) {
          console.warn('  Exhibit 99.1 fetch failed (non-fatal):', e?.message || e);
        }
      } else if (filing.form === '6-K') {
        parsed = parse6K(html, filing, company.ticker, company.name);
      } else {
        parsed = parseFilingHtml(html, filing, company.ticker, company.name);
      }

      console.log(`  Parsed ${parsed.sections.length} sections`);

      // Chunk document
      const chunks = chunkDocument(parsed);
      console.log(`  Created ${chunks.length} chunks`);

      // Track tokens
      const tokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      console.log(`  Total tokens: ${tokens.toLocaleString()}`);

      allChunks.push(...chunks);
      stats.filingsProcessed++;
      stats.chunksCreated += chunks.length;
      stats.totalTokens += tokens;
    } catch (error) {
      console.error(`  Error processing filing:`, error);
    }
  }

  // Deduplicate boilerplate across chunks
  console.log(`\nDeduplicating boilerplate across ${allChunks.length} chunks...`);
  const dedupedChunks = deduplicateBoilerplate(allChunks);
  console.log(`After dedup: ${dedupedChunks.length} chunks`);

  // Persist chunk content to D1 for quote validation
  if (dedupedChunks.length > 0) {
    console.log(`Storing ${dedupedChunks.length} chunks in D1 (sec_rag_chunks_content)...`);
    const rows = dedupedChunks.map(chunk => ({
      id: chunk.id,
      ticker: chunk.metadata.ticker,
      doc_type: chunk.metadata.docType,
      filing_date: chunk.metadata.filingDate,
      section: chunk.metadata.section,
      source_url: chunk.metadata.sourceUrl,
      accession_number: chunk.metadata.accessionNumber,
      fiscal_year: chunk.metadata.fiscalYear,
      fiscal_quarter: chunk.metadata.fiscalQuarter,
      content: chunk.content,
    }));
    await upsertRagChunksContent(rows);
  }

  if (args['dry-run']) {
    console.log('\nDry run - skipping upload');
    return;
  }

  // Upload to Cloudflare Vectorize (fast retrieval)
  if (dedupedChunks.length > 0) {
    console.log(`\nUploading ${dedupedChunks.length} chunks to Cloudflare Vectorize...`);
    const { uploaded, failed } = await uploadChunksToVectorize(dedupedChunks);
    stats.chunksUploaded += uploaded;
    stats.chunksFailed += failed;
    console.log(`Uploaded: ${uploaded}, Failed: ${failed}`);
  }
}

// Declare stats type for function signature
const stats = {
  filingsProcessed: 0,
  chunksCreated: 0,
  chunksUploaded: 0,
  chunksFailed: 0,
  totalTokens: 0,
};

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

function findExhibit99File(items: Array<{ name: string; type: string; size: number }>): { name: string } | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const candidates = items.filter(item => {
    const name = item.name.toLowerCase();
    if (!name.endsWith('.htm') && !name.endsWith('.html') && !name.endsWith('.txt')) {
      return false;
    }
    return (
      /ex-?99\.?0?1/.test(name) ||
      /ex99\.?0?1/.test(name) ||
      /exhibit-?99\.?0?1/.test(name) ||
      /(^|[^0-9])99\.?0?1/.test(name)
    );
  });

  if (candidates.length === 0) return null;

  // Prefer explicit exhibit naming over generic 99.1
  const preferred = candidates.find(c => c.name.toLowerCase().includes('ex-99')) || candidates[0];
  return { name: preferred.name };
}
