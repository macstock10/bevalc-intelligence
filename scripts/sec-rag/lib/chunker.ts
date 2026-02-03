/**
 * Document Chunker
 *
 * Splits documents into 600-900 token chunks with 15% overlap
 * Uses tiktoken for accurate token counting
 */

import { encoding_for_model } from 'tiktoken';
import { INGESTION_CONFIG } from '../config.js';
import type { ParsedDocument, ParsedSection, DocumentChunk, ChunkMetadata } from './types.js';

// Initialize tokenizer (match embedding model where possible)
const encoder = encoding_for_model('text-embedding-3-small');

/**
 * Count tokens in text
 */
export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Chunk a parsed document into vector-store-ready chunks
 */
export function chunkDocument(doc: ParsedDocument): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const section of doc.sections) {
    const sectionChunks = chunkSection(section, doc, globalChunkIndex);
    chunks.push(...sectionChunks);
    globalChunkIndex += sectionChunks.length;
  }

  return chunks;
}

/**
 * Chunk a single section with overlap
 */
function chunkSection(
  section: ParsedSection,
  doc: ParsedDocument,
  startIndex: number
): DocumentChunk[] {
  const { chunkMinTokens, chunkMaxTokens, chunkOverlapPercent } = INGESTION_CONFIG;
  const overlapTokens = Math.floor(chunkMaxTokens * chunkOverlapPercent);

  const chunks: DocumentChunk[] = [];
  const text = section.content;
  const sentences = splitIntoSentences(text);

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = startIndex;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = countTokens(sentence);

    // If adding this sentence would exceed max, save current chunk
    if (currentTokens + sentenceTokens > chunkMaxTokens && currentTokens >= chunkMinTokens) {
      // Save chunk
      const chunkText = currentChunk.join(' ');
      chunks.push(createChunk(chunkText, doc, section, chunkIndex));
      chunkIndex++;

      // Calculate overlap - keep last N tokens worth of sentences
      let overlapText = '';
      let overlapCount = 0;
      for (let j = currentChunk.length - 1; j >= 0 && overlapCount < overlapTokens; j--) {
        overlapText = currentChunk[j] + ' ' + overlapText;
        overlapCount += countTokens(currentChunk[j]);
      }

      // Start new chunk with overlap
      currentChunk = overlapText.trim() ? [overlapText.trim()] : [];
      currentTokens = overlapCount;
    }

    // Add sentence to current chunk
    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  // Save final chunk if it meets minimum
  if (currentTokens >= chunkMinTokens / 2) {  // Allow smaller final chunk
    const chunkText = currentChunk.join(' ');
    chunks.push(createChunk(chunkText, doc, section, chunkIndex));
  }

  return chunks;
}

/**
 * Create a chunk object with metadata
 */
function createChunk(
  content: string,
  doc: ParsedDocument,
  section: ParsedSection,
  chunkIndex: number
): DocumentChunk {
  const id = `${doc.ticker}-${doc.docType}-${doc.filingDate}-${section.type}-${chunkIndex}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');

  const metadata: ChunkMetadata = {
    ticker: doc.ticker,
    company: doc.company,
    docType: doc.docType,
    filingDate: doc.filingDate,
    periodEnd: doc.periodEnd,
    fiscalYear: doc.fiscalYear,
    fiscalQuarter: doc.fiscalQuarter,
    section: section.type,
    sourceUrl: doc.sourceUrl,
    accessionNumber: doc.accessionNumber,
    chunkIndex,
  };

  return {
    id,
    content: content.trim(),
    tokenCount: countTokens(content),
    metadata,
  };
}

/**
 * Split text into sentences (handles abbreviations, decimals, etc.)
 */
function splitIntoSentences(text: string): string[] {
  // Handle common abbreviations that shouldn't split
  const preserved = text
    .replace(/Mr\./g, 'Mr\u0000')
    .replace(/Mrs\./g, 'Mrs\u0000')
    .replace(/Ms\./g, 'Ms\u0000')
    .replace(/Dr\./g, 'Dr\u0000')
    .replace(/Inc\./g, 'Inc\u0000')
    .replace(/Corp\./g, 'Corp\u0000')
    .replace(/Ltd\./g, 'Ltd\u0000')
    .replace(/Co\./g, 'Co\u0000')
    .replace(/vs\./g, 'vs\u0000')
    .replace(/etc\./g, 'etc\u0000')
    .replace(/U\.S\./g, 'U\u0000S\u0000')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2');  // Preserve decimals

  // Split on sentence boundaries
  const sentences = preserved.split(/(?<=[.!?])\s+/);

  // Restore preserved text
  return sentences
    .map(s => s
      .replace(/\u0000/g, '.')
      .replace(/\u0001/g, '.')
      .trim()
    )
    .filter(s => s.length > 0);
}

/**
 * Deduplicate boilerplate across chunks
 * Removes sentences that appear in 3+ chunks
 */
export function deduplicateBoilerplate(chunks: DocumentChunk[]): DocumentChunk[] {
  // Count sentence occurrences
  const sentenceCounts = new Map<string, number>();

  for (const chunk of chunks) {
    const sentences = splitIntoSentences(chunk.content);
    const uniqueInChunk = new Set(sentences.map(s => s.toLowerCase().trim()));

    for (const sentence of uniqueInChunk) {
      if (sentence.length > 50) {  // Only track substantial sentences
        sentenceCounts.set(sentence, (sentenceCounts.get(sentence) || 0) + 1);
      }
    }
  }

  // Find boilerplate sentences (appear in 3+ chunks)
  const boilerplate = new Set<string>();
  for (const [sentence, count] of sentenceCounts) {
    if (count >= 3) {
      boilerplate.add(sentence);
    }
  }

  // Remove boilerplate from chunks
  return chunks.map(chunk => {
    const sentences = splitIntoSentences(chunk.content);
    const filtered = sentences.filter(s => !boilerplate.has(s.toLowerCase().trim()));
    const newContent = filtered.join(' ');

    return {
      ...chunk,
      content: newContent,
      tokenCount: countTokens(newContent),
    };
  }).filter(c => c.tokenCount >= INGESTION_CONFIG.chunkMinTokens / 2);
}
