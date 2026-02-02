/**
 * OpenAI Vector Store Client
 *
 * Manages file uploads and vector store operations
 * Uses OpenAI File Search for retrieval
 */

import OpenAI from 'openai';
import { OPENAI_CONFIG } from '../config.js';
import type { DocumentChunk, ChunkMetadata } from './types.js';

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

/**
 * Create or get existing vector store
 */
export async function getOrCreateVectorStore(): Promise<string> {
  const client = getClient();

  // List existing vector stores
  const stores = await client.vectorStores.list();
  const existing = stores.data.find(s => s.name === OPENAI_CONFIG.vectorStoreName);

  if (existing) {
    console.log(`Using existing vector store: ${existing.id}`);
    return existing.id;
  }

  // Create new vector store
  const store = await client.vectorStores.create({
    name: OPENAI_CONFIG.vectorStoreName,
  });

  console.log(`Created vector store: ${store.id}`);
  return store.id;
}

/**
 * @deprecated Use uploadChunksIndividually instead - this function lacks content hashing
 * and will not properly handle parser updates or amended filings.
 *
 * Upload chunks as files to vector store (LEGACY - NOT IDEMPOTENT)
 * OpenAI File Search works with files, so we create text files with metadata
 */
export async function uploadChunks(
  vectorStoreId: string,
  chunks: DocumentChunk[]
): Promise<{ uploaded: number; failed: number }> {
  console.warn('WARNING: uploadChunks() is deprecated. Use uploadChunksIndividually() for idempotent uploads with content hashing.');

  const client = getClient();
  let uploaded = 0;
  let failed = 0;

  // Batch chunks into files by document
  // OpenAI recommends ~1MB files, but for granular retrieval we use smaller files
  const batchSize = 20;  // Upload 20 chunks at a time

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    try {
      // Create a single file per batch with chunk delimiters
      const fileContent = batch.map(chunk => formatChunkForUpload(chunk)).join('\n\n---CHUNK_BOUNDARY---\n\n');

      const fileName = `${batch[0].metadata.ticker}-${batch[0].metadata.docType}-${batch[0].metadata.filingDate}-batch-${Math.floor(i / batchSize)}.txt`;

      // Upload file
      const file = await client.files.create({
        file: new File([fileContent], fileName, { type: 'text/plain' }),
        purpose: 'assistants',
      });

      // Add to vector store
      await client.vectorStores.files.create(vectorStoreId, {
        file_id: file.id,
      });

      uploaded += batch.length;
      console.log(`Uploaded batch ${Math.floor(i / batchSize) + 1}: ${batch.length} chunks`);
    } catch (error) {
      console.error(`Failed to upload batch ${Math.floor(i / batchSize) + 1}:`, error);
      failed += batch.length;
    }
  }

  return { uploaded, failed };
}

/**
 * Generate content hash for idempotent uploads
 * Identity is (ticker, accession, doc_type, content_hash)
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content.toLowerCase().replace(/\s+/g, ' ').trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * List ALL files in vector store with pagination
 */
async function listAllVectorStoreFiles(client: OpenAI, vectorStoreId: string): Promise<Map<string, string>> {
  const existingFiles = new Map<string, string>(); // filename -> file_id
  let cursor: string | undefined;

  do {
    const response = await client.vectorStores.files.list(vectorStoreId, {
      limit: 100,
      after: cursor,
    });

    for (const file of response.data) {
      try {
        const fileDetails = await client.files.retrieve(file.id);
        existingFiles.set(fileDetails.filename, file.id);
      } catch (e) {
        // File may have been deleted
      }
    }

    cursor = response.has_more ? response.data[response.data.length - 1]?.id : undefined;
  } while (cursor);

  return existingFiles;
}

/**
 * Upload chunks individually for better retrieval granularity
 * Idempotent: uses content hash in filename to detect content changes
 * Identity: {ticker}-{accession}-{section}-{content_hash}.txt
 */
