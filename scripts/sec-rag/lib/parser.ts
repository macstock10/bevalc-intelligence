/**
 * SEC Filing Parser
 *
 * Extracts clean text from SEC HTML filings
 * Identifies sections (MD&A, Risk Factors, etc.)
 */

import { parse as parseHtml, HTMLElement } from 'node-html-parser';
import { INGESTION_CONFIG } from '../config.js';
import type { ParsedDocument, ParsedSection, Section, DocType, EdgarFiling } from './types.js';

// Section patterns for 10-K/10-Q
// Conservative matching: only detect high-confidence sections
// Default to 'Other' rather than guessing
const SECTION_PATTERNS: Array<{ pattern: RegExp; section: Section; confidence: number }> = [
  // MD&A - most important section for analysis
  {
    pattern: /item\s+7[.\s]+management['']?s?\s+discussion\s+and\s+analysis/i,
    section: 'MD&A',
    confidence: 0.9,
  },
  {
    pattern: /item\s+2[.\s]+management['']?s?\s+discussion\s+and\s+analysis/i,  // 10-Q
    section: 'MD&A',
    confidence: 0.9,
  },
  // Risk Factors - important for understanding challenges
  {
    pattern: /item\s+1a[.\s]+risk\s+factors/i,
    section: 'Risk Factors',
    confidence: 0.9,
  },
  // Financial Statements - for numerical context
  {
    pattern: /item\s+8[.\s]+financial\s+statements/i,
    section: 'Financial Statements',
    confidence: 0.9,
  },
  // Business description
  {
    pattern: /item\s+1[.\s]+business\s*$/im,  // Exact match to avoid false positives
    section: 'Business',
    confidence: 0.85,
  },
];

// 20-F section patterns (foreign filers like Diageo)
// More lenient matching needed due to varied formatting
const SECTION_PATTERNS_20F: Array<{ pattern: RegExp; section: Section; confidence: number }> = [
  {
    pattern: /item\s+5[.\s]+operating\s+and\s+financial\s+review/i,
    section: 'MD&A',
    confidence: 0.8,
  },
  {
    pattern: /operating\s+and\s+financial\s+review\s+and\s+prospects/i,
    section: 'MD&A',
    confidence: 0.75,
  },
  {
    pattern: /item\s+3[.\s]*d?[.\s]+risk\s+factors/i,
    section: 'Risk Factors',
    confidence: 0.8,
  },
  {
    pattern: /item\s+4[.\s]+information\s+on\s+the\s+company/i,
    section: 'Business',
    confidence: 0.75,
  },
  {
    pattern: /item\s+18[.\s]+financial\s+statements/i,
    section: 'Financial Statements',
    confidence: 0.8,
  },
];

/**
 * Parse SEC filing HTML into structured document
 */
export function parseFilingHtml(
  html: string,
  filing: EdgarFiling,
  ticker: string,
  companyName: string
): ParsedDocument {
  const root = parseHtml(html, {
    blockTextElements: {
      script: false,
      noscript: false,
      style: false,
    },
  });

  // Remove script, style, and other non-content elements
  root.querySelectorAll('script, style, noscript, meta, link').forEach(el => el.remove());

  // Extract text content
  const text = cleanText(root.textContent || '');

  // Determine doc type
  const docType = filing.form as DocType;
  const patterns = docType === '20-F' ? SECTION_PATTERNS_20F : SECTION_PATTERNS;

  // Find sections
  let sections = extractSections(text, patterns);

  // Apply includeSections for core filings only (keep 8-K/6-K intact)
  if (docType === '10-K' || docType === '10-Q' || docType === '20-F') {
    const allowed = new Set(INGESTION_CONFIG.includeSections || []);
    if (allowed.size > 0) {
      sections = sections.filter(s => allowed.has(s.type));
    }
  }

  // Parse fiscal info from period end date
  const periodEnd = new Date(filing.periodEndDate);
  const fiscalYear = periodEnd.getFullYear();
  const month = periodEnd.getMonth() + 1;

  // Determine fiscal quarter for 10-Q (approximate)
  let fiscalQuarter: number | undefined;
  if (docType === '10-Q') {
    if (month <= 3) fiscalQuarter = 1;
    else if (month <= 6) fiscalQuarter = 2;
    else if (month <= 9) fiscalQuarter = 3;
    else fiscalQuarter = 4;
  }

  return {
    ticker,
    company: companyName,
    docType,
    originalForm: filing.originalForm,
    isAmendment: filing.isAmendment,
    filingDate: filing.filingDate,
    periodEnd: filing.periodEndDate,
    fiscalYear,
    fiscalQuarter,
    accessionNumber: filing.accessionNumber,
    sourceUrl: filing.fileUrl,
    sections,
  };
}

