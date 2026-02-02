/**
 * Cohere Rerank Client
 *
 * Reranks retrieved chunks for better relevance
 */

import { CohereClient } from 'cohere-ai';
import { COHERE_CONFIG } from '../config.js';
import type { SearchResult } from './vectorstore.js';

let cohere: CohereClient | null = null;

function getClient(): CohereClient {
  if (!cohere) {
    cohere = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }
  return cohere;
}

/**
 * Rerank search results using Cohere
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  topK: number = 15
): Promise<RerankResult[]> {
  if (results.length === 0) {
    return [];
  }

  const client = getClient();

  // Prepare documents for reranking
  const documents = results.map(r => r.content);

  try {
    const response = await client.rerank({
      model: COHERE_CONFIG.rerankModel,
      query,
      documents,
      topN: Math.min(topK, results.length),
      returnDocuments: false,  // We already have the content
    });

    // Map rerank scores back to results
    const reranked: RerankResult[] = response.results.map(r => ({
      ...results[r.index],
      rerankScore: r.relevanceScore,
    }));

    return reranked.sort((a, b) => b.rerankScore - a.rerankScore);
  } catch (error) {
    console.error('Rerank failed, falling back to original scores:', error);

    // Fall back to original results
    return results.slice(0, topK).map(r => ({
      ...r,
      rerankScore: r.score,
    }));
  }
}

export interface RerankResult extends SearchResult {
  rerankScore: number;
}
