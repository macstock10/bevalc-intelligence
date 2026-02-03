/**
 * SEC XBRL (company facts) ingestion
 *
 * Fetches structured financial facts from EDGAR and filters to relevant filings.
 */

import crypto from 'crypto';
import { INGESTION_CONFIG } from '../config.js';
import { upsertXbrlFacts } from './d1.js';

const EDGAR_DATA = 'https://data.sec.gov';

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

async function xbrlFetch(url: string, maxRetries: number = 3): Promise<Response> {
  await rateLimit();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': INGESTION_CONFIG.edgarUserAgent,
          'Accept-Encoding': 'gzip, deflate',
          Accept: 'application/json',
        },
      });

      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      if (!response.ok) {
        throw new Error(`XBRL fetch failed: ${response.status} ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const waitMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError || new Error(`XBRL fetch failed after ${maxRetries} retries: ${url}`);
}

type CompanyFactsResponse = {
  cik: string;
  entityName: string;
  facts: Record<string, Record<string, XbrlConcept>>;
};

type XbrlConcept = {
  label?: string;
  description?: string;
  units: Record<string, XbrlFact[]>;
};

type XbrlFact = {
  accn?: string;
  filed?: string;
  form?: string;
  fy?: number;
  fp?: string;
  frame?: string;
  val?: number | string;
  start?: string;
  end?: string;
  segment?: Record<string, string>;
};

type FilingRef = {
  accessionNumber: string;
  form?: string;
};

function normalizeAccession(accn?: string): string | null {
  if (!accn) return null;
  return accn.trim();
}

function hashFactIdentity(parts: Array<string | number | null | undefined>): string {
  const raw = parts.map(p => String(p ?? '')).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function ingestXbrlFactsForFilings(
  cik: string,
  ticker: string,
  filings: FilingRef[]
): Promise<{ totalFacts: number; storedFacts: number }> {
  if (!filings || filings.length === 0) {
    return { totalFacts: 0, storedFacts: 0 };
  }

  const accnSet = new Set(
    filings.map(f => normalizeAccession(f.accessionNumber)).filter(Boolean) as string[]
  );

  if (accnSet.size === 0) {
    return { totalFacts: 0, storedFacts: 0 };
  }

  const url = `${EDGAR_DATA}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await xbrlFetch(url);
  const data = await response.json() as CompanyFactsResponse;

  const rows: Array<Record<string, unknown>> = [];
  let totalFacts = 0;

  for (const [taxonomy, concepts] of Object.entries(data.facts || {})) {
    for (const [concept, conceptData] of Object.entries(concepts || {})) {
      const label = conceptData.label || concept;
      for (const [unit, facts] of Object.entries(conceptData.units || {})) {
        for (const fact of facts || []) {
          totalFacts += 1;
          const accn = normalizeAccession(fact.accn);
          if (!accn || !accnSet.has(accn)) continue;

          const segmentJson = fact.segment ? JSON.stringify(fact.segment) : null;
          const valueNum = coerceNumber(fact.val);
          const valueText = fact.val === null || fact.val === undefined ? null : String(fact.val);

          const id = hashFactIdentity([
            cik,
            accn,
            taxonomy,
            concept,
            unit,
            fact.end,
            fact.start,
            fact.frame,
            segmentJson,
            valueText,
          ]);

          rows.push({
            id,
            cik,
            ticker,
            accession_number: accn,
            form: fact.form || null,
            filing_date: fact.filed || null,
            period_start: fact.start || null,
            period_end: fact.end || null,
            fiscal_year: fact.fy || null,
            fiscal_period: fact.fp || null,
            taxonomy,
            concept,
            label,
            unit,
            value_text: valueText,
            value_num: valueNum,
            frame: fact.frame || null,
            segment_json: segmentJson,
          });
        }
      }
    }
  }

  if (rows.length > 0) {
    await upsertXbrlFacts(rows);
  }

  return { totalFacts, storedFacts: rows.length };
}
