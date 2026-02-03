#!/usr/bin/env npx tsx
/**
 * Earnings Call Transcript Ingestion Script
 *
 * Reads local transcript PDFs, chunks them, stores full content in D1,
 * and uploads embeddings to Cloudflare Vectorize.
 *
 * Usage:
 *   npm run ingest:transcripts -- --path "C:\\path\\to\\file.pdf" --ticker BF.B --company "Brown-Forman" --callDate 2025-06-05 --fiscalYear 2025 --fiscalQuarter 4
 *   npm run ingest:transcripts -- --dir "C:\\Projects\\bevalc-intelligence\\scripts\\transcripts" --callDate 2025-06-05
 */

import { config } from 'dotenv';
import { resolve, basename, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { readFile, readdir, stat } from 'fs/promises';
import pdfParse from 'pdf-parse';
import { chunkDocument, deduplicateBoilerplate, countTokens } from './lib/chunker.js';
import { upsertRagChunksContent } from './lib/d1.js';
import { uploadChunksToVectorize } from './lib/vectorize.js';
import type { ParsedDocument, ParsedSection, DocumentChunk, DocType, Section } from './lib/types.js';

// Load .env from project root
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const { values: args } = parseArgs({
  options: {
    path: { type: 'string' },
    dir: { type: 'string' },
    ticker: { type: 'string' },
    company: { type: 'string' },
    callDate: { type: 'string' }, // YYYY-MM-DD
    fiscalYear: { type: 'string' },
    fiscalQuarter: { type: 'string' },
    sourceUrl: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

type ParsedFilename = {
  ticker?: string;
  company?: string;
  fiscalYear?: number;
  fiscalQuarter?: number;
};

function parseFilenameMetadata(name: string): ParsedFilename {
  const result: ParsedFilename = {};
  const tickerMatch = name.match(/\(([^)]+)\)/);
  if (tickerMatch) {
    result.ticker = tickerMatch[1].trim();
  }

  const companyPart = name.split('(')[0]?.trim();
  if (companyPart) {
    result.company = companyPart.replace(/\s+Transcript.*$/i, '').trim();
  }

  const quarterMatch = name.match(/Q([1-4])\s*(\d{4})/i);
  if (quarterMatch) {
    result.fiscalQuarter = parseInt(quarterMatch[1], 10);
    result.fiscalYear = parseInt(quarterMatch[2], 10);
  }

  return result;
}

function normalizeTranscriptText(text: string): string {
  let cleaned = text.replace(/\r/g, '');
  cleaned = cleaned.replace(/-\n(?=\w)/g, '');
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n');
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function buildParsedDocument(
  content: string,
  metadata: {
    ticker: string;
    company: string;
    callDate: string;
    fiscalYear: number;
    fiscalQuarter?: number;
    sourceUrl: string;
  }
): ParsedDocument {
  const section: ParsedSection = {
    type: 'Other' as Section,
    title: 'Earnings Call Transcript',
    content,
    startIndex: 0,
    endIndex: content.length,
  };

  return {
    ticker: metadata.ticker,
    company: metadata.company,
    docType: 'CALL' as DocType,
    filingDate: metadata.callDate,
    periodEnd: metadata.callDate,
    fiscalYear: metadata.fiscalYear,
    fiscalQuarter: metadata.fiscalQuarter,
    accessionNumber: `CALL-${metadata.callDate}`,
    sourceUrl: metadata.sourceUrl,
    sections: [section],
  };
}

async function getInputFiles(): Promise<string[]> {
  if (args.path) {
    return [resolve(String(args.path))];
  }

  const dir = args.dir ? resolve(String(args.dir)) : resolve(__dirname, '../transcripts');
  const entries = await readdir(dir);
  return entries
    .filter(name => extname(name).toLowerCase() === '.pdf')
    .map(name => resolve(dir, name));
}

async function processFile(filePath: string) {
  const fileName = basename(filePath);
  const inferred = parseFilenameMetadata(fileName);

  const ticker = String(args.ticker || inferred.ticker || '').trim();
  if (!ticker) {
    throw new Error(`Ticker required. Use --ticker. (File: ${fileName})`);
  }

  const company = String(args.company || inferred.company || ticker).trim();

  let fiscalYear = args.fiscalYear ? parseInt(String(args.fiscalYear), 10) : inferred.fiscalYear;
  if (!fiscalYear || Number.isNaN(fiscalYear)) {
    throw new Error(`Fiscal year required. Use --fiscalYear. (File: ${fileName})`);
  }

  let fiscalQuarter = args.fiscalQuarter ? parseInt(String(args.fiscalQuarter), 10) : inferred.fiscalQuarter;
  if (Number.isNaN(fiscalQuarter)) {
    fiscalQuarter = undefined;
  }

  let callDate = String(args.callDate || '').trim();
  if (!callDate) {
    const fileStats = await stat(filePath);
    callDate = fileStats.mtime.toISOString().slice(0, 10);
    console.warn(`No --callDate provided; using file modified date ${callDate} for ${fileName}`);
  }

  const sourceUrl = String(args.sourceUrl || filePath);

  const buffer = await readFile(filePath);
  const pdf = await pdfParse(buffer);
  const transcriptText = normalizeTranscriptText(pdf.text || '');
  if (!transcriptText) {
    throw new Error(`No text extracted from PDF: ${fileName}`);
  }

  const parsed = buildParsedDocument(transcriptText, {
    ticker,
    company,
    callDate,
    fiscalYear,
    fiscalQuarter,
    sourceUrl,
  });

  const chunks = chunkDocument(parsed);
  const tokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
  console.log(`Parsed ${fileName}: ${chunks.length} chunks (${tokens.toLocaleString()} tokens)`);

  const deduped = deduplicateBoilerplate(chunks);
  console.log(`After dedup: ${deduped.length} chunks`);

  if (args['dry-run']) {
    console.log('Dry run enabled. Skipping D1 and Vectorize uploads.');
    return { chunks: deduped, uploaded: 0, failed: 0, tokens };
  }

  if (deduped.length > 0) {
    console.log(`Storing ${deduped.length} chunks in D1 (sec_rag_chunks_content)...`);
    const rows = deduped.map(chunk => ({
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

  console.log(`Uploading ${deduped.length} chunks to Vectorize...`);
  const uploadResult = await uploadChunksToVectorize(deduped);

  return { chunks: deduped, uploaded: uploadResult.uploaded, failed: uploadResult.failed, tokens };
}

async function main() {
  console.log('=== Transcript Ingestion ===\n');

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable required');
  }

  const files = await getInputFiles();
  if (files.length === 0) {
    console.log('No PDF files found.');
    return;
  }

  const totals = { chunks: 0, uploaded: 0, failed: 0, tokens: 0 };

  for (const file of files) {
    const result = await processFile(file);
    totals.chunks += result.chunks.length;
    totals.uploaded += result.uploaded;
    totals.failed += result.failed;
    totals.tokens += result.tokens;
  }

  console.log('\n=== Transcript Ingestion Complete ===');
  console.log(`Chunks created: ${totals.chunks}`);
  console.log(`Chunks uploaded: ${totals.uploaded}`);
  console.log(`Chunks failed: ${totals.failed}`);
  console.log(`Total tokens: ${totals.tokens.toLocaleString()}`);
}

main().catch(error => {
  console.error('Transcript ingestion failed:', error);
  process.exit(1);
});
