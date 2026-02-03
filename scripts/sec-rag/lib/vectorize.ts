/**
 * Cloudflare Vectorize Client
 *
 * Uploads embeddings to Cloudflare Vectorize for fast retrieval
 */

import OpenAI from 'openai';
import type { DocumentChunk } from './types.js';

const VECTORIZE_INDEX = 'sec-filings-index';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 100; // Vectorize accepts up to 1000 vectors per batch

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Generate embeddings for text using OpenAI
 */
async function embedText(text: string): Promise<number[]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data.map(d => d.embedding);
}

/**
 * Upload vectors to Cloudflare Vectorize
 */
async function upsertToVectorize(
  vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, string>;
  }>
): Promise<{ success: boolean; count: number }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  }

  // Vectorize expects NDJSON format for upsert
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vectorize upsert error: ${error}`);
  }

  const data = await response.json() as { success: boolean; result?: { mutationId: string }; errors?: unknown[] };
  console.log('Vectorize upsert response:', JSON.stringify(data));
  if (!data.success) {
    throw new Error(`Vectorize upsert failed: ${JSON.stringify(data.errors)}`);
  }
  return { success: data.success, count: vectors.length };
}

/**
 * Upload chunks to Cloudflare Vectorize with embeddings
 * Stores chunk content in metadata for retrieval
 */
export async function uploadChunksToVectorize(
  chunks: DocumentChunk[]
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    try {
      // Generate embeddings for batch
      const texts = batch.map(c => c.content);
      const embeddings = await embedBatch(texts);

      // Prepare vectors with metadata
      const vectors = batch.map((chunk, idx) => ({
        id: chunk.id,
        values: embeddings[idx],
        metadata: {
          ticker: chunk.metadata.ticker,
          company: chunk.metadata.company,
          docType: chunk.metadata.docType,
          originalForm: chunk.metadata.originalForm || '',
          isAmendment: String(chunk.metadata.isAmendment ?? ''),
          filingDate: chunk.metadata.filingDate,
          periodEnd: chunk.metadata.periodEnd,
          section: chunk.metadata.section,
          sectionTitle: chunk.metadata.sectionTitle || '',
          sectionConfidence: String(chunk.metadata.sectionConfidence ?? ''),
          sourceUrl: chunk.metadata.sourceUrl,
          // Truncate content to fit Vectorize metadata limits (10KB per field)
          content: chunk.content.slice(0, 9000),
          accessionNumber: chunk.metadata.accessionNumber,
          fiscalYear: String(chunk.metadata.fiscalYear || ''),
          fiscalQuarter: String(chunk.metadata.fiscalQuarter || ''),
          chunkStartChar: String(chunk.metadata.chunkStartChar ?? ''),
          chunkEndChar: String(chunk.metadata.chunkEndChar ?? ''),
        },
      }));

      // Upload to Vectorize
      await upsertToVectorize(vectors);
      uploaded += batch.length;

      console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} vectors (${uploaded}/${chunks.length})`);
    } catch (error: any) {
      console.error(`Failed batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error?.message || error);
      failed += batch.length;
    }

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return { uploaded, failed };
}

/**
 * Delete vectors from Vectorize by IDs
 */
export async function deleteFromVectorize(ids: string[]): Promise<number> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${VECTORIZE_INDEX}/delete-by-ids`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vectorize delete error: ${error}`);
  }

  return ids.length;
}