/**
 * Extract sections from document text
 */
function extractSections(
  text: string,
  patterns: Array<{ pattern: RegExp; section: Section; confidence: number }>
): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const matches: Array<{ section: Section; title: string; index: number; confidence: number }> = [];

  // Find all section headers
  for (const { pattern, section } of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      matches.push({
        section,
        title: match[0].trim(),
        index: match.index,
        confidence,
      });
    }
  }

  // Sort by position in document
  matches.sort((a, b) => a.index - b.index);

  // Extract content between sections
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const startIndex = current.index;
    const endIndex = next ? next.index : text.length;

    let content = text.slice(startIndex, endIndex);

    // Remove boilerplate
    content = removeBoilerplate(content);

    // Skip if too short after cleaning
    if (content.length < 500) continue;

    sections.push({
      type: current.section,
      title: current.title,
      confidence: current.confidence,
      content,
      startIndex,
      endIndex,
    });
  }

  // If no sections found, treat entire doc as "Other"
  if (sections.length === 0) {
    const content = removeBoilerplate(text);
    if (content.length >= 500) {
      sections.push({
        type: 'Other',
        title: 'Document Content',
        confidence: 0.2,
        content,
        startIndex: 0,
        endIndex: text.length,
      });
    }
  }

  return sections;
}

/**
 * Clean HTML text
 */
function cleanText(text: string): string {
  return text
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove page numbers and headers
    .replace(/page\s+\d+\s+of\s+\d+/gi, '')
    // Remove table of contents page refs
    .replace(/\.{3,}\d+/g, '')
    // Clean up
    .trim();
}

/**
 * Remove boilerplate language
 */
function removeBoilerplate(text: string): string {
  let result = text;

  for (const pattern of INGESTION_CONFIG.boilerplatePatterns) {
    // Find sentences containing boilerplate
    const sentences = result.split(/(?<=[.!?])\s+/);
    const filtered = sentences.filter(s => !pattern.test(s));
    result = filtered.join(' ');
  }

  // Remove common boilerplate paragraphs
  const boilerplateParagraphs = [
    /this\s+(annual|quarterly)\s+report.*contains\s+forward-looking\s+statements.*?(?=\n\n|\z)/gi,
    /the\s+following\s+discussion\s+should\s+be\s+read\s+in\s+conjunction.*?(?=\n\n|\z)/gi,
  ];

  for (const pattern of boilerplateParagraphs) {
    result = result.replace(pattern, '');
  }

  return result.trim();
}

/**
 * Parse 6-K (foreign current report) - simpler structure
 */
