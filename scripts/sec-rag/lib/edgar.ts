/**
 * SEC EDGAR API Client
 *
 * Fetches filing lists and documents from SEC EDGAR
 * Respects rate limits (10 req/sec)
 */

import { INGESTION_CONFIG } from '../config.js';
import type { EdgarFiling, DocType } from './types.js';

const EDGAR_BASE = 'https://www.sec.gov';
const EDGAR_DATA = 'https://data.sec.gov';

// Rate limiter
let lastRequestTime = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < INGESTION_CONFIG.edgarRateLimitMs) {
    await new Promise(resolve =>
      setTimeout(resolve, INGESTION_CONFIG.edgarRateLimitMs - elapsed)
    );
  }
  lastRequestTime = Date.now();
}

// Fetch with rate limiting, proper headers, and exponential backoff
async function edgarFetch(url: string, maxRetries: number = 3): Promise<Response> {
  await rateLimit();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': INGESTION_CONFIG.edgarUserAgent,
          'Accept-Encoding': 'gzip, deflate',
          Accept: 'application/json, text/html',
        },
      });

      // Handle rate limiting (429) and server errors (503)
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s

        console.warn(`EDGAR rate limited (${response.status}), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      if (!response.ok) {
        throw new Error(`EDGAR fetch failed: ${response.status} ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;

      // Network errors: wait and retry
      if (attempt < maxRetries - 1) {
        const waitMs = Math.pow(2, attempt) * 1000;
        console.warn(`EDGAR fetch error, retrying in ${waitMs}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError || new Error(`EDGAR fetch failed after ${maxRetries} retries: ${url}`);
}

/**
 * Get all filings for a company from EDGAR
 */
export async function getCompanyFilings(
  cik: string,
  docTypes: DocType[]
): Promise<EdgarFiling[]> {
  // SEC submissions endpoint returns all filings
  const url = `${EDGAR_DATA}/submissions/CIK${cik}.json`;
  const response = await edgarFetch(url);
  const data = await response.json() as EdgarSubmissions;

  const filings: EdgarFiling[] = [];

  // Map SEC form names to our doc types
  const formMap: Record<string, DocType> = {
    '10-K': '10-K',
    '10-K/A': '10-K',  // Amended
    '10-Q': '10-Q',
    '10-Q/A': '10-Q',
    '8-K': '8-K',
    '8-K/A': '8-K',
    '20-F': '20-F',
    '20-F/A': '20-F',
    '6-K': '6-K',
    '6-K/A': '6-K',
  };

  // Process recent filings
  const recent = data.filings.recent;
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    const docType = formMap[form];

    if (!docType || !docTypes.includes(docType)) {
      continue;
    }

    const accessionNumber = recent.accessionNumber[i];
    const accessionFormatted = accessionNumber.replace(/-/g, '');
    const primaryDoc = recent.primaryDocument[i];

    filings.push({
      accessionNumber,
      filingDate: recent.filingDate[i],
      periodEndDate: recent.reportDate[i] || recent.filingDate[i],
      form: docType,
      fileUrl: `${EDGAR_BASE}/Archives/edgar/data/${cik}/${accessionFormatted}/${primaryDoc}`,
      cik,
    });
  }

  return filings;
}

/**
 * Filter filings by date based on backfill config
 */
export function filterFilingsByDate(
  filings: EdgarFiling[],
  docType: DocType,
  backfillYears: Record<string, number>
): EdgarFiling[] {
  const years = backfillYears[docType] || 2;
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  return filings.filter(f => f.filingDate >= cutoff);
}

/**
 * Download filing HTML content
 */
export async function downloadFiling(filing: EdgarFiling): Promise<string> {
  const response = await edgarFetch(filing.fileUrl);
  return response.text();
}

/**
 * Get filing index to find all documents in a filing
 */
export async function getFilingIndex(
  cik: string,
  accessionNumber: string
): Promise<FilingIndex> {
  const accessionFormatted = accessionNumber.replace(/-/g, '');
  const url = `${EDGAR_BASE}/Archives/edgar/data/${cik}/${accessionFormatted}/index.json`;
  const response = await edgarFetch(url);
  return response.json() as Promise<FilingIndex>;
}

// EDGAR API response types
interface EdgarSubmissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

interface FilingIndex {
  directory: {
    item: Array<{
      name: string;
      type: string;
      size: number;
    }>;
  };
}
