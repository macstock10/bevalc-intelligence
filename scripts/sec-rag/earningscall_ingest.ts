#!/usr/bin/env npx tsx
/**
 * EarningsCall.biz Transcript Ingestion Script
 *
 * Fetches earnings call transcripts via API, chunks them, stores full content in D1,
 * and uploads embeddings to Cloudflare Vectorize.
 *
 * Usage:
 *   npm run ingest:earningscall -- --tickers BF.B,SAM --year 2025 --quarter 4
 *   npm run ingest:earningscall -- --ticker BF.B --year 2025 --quarters 1,2,3,4
 *   npm run ingest:earningscall -- --year 2025 --quarters 1,2,3,4
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { chunkDocument, deduplicateBoilerplate } from './lib/chunker.js';
import { upsertRagChunksContent } from './lib/d1.js';
import { uploadChunksToVectorize } from './lib/vectorize.js';
import { COMPANIES, TICKER_MAP } from './config.js';
import type { ParsedDocument, ParsedSection, DocType, Section } from './lib/types.js';

// Load .env from project root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const { values: args } = parseArgs({
  options: {
    ticker: { type: 'string' },
    tickers: { type: 'string' },
    year: { type: 'string' },
    quarter: { type: 'string' },
    quarters: { type: 'string' },
    level: { type: 'string' }, // API "level" parameter (1-3 depending on plan)
    'dry-run': { type: 'boolean', default: false },
  },
});

type SymbolEntry = {
  exchange: string;
  symbol: string;
  name?: string;
};

function normalizeTicker(ticker: string): string {
  return ticker.toUpperCase().trim();
}

function parseQuarterList(): number[] {
  if (args.quarter) {
    return [parseInt(String(args.quarter), 10)];
  }
  if (args.quarters) {
    return String(args.quarters)
      .split(',')
      .map(q => parseInt(q.trim(), 10))
      .filter(q => q >= 1 && q <= 4);
  }
  return [1, 2, 3, 4];
}

function quarterEndDate(year: number, quarter: number): string {
  switch (quarter) {
    case 1: return `${year}-03-31`;
    case 2: return `${year}-06-30`;
    case 3: return `${year}-09-30`;
    case 4: return `${year}-12-31`;
    default: return `${year}-12-31`;
  }
}

function splitTranscriptSections(content: string): ParsedSection[] {
  const normalized = content.replace(/\r/g, '');
  const qaMatch = normalized.search(/question[-\s]*and[-\s]*answer|q&a|questions\s+and\s+answers/i);

  if (qaMatch === -1) {
    return [{
      type: 'Other' as Section,
      title: 'Earnings Call Transcript',
      content: normalized.trim(),
      startIndex: 0,
      endIndex: normalized.length,
    }];
  }

  const prepared = normalized.slice(0, qaMatch).trim();
  const qa = normalized.slice(qaMatch).trim();
  const sections: ParsedSection[] = [];

  if (prepared.length > 200) {
    sections.push({
      type: 'Prepared Remarks' as Section,
      title: 'Prepared Remarks',
      content: prepared,
      startIndex: 0,
      endIndex: qaMatch,
    });
  }

  sections.push({
    type: 'Q&A' as Section,
    title: 'Q&A',
    content: qa,
    startIndex: qaMatch,
    endIndex: normalized.length,
  });

  return sections;
}

function buildParsedDocument(
  content: string,
  metadata: {
    ticker: string;
    company: string;
    callDate: string;
    fiscalYear: number;
    fiscalQuarter: number;
    sourceUrl: string;
  }
): ParsedDocument {
  const sections = splitTranscriptSections(content);

  return {
    ticker: metadata.ticker,
    company: metadata.company,
    docType: 'CALL' as DocType,
    filingDate: metadata.callDate,
    periodEnd: metadata.callDate,
    fiscalYear: metadata.fiscalYear,
    fiscalQuarter: metadata.fiscalQuarter,
    accessionNumber: `${metadata.ticker}-CALL-${metadata.fiscalYear}Q${metadata.fiscalQuarter}`,
    sourceUrl: metadata.sourceUrl,
    sections,
  };
}

async function fetchSymbols(apiKey: string): Promise<Map<string, SymbolEntry[]>> {
  const resp = await fetch(`https://v2.api.earningscall.biz/symbols?apikey=${apiKey}`);
  if (!resp.ok) {
    throw new Error(`EarningsCall symbols error: ${await resp.text()}`);
  }
  const data = await resp.json();
  const map = new Map<string, SymbolEntry[]>();
  for (const entry of data || []) {
    if (!entry?.symbol || !entry?.exchange) continue;
    const key = normalizeTicker(entry.symbol);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ exchange: entry.exchange, symbol: entry.symbol, name: entry.name });
  }
  return map;
}

async function fetchTranscript(
  apiKey: string,
  exchange: string,
  symbol: string,
  year: number,
  quarter: number,
  level?: string
): Promise<{ text: string; callDate?: string } | null> {
  const params = new URLSearchParams({
    apikey: apiKey,
    exchange,
    symbol,
    year: String(year),
    quarter: String(quarter),
  });
  if (level) params.set('level', level);

  const url = `https://v2.api.earningscall.biz/transcript?${params.toString()}`;
  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`EarningsCall transcript error: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const text = data?.text || data?.transcript || data?.content || '';
  const callDate = data?.date || data?.call_date || data?.callDate || data?.event_date || null;
  return text ? { text: String(text).trim(), callDate: callDate ? String(callDate).slice(0, 10) : undefined } : null;
}

async function main() {
  console.log('=== EarningsCall.biz Ingestion ===\n');

  const apiKey = process.env.EARNINGS_BIZ_API_KEY || process.env.EARNINGSCALL_API_KEY || process.env.EARNINGS_CALL_API_KEY;
  if (!apiKey) {
    throw new Error('EARNINGS_BIZ_API_KEY required in .env');
  }

  const year = args.year ? parseInt(String(args.year), 10) : NaN;
  if (!year || Number.isNaN(year)) {
    throw new Error('Year required. Use --year 2025');
  }

  let tickers: string[] = [];
  if (args.tickers) {
    tickers = String(args.tickers).split(',').map(normalizeTicker).filter(Boolean);
  } else if (args.ticker) {
    tickers = [normalizeTicker(String(args.ticker))];
  } else {
    tickers = COMPANIES.map(c => c.ticker);
  }

  const quarters = parseQuarterList();
  const level = args.level ? String(args.level) : undefined;

  console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Year: ${year}, Quarters: ${quarters.join(', ')}`);
  if (level) console.log(`Level: ${level}`);

  const symbolsMap = await fetchSymbols(apiKey);
  const totals = { chunks: 0, uploaded: 0, failed: 0 };

  for (const ticker of tickers) {
    const company = TICKER_MAP.get(ticker)?.name || ticker;
    const symbolChoices = symbolsMap.get(ticker);
    if (!symbolChoices || symbolChoices.length === 0) {
      console.warn(`No symbol mapping found for ${ticker}. Skipping.`);
      continue;
    }

    // Prefer NYSE/NASDAQ/OTC if multiple exchanges
    const preferred = symbolChoices.find(s => ['NYSE', 'NASDAQ', 'OTC', 'OTCQX', 'OTCQB'].includes(String(s.exchange).toUpperCase()))
      || symbolChoices[0];

    console.log(`\n--- ${ticker} (${company}) @ ${preferred.exchange} ---`);

    for (const q of quarters) {
      const transcript = await fetchTranscript(apiKey, preferred.exchange, preferred.symbol, year, q, level);
      if (!transcript) {
        console.log(`Q${q} ${year}: no transcript`);
        continue;
      }

      const callDate = transcript.callDate || quarterEndDate(year, q);
      const parsed = buildParsedDocument(transcript.text, {
        ticker,
        company,
        callDate,
        fiscalYear: year,
        fiscalQuarter: q,
        sourceUrl: `earningscall.biz:${preferred.exchange}:${preferred.symbol}:${year}:Q${q}`,
      });

      const chunks = deduplicateBoilerplate(chunkDocument(parsed));
      console.log(`Q${q} ${year}: ${chunks.length} chunks`);

      if (args['dry-run']) {
        totals.chunks += chunks.length;
        continue;
      }

      if (chunks.length > 0) {
        const rows = chunks.map(chunk => ({
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

      const upload = await uploadChunksToVectorize(chunks);
      totals.chunks += chunks.length;
      totals.uploaded += upload.uploaded;
      totals.failed += upload.failed;
    }
  }

  console.log('\n=== EarningsCall.biz Ingestion Complete ===');
  console.log(`Chunks created: ${totals.chunks}`);
  console.log(`Chunks uploaded: ${totals.uploaded}`);
  console.log(`Chunks failed: ${totals.failed}`);
}

main().catch(error => {
  console.error('EarningsCall.biz ingestion failed:', error);
  process.exit(1);
});