export function parse6K(html: string, filing: EdgarFiling, ticker: string, companyName: string): ParsedDocument {
  const root = parseHtml(html);
  root.querySelectorAll('script, style, noscript').forEach(el => el.remove());

  const text = cleanText(root.textContent || '');
  const content = removeBoilerplate(text);

  const periodEnd = new Date(filing.periodEndDate);

  return {
    ticker,
    company: companyName,
    docType: '6-K',
    originalForm: filing.originalForm,
    isAmendment: filing.isAmendment,
    filingDate: filing.filingDate,
    periodEnd: filing.periodEndDate,
    fiscalYear: periodEnd.getFullYear(),
    accessionNumber: filing.accessionNumber,
    sourceUrl: filing.fileUrl,
    sections: content.length >= 500 ? [{
      type: 'Other',
      title: 'Report Content',
      confidence: 0.4,
      content,
      startIndex: 0,
      endIndex: content.length,
    }] : [],
  };
}

/**
 * Parse 8-K (current report) - extract item content
 * Also handles Item 99.1 exhibits (press releases, etc.)
 */
export function parse8K(html: string, filing: EdgarFiling, ticker: string, companyName: string): ParsedDocument {
  const root = parseHtml(html);
  root.querySelectorAll('script, style, noscript').forEach(el => el.remove());

  const text = cleanText(root.textContent || '');

  // 8-K items pattern - includes standard items AND exhibit 99.1
  const itemPattern = /item\s+(\d+\.\d+)[^\n]*/gi;
  const items: ParsedSection[] = [];

  let match;
  const matches: Array<{ item: string; index: number; isExhibit: boolean }> = [];

  while ((match = itemPattern.exec(text)) !== null) {
    matches.push({ item: match[0], index: match.index, isExhibit: false });
  }

  // Also look for Exhibit 99.1 content (press releases, earnings releases)
  // These often contain the most valuable material information
  const exhibitPatterns = [
    /exhibit\s+99\.1[^\n]*/gi,
    /ex-99\.1[^\n]*/gi,
    /press\s+release[^\n]*/gi,
    /earnings\s+release[^\n]*/gi,
  ];

  for (const pattern of exhibitPatterns) {
    let exhibitMatch;
    while ((exhibitMatch = pattern.exec(text)) !== null) {
      // Avoid duplicates near existing matches
      const nearExisting = matches.some(m => Math.abs(m.index - exhibitMatch!.index) < 100);
      if (!nearExisting) {
        matches.push({
          item: exhibitMatch[0],
          index: exhibitMatch.index,
          isExhibit: true,
        });
      }
    }
  }

  // Sort by position in document
  matches.sort((a, b) => a.index - b.index);

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const content = text.slice(current.index, next?.index || text.length);
    const cleaned = removeBoilerplate(content);

    // Exhibits often have valuable content, use lower threshold
    const minLength = current.isExhibit ? 100 : 200;

    if (cleaned.length >= minLength) {
      items.push({
        type: current.isExhibit ? 'Exhibit' : 'Other',
        title: current.item.trim(),
        confidence: current.isExhibit ? 0.6 : 0.8,
        content: cleaned,
        startIndex: current.index,
        endIndex: next?.index || text.length,
      });
    }
  }

  const periodEnd = new Date(filing.periodEndDate);

  return {
    ticker,
    company: companyName,
    docType: '8-K',
    originalForm: filing.originalForm,
    isAmendment: filing.isAmendment,
    filingDate: filing.filingDate,
    periodEnd: filing.periodEndDate,
    fiscalYear: periodEnd.getFullYear(),
    accessionNumber: filing.accessionNumber,
    sourceUrl: filing.fileUrl,
    sections: items,
  };
}

/**
 * Parse Exhibit 99.1 (press release / earnings release) HTML
 */
export function parseExhibitHtml(
  html: string,
  title: string,
  sourceUrl?: string
): ParsedSection | null {
  const root = parseHtml(html);
  root.querySelectorAll('script, style, noscript').forEach(el => el.remove());

  const text = cleanText(root.textContent || '');
  const content = removeBoilerplate(text);

  if (content.length < 200) return null;

  return {
    type: 'Exhibit',
    title,
    confidence: 0.95,
    content,
    sourceUrl,
    startIndex: 0,
    endIndex: content.length,
  };
}