export async function uploadChunksIndividually(
  vectorStoreId: string,
  chunks: DocumentChunk[]
): Promise<{ uploaded: number; skipped: number; updated: number; failed: number; fileIds: string[] }> {
  const client = getClient();
  let uploaded = 0;
  let skipped = 0;
  let updated = 0;
  let failed = 0;
  const fileIds: string[] = [];

  // Get ALL existing files with pagination
  console.log('Listing existing files in vector store...');
  const existingFiles = await listAllVectorStoreFiles(client, vectorStoreId);
  console.log(`Found ${existingFiles.size} existing files in vector store`);

  for (const chunk of chunks) {
    try {
      // Generate content hash for idempotent identity
      const contentHash = await hashContent(chunk.content);
      const fileName = `${chunk.metadata.ticker}-${chunk.metadata.accessionNumber}-${chunk.metadata.section}-${contentHash}.txt`;

      // Check for existing file with same base identity but different hash
      const basePattern = `${chunk.metadata.ticker}-${chunk.metadata.accessionNumber}-${chunk.metadata.section}-`;
      const existingEntry = [...existingFiles.entries()].find(([name]) => name.startsWith(basePattern));

      if (existingEntry) {
        const [existingName, existingFileId] = existingEntry;
        if (existingName === fileName) {
          // Exact match - skip
          skipped++;
          continue;
        } else {
          // Same identity, different content - delete old, upload new
          console.log(`Content changed for ${chunk.id}, replacing...`);
          try {
            await client.vectorStores.files.del(vectorStoreId, existingFileId);
            await client.files.del(existingFileId);
          } catch (e) {
            // Ignore delete errors
          }
          updated++;
        }
      }

      const fileContent = formatChunkForUpload(chunk);

      // Upload file
      const file = await client.files.create({
        file: new File([fileContent], fileName, { type: 'text/plain' }),
        purpose: 'assistants',
      });

      // Add to vector store
      await client.vectorStores.files.create(vectorStoreId, {
        file_id: file.id,
      });

      fileIds.push(file.id);
      if (!existingEntry) uploaded++;

      if ((uploaded + skipped + updated) % 10 === 0) {
        console.log(`Progress: ${uploaded} new, ${updated} updated, ${skipped} skipped, ${failed} failed / ${chunks.length} total`);
      }
    } catch (error: any) {
      console.error(`Failed to upload chunk ${chunk.id}:`, error?.message || error);
      failed++;
    }
  }

  return { uploaded, skipped, updated, failed, fileIds };
}

/**
 * Format chunk with metadata header for upload
 * The metadata is embedded in the file content so it's searchable
 * All fields required for durable provenance and clickable citations
 */
function formatChunkForUpload(chunk: DocumentChunk): string {
  const m = chunk.metadata;

  // All provenance fields must be present for valid citations
  return `[METADATA]
chunk_id: ${chunk.id}
ticker: ${m.ticker}
company: ${m.company}
doc_type: ${m.docType}
filing_date: ${m.filingDate}
period_end: ${m.periodEnd}
fiscal_year: ${m.fiscalYear}
fiscal_quarter: ${m.fiscalQuarter ? `Q${m.fiscalQuarter}` : 'N/A'}
section: ${m.section}
accession_number: ${m.accessionNumber}
source_url: ${m.sourceUrl}
chunk_index: ${m.chunkIndex}
token_count: ${chunk.tokenCount}
[/METADATA]

${chunk.content}`;
}

/**
 * Search vector store using Assistants API
 * Returns top chunks with relevance scores
 */
export async function searchVectorStore(
  vectorStoreId: string,
  query: string,
  topK: number = 50,
  filters?: {
    tickers?: string[];
    docTypes?: string[];
    startDate?: string;
    endDate?: string;
  }
): Promise<SearchResult[]> {
  const client = getClient();

  // Build filter query to prepend to search
  let filterQuery = '';
  if (filters?.tickers?.length) {
    filterQuery += `ticker:(${filters.tickers.join(' OR ')}) `;
  }
  if (filters?.docTypes?.length) {
    filterQuery += `doc_type:(${filters.docTypes.join(' OR ')}) `;
  }
  if (filters?.startDate) {
    filterQuery += `filing_date:>=${filters.startDate} `;
  }
  if (filters?.endDate) {
    filterQuery += `filing_date:<=${filters.endDate} `;
  }

  const searchQuery = filterQuery ? `${filterQuery} ${query}` : query;

  // Create a temporary assistant with file search
  const assistant = await client.beta.assistants.create({
    model: 'gpt-4o-mini',
    tools: [{ type: 'file_search' }],
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStoreId],
      },
    },
    instructions: `You are a document retrieval assistant. When given a query, search the vector store and return the most relevant passages.

For each relevant passage found, output it in this exact format:
---RESULT---
CHUNK_ID: [chunk_id from metadata]
SCORE: [relevance score 0-1]
CONTENT: [the relevant text]
---END_RESULT---

Return up to ${topK} results, ordered by relevance. Only return the passages, no commentary.`,
  });

  try {
    // Create a thread and run
    const thread = await client.beta.threads.create();

    await client.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `Search for: ${searchQuery}\n\nReturn the top ${topK} most relevant passages.`,
    });

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistant.id,
    });

    if (run.status !== 'completed') {
      throw new Error(`Run failed with status: ${run.status}`);
    }

    // Get messages
    const messages = await client.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.find(m => m.role === 'assistant');

    if (!assistantMessage) {
      return [];
    }

    // Parse results from response
    const textContent = assistantMessage.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return [];
    }

    return parseSearchResults(textContent.text.value);
  } finally {
    // Clean up assistant
    await client.beta.assistants.del(assistant.id);
  }
}

/**
 * Parse search results from assistant response
 */
function parseSearchResults(response: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultPattern = /---RESULT---\s*CHUNK_ID:\s*([^\n]+)\s*SCORE:\s*([^\n]+)\s*CONTENT:\s*([\s\S]*?)---END_RESULT---/g;

  let match;
  while ((match = resultPattern.exec(response)) !== null) {
    const [, chunkId, scoreStr, content] = match;
    const score = parseFloat(scoreStr) || 0.5;

    // Parse metadata from content
    const metadata = parseMetadataFromContent(content);

    results.push({
      chunkId: chunkId.trim(),
      content: content.replace(/\[METADATA\][\s\S]*?\[\/METADATA\]/, '').trim(),
      score,
      metadata,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Parse metadata block from chunk content
 */
function parseMetadataFromContent(content: string): Partial<ChunkMetadata> {
  const metadataMatch = content.match(/\[METADATA\]([\s\S]*?)\[\/METADATA\]/);
  if (!metadataMatch) return {};

  const metadata: Record<string, string> = {};
  const lines = metadataMatch[1].split('\n');

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      metadata[key.trim()] = valueParts.join(':').trim();
    }
  }

  return {
    ticker: metadata.ticker,
    company: metadata.company,
    docType: metadata.doc_type as any,
    filingDate: metadata.filing_date,
    periodEnd: metadata.period_end,
    fiscalYear: parseInt(metadata.fiscal_year) || undefined,
    fiscalQuarter: metadata.fiscal_quarter ? parseInt(metadata.fiscal_quarter.replace('Q', '')) : undefined,
    section: metadata.section as any,
    sourceUrl: metadata.source_url,
  };
}

/**
 * Delete all files from vector store
 * Uses pagination to ensure ALL files are deleted, not just first page
 */
export async function clearVectorStore(vectorStoreId: string): Promise<number> {
  const client = getClient();
  let deleted = 0;
  let cursor: string | undefined;

  console.log('Clearing all files from vector store (with pagination)...');

  do {
    const files = await client.vectorStores.files.list(vectorStoreId, {
      limit: 100,
      after: cursor,
    });

    for (const file of files.data) {
      try {
        await client.vectorStores.files.del(vectorStoreId, file.id);
        await client.files.del(file.id);
        deleted++;
        if (deleted % 50 === 0) {
          console.log(`Deleted ${deleted} files...`);
        }
      } catch (error) {
        console.error(`Failed to delete file ${file.id}:`, error);
      }
    }

    cursor = files.has_more ? files.data[files.data.length - 1]?.id : undefined;
  } while (cursor);

  console.log(`Deleted ${deleted} total files from vector store`);
  return deleted;
}

export interface SearchResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: Partial<ChunkMetadata>;
}
