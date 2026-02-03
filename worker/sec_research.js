/**
 * SEC Research Handlers and RAG Pipeline
 *
 * Split out from worker.js to keep the core worker router lean.
 */

// ==========================================
// SEC RESEARCH HANDLERS
// ==========================================

export async function handleSecCompanies(env) {
    const result = await env.DB.prepare(`
        SELECT id, ticker, cik, company_name, company_id, created_at
        FROM sec_companies
        ORDER BY ticker
    `).all();

    return {
        success: true,
        companies: result.results || []
    };
}

export async function handleSecFilings(url, env) {
    const ticker = url.searchParams.get('ticker');
    const filingType = url.searchParams.get('type');
    const year = url.searchParams.get('year');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let whereClause = '1=1';
    const params = [];

    if (ticker) {
        whereClause += ' AND sc.ticker = ?';
        params.push(ticker);
    }

    if (filingType) {
        whereClause += ' AND sf.filing_type = ?';
        params.push(filingType);
    }

    if (year) {
        whereClause += ' AND sf.fiscal_year = ?';
        params.push(parseInt(year));
    }

    const query = `
        SELECT
            sf.id, sf.accession_number, sf.filing_type, sf.filing_date,
            sf.period_end_date, sf.fiscal_year, sf.fiscal_quarter,
            sf.edgar_url, sf.processing_status,
            sc.ticker, sc.company_name
        FROM sec_filings sf
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE ${whereClause}
        ORDER BY sf.filing_date DESC
        LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();

    // Get total count
    const countQuery = `
        SELECT COUNT(*) as total
        FROM sec_filings sf
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE ${whereClause}
    `;
    const countResult = await env.DB.prepare(countQuery).bind(...params.slice(0, -2)).first();

    return {
        success: true,
        filings: result.results || [],
        total: countResult?.total || 0,
        limit,
        offset
    };
}

export async function handleSecFiling(path, env) {
    const filingId = path.split('/').pop();

    if (!filingId || isNaN(parseInt(filingId))) {
        return { success: false, error: 'Invalid filing ID' };
    }

    // Get filing details
    const filing = await env.DB.prepare(`
        SELECT
            sf.*,
            sc.ticker, sc.company_name, sc.cik
        FROM sec_filings sf
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE sf.id = ?
    `).bind(parseInt(filingId)).first();

    if (!filing) {
        return { success: false, error: 'Filing not found' };
    }

    // Get sections
    const sections = await env.DB.prepare(`
        SELECT id, section_type, section_title, content_hash,
               LENGTH(content) as content_length
        FROM sec_filing_sections
        WHERE filing_id = ?
    `).bind(parseInt(filingId)).all();

    return {
        success: true,
        filing,
        sections: sections.results || []
    };
}

export async function handleSec8kEvents(url, env) {
    const ticker = url.searchParams.get('ticker');
    const priority = url.searchParams.get('priority');
    const days = parseInt(url.searchParams.get('days') || '30');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    let whereClause = `sf.filing_date >= date('now', '-${days} days')`;
    const params = [];

    if (ticker) {
        whereClause += ' AND sc.ticker = ?';
        params.push(ticker);
    }

    if (priority) {
        whereClause += ' AND e.priority = ?';
        params.push(priority);
    }

    const query = `
        SELECT
            e.id, e.item_number, e.item_title, e.headline, e.summary,
            e.priority, e.created_at,
            sf.filing_date, sf.accession_number, sf.edgar_url,
            sc.ticker, sc.company_name
        FROM sec_8k_events e
        JOIN sec_filings sf ON e.filing_id = sf.id
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE ${whereClause}
        ORDER BY
            CASE e.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
            sf.filing_date DESC
        LIMIT ?
    `;

    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all();

    return {
        success: true,
        events: result.results || []
    };
}

export async function handleSec8kEvent(path, url, env) {
    const eventId = path.split('/').pop();
    const email = url.searchParams.get('email');

    if (!eventId || isNaN(parseInt(eventId))) {
        return { success: false, error: 'Invalid event ID' };
    }

    // Check Pro status for full content
    let isPro = false;
    if (email) {
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE email = ?'
        ).bind(email).first();
        isPro = user?.is_pro === 1;
    }

    const event = await env.DB.prepare(`
        SELECT
            e.*,
            sf.filing_date, sf.accession_number, sf.edgar_url,
            sc.ticker, sc.company_name
        FROM sec_8k_events e
        JOIN sec_filings sf ON e.filing_id = sf.id
        JOIN sec_companies sc ON sf.sec_company_id = sc.id
        WHERE e.id = ?
    `).bind(parseInt(eventId)).first();

    if (!event) {
        return { success: false, error: 'Event not found' };
    }

    // Hide raw_content for non-Pro users
    if (!isPro) {
        event.raw_content = null;
        event.pro_required = true;
    }

    return {
        success: true,
        event
    };
}

/**
 * Production SEC RAG Query Handler
 *
 * Pipeline:
 * 1. Parse query intent (detect tickers, date range, doc types)
 * 2. Search OpenAI File Search vector store (top 50)
 * 3. Rerank with Cohere (top 15)
 * 4. Generate grounded answer with Claude (strict citations)
 * 5. Return structured JSON with citations and debug info
 */

// Company detection patterns for query intent parsing
const SEC_COMPANY_PATTERNS = [
    { patterns: ['brown-forman', 'brown forman', 'jack daniels', 'jack daniel', 'woodford reserve', 'old forester', 'bf.b'], ticker: 'BF.B', name: 'Brown-Forman Corporation' },
    { patterns: ['constellation', 'corona', 'modelo', 'robert mondavi', 'stz'], ticker: 'STZ', name: 'Constellation Brands, Inc.' },
    { patterns: ['molson coors', 'molson', 'coors', 'miller lite', 'blue moon', 'tap'], ticker: 'TAP', name: 'Molson Coors Beverage Company' },
    { patterns: ['boston beer', 'sam adams', 'samuel adams', 'truly', 'twisted tea', 'sam'], ticker: 'SAM', name: 'Boston Beer Company, Inc.' },
    { patterns: ['mgp ingredients', 'mgp ', 'luxco', 'mgpi'], ticker: 'MGPI', name: 'MGP Ingredients, Inc.' },
    { patterns: ['diageo', 'johnnie walker', 'guinness', 'smirnoff', 'tanqueray', 'deo'], ticker: 'DEO', name: 'Diageo plc' }
];

const SEC_ALL_TICKERS = ['BF.B', 'STZ', 'TAP', 'SAM', 'MGPI', 'DEO'];
const RAG_RETRIEVE_TOP_K = 50;
const RAG_RERANK_TOP_K = 15;

// Parse query to extract intent (tickers, date range, doc types)
function parseSecQueryIntent(query, filters = {}) {
    const queryLower = query.toLowerCase();

    // Detect tickers from query
    const detectedTickers = [];
    for (const company of SEC_COMPANY_PATTERNS) {
        if (company.patterns.some(p => queryLower.includes(p))) {
            detectedTickers.push(company.ticker);
        }
    }

    // Use explicit filters, detected tickers, or default to all
    const tickers = filters.tickers?.length > 0
        ? filters.tickers
        : detectedTickers.length > 0
            ? detectedTickers
            : SEC_ALL_TICKERS;

    // Detect doc types from query
    let docTypes = filters.docTypes || [];
    if (docTypes.length === 0) {
        if (queryLower.includes('earnings') || queryLower.includes('call') || queryLower.includes('said')) {
            docTypes.push('CALL');
        }
        if (queryLower.includes('annual') || queryLower.includes('10-k') || queryLower.includes('yearly')) {
            docTypes.push('10-K', '20-F');
        }
        if (queryLower.includes('quarterly') || queryLower.includes('10-q')) {
            docTypes.push('10-Q');
        }
        // Default to main filings + calls
        if (docTypes.length === 0) {
            docTypes = ['10-K', '10-Q', '20-F', 'CALL'];
        }
    }

    // Date window - default to last 8 quarters (2 years)
    const endDate = filters.endDate || new Date().toISOString().slice(0, 10);
    const startDateDefault = new Date();
    startDateDefault.setMonth(startDateDefault.getMonth() - 24);
    const startDate = filters.startDate || startDateDefault.toISOString().slice(0, 10);

    const wantsComparison = /change|trend|compare|versus|vs\.?|year|quarter|prior|previous|over time|increase|decrease/i.test(queryLower);
    const wantsCallPriority = /earnings|call|transcript|said|management|guidance|q&a|question|prepared remarks/i.test(queryLower);

    return {
        originalQuery: query,
        tickers,
        docTypes,
        dateWindow: { start: startDate, end: endDate },
        wantsComparison,
        wantsCallPriority
    };
}

// Fast search using Cloudflare Vectorize (direct vector query, no LLM in retrieval path)
// Flow: embed query -> query Vectorize -> return chunks with metadata
async function searchVectorize(query, intent, env) {
    const startTime = Date.now();

    // Step 1: Embed the query using OpenAI
    const embedResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: query,
            dimensions: 768
        })
    });

    if (!embedResponse.ok) {
        throw new Error(`OpenAI embedding error: ${await embedResponse.text()}`);
    }

    const embedData = await embedResponse.json();
    const queryVector = embedData.data[0].embedding;
    const embedLatency = Date.now() - startTime;

    // Step 2: Query Vectorize with filters
    const vectorizeStart = Date.now();

    // Build metadata filter for tickers (simple equality for single ticker)
    const filter = {};
    if (intent.tickers && intent.tickers.length === 1) {
        filter.ticker = intent.tickers[0];  // Simple equality
    }
    // Skip docType filter for now - may need more testing

    const queryOptions = {
        topK: 20,
        returnMetadata: 'all'
    };

    // TEMP: Disable all filters
    // if (Object.keys(filter).length > 0) {
    //     queryOptions.filter = filter;
    // }
    console.log('Filter would be:', JSON.stringify(filter));

    queryOptions.topK = RAG_RETRIEVE_TOP_K;

    const results = await env.SEC_VECTORS.query(queryVector, queryOptions);

    // Debug: log first result's metadata keys and content length
    if (results.matches.length > 0) {
        const first = results.matches[0];
        console.log('Vectorize metadata keys:', Object.keys(first.metadata || {}));
        console.log('Content length:', (first.metadata?.content || '').length);
    }

    const vectorizeLatency = Date.now() - vectorizeStart;

    // Step 3: Extract chunks from results
    const chunks = results.matches.map(match => ({
        id: match.id,
        ticker: match.metadata?.ticker || 'UNKNOWN',
        docType: match.metadata?.docType || 'UNKNOWN',
        filingDate: match.metadata?.filingDate || '',
        section: match.metadata?.section || 'Unknown',
        sourceUrl: match.metadata?.sourceUrl || '',
        content: match.metadata?.content || '',
        score: match.score,
        hasFullContent: false
    }));

    return {
        chunks,
        latencyMs: Date.now() - startTime,
        embedLatencyMs: embedLatency,
        vectorizeLatencyMs: vectorizeLatency
    };
}

// Search OpenAI File Search vector store using Responses API (SLOW - deprecated)
// This uses the file_search tool properly to retrieve chunks with annotations
async function searchOpenAIVectorStore(query, intent, vectorStoreId, env) {
    const startTime = Date.now();

    // Build search query with metadata hints for filtering
    // OpenAI File Search filters via metadata in the uploaded files
    const tickerHint = intent.tickers.length < SEC_ALL_TICKERS.length
        ? `Focus on these companies: ${intent.tickers.join(', ')}.`
        : '';
    const docTypeHint = intent.docTypes.length > 0
        ? `Prioritize these document types: ${intent.docTypes.join(', ')}.`
        : '';

    const searchPrompt = `${query}

${tickerHint}
${docTypeHint}

Search the SEC filings and return all relevant passages. For each passage, include the full text content.`.trim();

    // Use OpenAI Responses API with file_search tool
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            input: searchPrompt,
            tools: [{
                type: 'file_search',
                vector_store_ids: [vectorStoreId],
                max_num_results: 20  // Get top 20 for reranking (reduced for speed)
            }],
            include: ['file_search_call.results']  // Include raw search results
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI Responses API error: ${error}`);
    }

    const data = await response.json();

    // Extract file search results from the response
    const chunks = [];

    // Find file_search_call in the output
    if (data.output) {
        for (const item of data.output) {
            if (item.type === 'file_search_call' && item.results) {
                for (const result of item.results) {
                    // Parse metadata from the file content
                    // Our uploaded files have [METADATA]...[/METADATA] blocks
                    const metadata = parseMetadataFromFileContent(result.text || '');
                    const content = extractContentFromFileContent(result.text || '');

                    if (content && content.length > 50) {
                        chunks.push({
                            id: metadata.chunk_id || result.file_id || `chunk-${chunks.length}`,
                            ticker: metadata.ticker || 'UNKNOWN',
                            docType: metadata.doc_type || 'UNKNOWN',
                            filingDate: metadata.filing_date || '',
                            section: metadata.section || 'Unknown',
                            sourceUrl: metadata.source_url || '',
                            score: result.score || 0.5,
                            content: content
                        });
                    }
                }
            }
        }
    }

    // If no results from file_search_call, try parsing from text annotations
    if (chunks.length === 0 && data.output) {
        for (const item of data.output) {
            if (item.type === 'message' && item.content) {
                for (const content of item.content) {
                    if (content.type === 'text' && content.annotations) {
                        for (const annotation of content.annotations) {
                            if (annotation.type === 'file_citation') {
                                const fileContent = annotation.file_citation?.quote || '';
                                const metadata = parseMetadataFromFileContent(fileContent);
                                const textContent = extractContentFromFileContent(fileContent);

                                if (textContent && textContent.length > 50) {
                                    chunks.push({
                                        id: metadata.chunk_id || annotation.file_citation?.file_id || `chunk-${chunks.length}`,
                                        ticker: metadata.ticker || 'UNKNOWN',
                                        docType: metadata.doc_type || 'UNKNOWN',
                                        filingDate: metadata.filing_date || '',
                                        section: metadata.section || 'Unknown',
                                        sourceUrl: metadata.source_url || '',
                                        score: 0.5,
                                        content: textContent
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return {
        chunks: chunks.sort((a, b) => b.score - a.score),
        latencyMs: Date.now() - startTime
    };
}

// Parse [METADATA]...[/METADATA] block from uploaded file content
function parseMetadataFromFileContent(text) {
    const metadataMatch = text.match(/\[METADATA\]([\s\S]*?)\[\/METADATA\]/);
    if (!metadataMatch) return {};

    const metadata = {};
    const lines = metadataMatch[1].split('\n');

    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();
            if (key && value) {
                metadata[key] = value;
            }
        }
    }

    return metadata;
}

// Extract content after [/METADATA] block
function extractContentFromFileContent(text) {
    const metadataEnd = text.indexOf('[/METADATA]');
    if (metadataEnd >= 0) {
        return text.slice(metadataEnd + 11).trim();
    }
    return text.trim();
}

async function fetchChunkContentByIds(env, ids) {
    if (!ids || ids.length === 0) return new Map();

    const contentMap = new Map();
    const batchSize = 100;

    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        const query = `
            SELECT id, content
            FROM sec_rag_chunks_content
            WHERE id IN (${placeholders})
        `;
        const result = await env.DB.prepare(query).bind(...batch).all();
        for (const row of result.results || []) {
            if (row.id && row.content) {
                contentMap.set(row.id, row.content);
            }
        }
    }

    return contentMap;
}

// Rerank chunks using Cohere
async function rerankWithCohere(query, chunks, topK, env) {
    if (chunks.length === 0) return { chunks: [], latencyMs: 0 };

    const startTime = Date.now();

    try {
        const response = await fetch('https://api.cohere.ai/v1/rerank', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env.COHERE_API_KEY}`
            },
            body: JSON.stringify({
                model: 'rerank-english-v3.0',
                query,
                documents: chunks.map(c => c.content),
                top_n: Math.min(topK, chunks.length),
                return_documents: false
            })
        });

        if (!response.ok) {
            console.error('Cohere rerank failed:', await response.text());
            // Fall back to original ordering
            return {
                chunks: chunks.slice(0, topK),
                latencyMs: Date.now() - startTime
            };
        }

        const data = await response.json();

        // Map rerank results back to chunks
        const reranked = data.results.map(r => ({
            ...chunks[r.index],
            rerankScore: r.relevance_score
        }));

        return {
            chunks: reranked.sort((a, b) => b.rerankScore - a.rerankScore),
            latencyMs: Date.now() - startTime
        };

    } catch (error) {
        console.error('Cohere rerank error:', error);
        return {
            chunks: chunks.slice(0, topK),
            latencyMs: Date.now() - startTime
        };
    }
}

// Detect the new Answer/Evidence format (or any non-bulleted narrative)
function isAnswerEvidenceFormat(answer) {
    const hasLabels = /(^|\n)Answer:\s*/.test(answer) || /(^|\n)Evidence:\s*/.test(answer);
    const hasBullets = /(^|\n)###\s+/.test(answer);
    return hasLabels || !hasBullets;
}

// Filter out bullets/sections that have zero validated citations
// This prevents returning claims that lost all their supporting evidence
function filterUnsupportedBullets(answer, validChunkIndices, extractedQuotes) {
    const hasAnswerEvidenceFormat = isAnswerEvidenceFormat(answer);
    if (hasAnswerEvidenceFormat) {
        const answerBlockMatch = answer.match(/Answer:\s*([\s\S]*?)\nEvidence:/);
        const answerBlock = answerBlockMatch ? answerBlockMatch[1] : '';
        const hasAnswerCitation = /\[CHUNK_\d+\]/.test(answerBlock);
        return {
            text: answer,
            bulletCount: hasAnswerCitation ? 1 : 0,
            originalBulletCount: 1
        };
    }

    // Split answer into sections by ### headers
    const sections = answer.split(/(?=^### )/m);

    const filteredSections = sections.filter(section => {
        // Always keep non-bullet content (intro, ## headers)
        if (!section.startsWith('### ')) {
            return true;
        }

        // Find all CHUNK_N references in this section
        const chunkRefs = [...section.matchAll(/\[CHUNK_(\d+)\]/g)];
        if (chunkRefs.length === 0) {
            // Section has no citations - remove it (unsupported claim)
            return false;
        }

        // Check if any of the referenced chunks have valid citations
        const hasValidCitation = chunkRefs.some(match => {
            const chunkIndex = parseInt(match[1]);
            return validChunkIndices.has(chunkIndex);
        });

        return hasValidCitation;
    });

    // Count surviving bullets (### sections)
    const survivingBullets = filteredSections.filter(s => s.startsWith('### ')).length;

    return {
        text: filteredSections.join(''),
        bulletCount: survivingBullets,
        originalBulletCount: sections.filter(s => s.startsWith('### ')).length
    };
}

function enforceAnalysisCitations(answer) {
    const hasAnswerEvidenceFormat = isAnswerEvidenceFormat(answer);
    if (hasAnswerEvidenceFormat) {
        return answer;
    }

    const sections = answer.split(/(?=^### )/m);
    const updated = sections.map(section => {
        if (!section.startsWith('### ')) {
            return section;
        }

        const lines = section.split('\n');
        const kept = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                kept.push(line);
                continue;
            }

            if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed === 'Answer:' || trimmed === 'Evidence:') {
                kept.push(line);
                continue;
            }

            // Keep quoted evidence lines and any line that already has citations
            if (trimmed.includes('[CHUNK_')) {
                kept.push(line);
                continue;
            }

            // Drop analysis lines without citations
        }

        return kept.join('\n');
    });

    return updated.join('');
}

function formatCitationLabel(chunk) {
    const date = chunk?.filingDate ? chunk.filingDate : 'unknown-date';
    const doc = chunk?.docType ? chunk.docType : 'Document';
    const ticker = chunk?.ticker ? chunk.ticker : 'UNK';
    return `${ticker} ${doc} ${date}`;
}

function replaceChunkCitations(answer, chunks) {
    return answer.replace(/\[CHUNK_(\d+)\]/g, (match, idx) => {
        const chunk = chunks[parseInt(idx, 10)];
        const label = formatCitationLabel(chunk);
        return `[${label}]`;
    });
}

function normalizeAnswerFormatting(answer) {
    const hasAnswer = /(^|\n)Answer:\s*/.test(answer);
    const hasEvidence = /(^|\n)Evidence:\s*/.test(answer);
    let text = answer.trim();

    if (!hasAnswer && !hasEvidence) {
        return text;
    }

    // Ensure line breaks around sections
    text = text.replace(/Answer:\s*/g, 'Answer:\n');
    text = text.replace(/Evidence:\s*/g, '\nEvidence:\n');

    // Ensure evidence bullets are on separate lines
    const parts = text.split(/\nEvidence:\n/);
    if (parts.length === 2) {
        let [answerBlock, evidenceBlock] = parts;
        // Insert a blank line after each citation in the Answer block for readability.
        answerBlock = answerBlock.replace(/\]\s*(?=[A-Z0-9])/g, ']\n\n');
        const normalizedEvidence = evidenceBlock
            .split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => line.startsWith('-') ? line : `- ${line}`)
            .join('\n');
        text = `${answerBlock.trim()}\n\nEvidence:\n${normalizedEvidence}`;
    }

    return text.trim();
}

// Generate strictly grounded answer with Claude
// Includes quote validation to prevent hallucinated citations
async function generateGroundedAnswer(query, chunks, intent, env) {
    const startTime = Date.now();

    // Build context with chunk IDs for citation tracking
    const context = chunks.map((chunk, i) => {
        const company = SEC_COMPANY_PATTERNS.find(c => c.ticker === chunk.ticker);
        return `[CHUNK_${i}]
Company: ${company?.name || chunk.ticker} (${chunk.ticker})
Document: ${chunk.docType} | Filed: ${chunk.filingDate} | Section: ${chunk.section}
URL: ${chunk.sourceUrl}

${chunk.content}
[/CHUNK_${i}]`;
    }).join('\n\n');

    const systemPrompt = `You are a financial analyst assistant analyzing SEC filings and earnings calls from beverage alcohol companies.

CRITICAL RULES:
1. ONLY answer based on the provided chunks. If the information isn't in the chunks, say "Insufficient coverage in retrieved materials."
2. EVERY claim MUST have a citation: [CHUNK_N] where N is the chunk number.
3. EVERY citation MUST include a VERBATIM quote using this format: "[exact quote from chunk]" [CHUNK_N]
4. Quotes must be EXACT substrings from the chunk text - do not paraphrase or modify.
5. ALL non-quote analysis sentences must end with a citation in brackets.
6. If multiple companies discuss the topic, organize by company.
7. Never make up information or infer beyond what's stated.

OUTPUT FORMAT:
Answer:
- Provide 1–3 short paragraphs (max 2 sentences each).
- Synthesize and group related risks; avoid long lists.
- Include citations at the end of each sentence.
- Use at most 6 citations total.

Evidence:
- 3–6 bullets total, each: "[verbatim quote]" [CHUNK_N]
- Quotes must be exact substrings from chunks.

Do NOT include a "Changes vs Prior Period" section unless the user explicitly asks for changes/trends/compare or you have direct comparisons in the chunks.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Question: ${query}

Retrieved Documents (${chunks.length} chunks from ${[...new Set(chunks.map(c => c.ticker))].join(', ')}):

${context}

Intent: wantsComparison=${intent?.wantsComparison ? 'true' : 'false'}

Provide a concise, synthesized answer. IMPORTANT: Every quote must be an exact substring from the chunk text. Use "[verbatim quote]" [CHUNK_N] format.`
            }]
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error: ${error}`);
    }

    const data = await response.json();
    const answer = enforceAnalysisCitations(data.content[0].text);

    // Quote length constraints
    const MIN_QUOTE_LENGTH = 25;   // Minimum meaningful quote (avoid cherry-picked fragments)
    const MAX_QUOTE_LENGTH = 240;  // Max quote length - reject (not just truncate) overly long quotes

    // Extract all quotes and their citations from the answer
    // Pattern: "quote text" [CHUNK_N] or "[quote text]" [CHUNK_N]
    const quotePattern = /"([^"]+)"\s*\[CHUNK_(\d+)\]/g;
    const extractedQuotes = [];
    let quoteMatch;
    while ((quoteMatch = quotePattern.exec(answer)) !== null) {
        extractedQuotes.push({
            quote: quoteMatch[1],
            chunkIndex: parseInt(quoteMatch[2]),
            fullMatch: quoteMatch[0],
            matchIndex: quoteMatch.index
        });
    }

    // Validate each quote is a substring of its cited chunk
    const validatedCitations = [];
    const invalidQuotes = [];
    const validChunkIndices = new Set();  // Track which chunks have valid citations

    for (const { quote, chunkIndex } of extractedQuotes) {
        const chunk = chunks[chunkIndex];
        if (!chunk) {
            invalidQuotes.push({ quote, chunkIndex, reason: 'Invalid chunk index' });
            continue;
        }

        // Enforce quote length limits - REJECT (not truncate) out-of-range quotes
        if (quote.length < MIN_QUOTE_LENGTH) {
            invalidQuotes.push({ quote, chunkIndex, reason: `Quote too short (${quote.length} < ${MIN_QUOTE_LENGTH} chars)` });
            continue;
        }

        if (quote.length > MAX_QUOTE_LENGTH) {
            invalidQuotes.push({ quote: quote.slice(0, 100) + '...', chunkIndex, reason: `Quote too long (${quote.length} > ${MAX_QUOTE_LENGTH} chars)` });
            continue;
        }

        // Normalize whitespace for comparison
        const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
        const chunkContent = chunk.content || '';
        const normalizedContent = chunkContent.toLowerCase().replace(/\s+/g, ' ');

        const hasFullContent = chunk.hasFullContent && normalizedContent.length > 0;
        const isValid = hasFullContent
            ? (normalizedContent.includes(normalizedQuote) ||
                (normalizedQuote.length >= 50 && normalizedContent.includes(normalizedQuote.slice(0, 50))))
            : (chunk.ticker && chunk.docType && quote.length >= MIN_QUOTE_LENGTH);

        if (isValid) {
            const company = SEC_COMPANY_PATTERNS.find(c => c.ticker === chunk.ticker);
            validChunkIndices.add(chunkIndex);

            validatedCitations.push({
                ticker: chunk.ticker,
                company: company?.name || chunk.ticker,
                docType: chunk.docType,
                filingDate: chunk.filingDate,
                section: chunk.section,
                sourceUrl: chunk.sourceUrl,
                quote: quote,
                chunkId: chunk.id,
                validated: true
            });
        } else {
            invalidQuotes.push({
                quote: quote.slice(0, 100),
                chunkIndex,
                reason: hasFullContent ? 'Quote not found in full chunk content' : 'Quote not validated (no full content)'
            });
        }
    }

    // Per-bullet citation gating: remove sections with zero validated citations
    // Parse answer into bullets (### headers) and filter out unsupported ones
    const filteredAnswer = filterUnsupportedBullets(answer, validChunkIndices, extractedQuotes);
    const usesAnswerEvidenceFormat = isAnswerEvidenceFormat(answer);

    // Deduplicate citations by chunk ID
    const uniqueCitations = [];
    const seenChunks = new Set();
    for (const citation of validatedCitations) {
        if (!seenChunks.has(citation.chunkId)) {
            seenChunks.add(citation.chunkId);
            uniqueCitations.push(citation);
        }
    }

    // Log validation failures for debugging
    if (invalidQuotes.length > 0) {
        console.log(`Quote validation: ${validatedCitations.length} valid, ${invalidQuotes.length} invalid`);
        console.log('Invalid quotes:', JSON.stringify(invalidQuotes.slice(0, 3)));
    }

    // Log per-bullet filtering
    if (filteredAnswer.bulletCount < filteredAnswer.originalBulletCount) {
        console.log(`Bullet filtering: ${filteredAnswer.bulletCount}/${filteredAnswer.originalBulletCount} bullets survived`);
    }

    // Gate the answer on BOTH citation count AND surviving bullet count
    const MIN_VALID_CITATIONS = usesAnswerEvidenceFormat ? 2 : 3;
    const MIN_SURVIVING_BULLETS = usesAnswerEvidenceFormat ? 0 : 2;

    const insufficientCitations = uniqueCitations.length < MIN_VALID_CITATIONS;
    const insufficientBullets = !usesAnswerEvidenceFormat && filteredAnswer.bulletCount < MIN_SURVIVING_BULLETS;

    if (insufficientCitations || insufficientBullets) {
        const reason = insufficientCitations
            ? `only ${uniqueCitations.length} citations could be validated`
            : `only ${filteredAnswer.bulletCount} claims have supporting evidence`;

        console.log(`Insufficient coverage (non-blocking): ${reason}`);
    }

    // Calculate token usage (approximate)
    const inputTokens = Math.ceil((systemPrompt.length + context.length + query.length) / 4);
    const outputTokens = Math.ceil(filteredAnswer.text.length / 4);

    const formattedAnswer = normalizeAnswerFormatting(replaceChunkCitations(filteredAnswer.text, chunks));

    return {
        answer: formattedAnswer,  // Use formatted answer with filing citations
        citations: uniqueCitations,
        validationStats: {
            totalQuotes: extractedQuotes.length,
            validQuotes: validatedCitations.length,
            invalidQuotes: invalidQuotes.length,
            bulletsOriginal: filteredAnswer.originalBulletCount,
            bulletsSurviving: filteredAnswer.bulletCount
        },
        tokenUsage: {
            context: inputTokens,
            generation: outputTokens
        },
        latencyMs: Date.now() - startTime
    };
}

export async function handleSecQuery(request, env) {
    const totalStartTime = Date.now();
    const body = await request.json();
    const { query, email, filters = {} } = body;

    // Validate input
    if (!query || query.trim().length < 5) {
        return { success: false, error: 'Query too short (minimum 5 characters)' };
    }

    if (!email) {
        return { success: false, error: 'Authentication required' };
    }

    // Check Pro status and credits
    const user = await env.DB.prepare(
        'SELECT is_pro, enhancement_credits FROM user_preferences WHERE email = ?'
    ).bind(email).first();

    if (!user?.is_pro) {
        return { success: false, error: 'Pro subscription required' };
    }

    if (!user.enhancement_credits || user.enhancement_credits < 1) {
        return {
            success: false,
            error: 'Insufficient credits',
            credits: user.enhancement_credits || 0
        };
    }

    const queryHash = await hashText(query + JSON.stringify(filters));

    // Parse query intent
    const intent = parseSecQueryIntent(query, filters);

    // Step 1: Search Cloudflare Vectorize (fast - ~100-200ms total)
    let retrievedChunks, retrievalLatency;
    try {
        const searchResult = await searchVectorize(query, intent, env);
        retrievedChunks = searchResult.chunks;
        retrievalLatency = searchResult.latencyMs;
        console.log(`Vectorize search: ${searchResult.embedLatencyMs}ms embed + ${searchResult.vectorizeLatencyMs}ms query = ${retrievalLatency}ms total`);
    } catch (error) {
        console.error('Vectorize search error:', error);
        return { success: false, error: 'Search failed: ' + error.message };
    }

    // Filter by date window if filing_date is present
    if (intent?.dateWindow?.start && intent?.dateWindow?.end) {
        const start = intent.dateWindow.start;
        const end = intent.dateWindow.end;
        retrievedChunks = retrievedChunks.filter(c => !c.filingDate || (c.filingDate >= start && c.filingDate <= end));
    }

    // Enforce ticker/docType filters after retrieval (in case Vectorize filter is ignored)
    if (intent?.tickers?.length && intent.tickers.length < SEC_ALL_TICKERS.length) {
        const allowedTickers = new Set(intent.tickers);
        retrievedChunks = retrievedChunks.filter(c => allowedTickers.has(c.ticker));
    }

    if (intent?.docTypes?.length) {
        const allowedDocTypes = new Set(intent.docTypes);
        retrievedChunks = retrievedChunks.filter(c => allowedDocTypes.has(c.docType));
    }

    // Check if we have sufficient coverage
    if (retrievedChunks.length === 0) {
        return {
            success: true,
            error: 'insufficient_coverage',
            message: 'Insufficient coverage in retrieved materials.',
            searched: {
                tickers: intent.tickers,
                dateRange: intent.dateWindow,
                docTypes: intent.docTypes
            },
            chunksRetrieved: 0,
            answer_markdown: 'Insufficient coverage in retrieved materials.',
            citations: [],
            retrieval_debug: {
                query,
                filters: intent,
                retrievedChunks: [],
                rerankedTop: [],
                tokenUsage: { embedding: 0, context: 0, generation: 0 },
                latencyMs: { retrieval: retrievalLatency, rerank: 0, generation: 0, total: Date.now() - totalStartTime }
            }
        };
    }

    // Load full chunk content from D1 for quote validation
    try {
        const contentMap = await fetchChunkContentByIds(env, retrievedChunks.map(c => c.id));
        for (const chunk of retrievedChunks) {
            const fullContent = contentMap.get(chunk.id);
            if (fullContent) {
                chunk.content = fullContent;
                chunk.hasFullContent = true;
            }
        }
    } catch (error) {
        console.error('Failed to load chunk content from D1:', error);
    }

    // Step 2: Rerank with Cohere (top 15)
    let rerankedChunks, rerankLatency;
    try {
        const rerankResult = await rerankWithCohere(query, retrievedChunks, RAG_RERANK_TOP_K, env);
        rerankedChunks = rerankResult.chunks;
        rerankLatency = rerankResult.latencyMs;
    } catch (error) {
        console.error('Rerank error:', error);
        // Fall back to top 10 from retrieval
        rerankedChunks = retrievedChunks.slice(0, RAG_RERANK_TOP_K);
        rerankLatency = 0;
    }
 
    // Prefer CALL transcripts when the query implies "what management said"
    if (intent?.wantsCallPriority) {
        rerankedChunks = rerankedChunks
            .map(chunk => {
                const base = chunk.rerankScore ?? chunk.score ?? 0;
                const boost = chunk.docType === 'CALL' ? 0.15 : 0;
                return { ...chunk, rerankScore: base + boost };
            })
            .sort((a, b) => (b.rerankScore ?? b.score ?? 0) - (a.rerankScore ?? a.score ?? 0));
    }

    // Step 3: Generate grounded answer with Claude
    let answer, citations, tokenUsage, generationLatency;
    try {
        const genResult = await generateGroundedAnswer(query, rerankedChunks, intent, env);
        answer = genResult.answer;
        citations = genResult.citations;
        tokenUsage = genResult.tokenUsage;
        generationLatency = genResult.latencyMs;
    } catch (error) {
        console.error('Generation error:', error);
        return { success: false, error: 'Failed to generate answer: ' + error.message };
    }

    // Deduct credit
    await env.DB.prepare(
        'UPDATE user_preferences SET enhancement_credits = enhancement_credits - 1 WHERE email = ?'
    ).bind(email).run();

    // Build response
    const response = {
        answer_markdown: answer,
        citations,
        retrieval_debug: {
            query,
            filters: {
                tickers: intent.tickers,
                docTypes: intent.docTypes,
                dateRange: intent.dateWindow
            },
            retrievedChunks: retrievedChunks.slice(0, 50).map(c => ({
                id: c.id,
                score: c.score,
                ticker: c.ticker,
                docType: c.docType,
                section: c.section
            })),
            rerankedTop: rerankedChunks.map(c => ({
                id: c.id,
                rerankScore: c.rerankScore || c.score,
                ticker: c.ticker,
                docType: c.docType,
                section: c.section
            })),
            tokenUsage: {
                embedding: 0, // OpenAI handles this
                ...tokenUsage
            },
            latencyMs: {
                retrieval: retrievalLatency,
                rerank: rerankLatency,
                generation: generationLatency,
                total: Date.now() - totalStartTime
            }
        }
    };

    // Log query for analytics
    try {
        await env.DB.prepare(`
            INSERT INTO sec_rag_queries (email, query, filters, chunks_retrieved, chunks_used, latency_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            email,
            query,
            JSON.stringify(intent),
            retrievedChunks.length,
            rerankedChunks.length,
            Date.now() - totalStartTime
        ).run();
    } catch (e) {
        // Ignore logging errors
    }

    return {
        success: true,
        cached: false,
        ...response,
        credits_remaining: (user.enhancement_credits || 1) - 1
    };
}

export async function handleGenerateEmbeddings(request, env) {
    // Deprecated: legacy embedding pipeline uses different metadata/IDs.
    // Keeping endpoint but returning a clear error to avoid index contamination.
    return {
        success: false,
        error: 'Deprecated endpoint. Use scripts/sec-rag/ingest.ts to generate embeddings.',
    };

    void request;
    void env;
}

export async function handleSecMdaDiff(path, url, env) {
    const diffId = path.split('/').pop();
    const email = url.searchParams.get('email');

    if (!diffId || isNaN(parseInt(diffId))) {
        return { success: false, error: 'Invalid diff ID' };
    }

    // Check Pro status
    let isPro = false;
    if (email) {
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE email = ?'
        ).bind(email).first();
        isPro = user?.is_pro === 1;
    }

    if (!isPro) {
        return { success: false, error: 'Pro subscription required' };
    }

    const diff = await env.DB.prepare(`
        SELECT
            d.*,
            sc.ticker, sc.company_name,
            sf1.filing_type as current_filing_type, sf1.fiscal_year as current_year,
            sf2.fiscal_year as previous_year
        FROM sec_mda_diffs d
        JOIN sec_companies sc ON d.sec_company_id = sc.id
        JOIN sec_filings sf1 ON d.current_filing_id = sf1.id
        JOIN sec_filings sf2 ON d.previous_filing_id = sf2.id
        WHERE d.id = ?
    `).bind(parseInt(diffId)).first();

    if (!diff) {
        return { success: false, error: 'Diff not found' };
    }

    // Parse significant_changes JSON
    if (diff.significant_changes) {
        try {
            diff.significant_changes = JSON.parse(diff.significant_changes);
        } catch (e) {
            diff.significant_changes = [];
        }
    }

    return {
        success: true,
        diff
    };
}

export async function handleSecMdaCompare(url, env) {
    const currentFilingId = url.searchParams.get('current');
    const previousFilingId = url.searchParams.get('previous');
    const email = url.searchParams.get('email');

    if (!currentFilingId || !previousFilingId) {
        return { success: false, error: 'Both current and previous filing IDs required' };
    }

    // Check Pro status
    let isPro = false;
    if (email) {
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE email = ?'
        ).bind(email).first();
        isPro = user?.is_pro === 1;
    }

    if (!isPro) {
        return { success: false, error: 'Pro subscription required' };
    }

    // Check if diff already exists
    const existingDiff = await env.DB.prepare(`
        SELECT id FROM sec_mda_diffs
        WHERE current_filing_id = ? AND previous_filing_id = ?
    `).bind(parseInt(currentFilingId), parseInt(previousFilingId)).first();

    if (existingDiff) {
        return handleSecMdaDiff(`/api/sec/mda-diff/${existingDiff.id}`, url, env);
    }

    // Get MD&A sections for both filings
    const currentMda = await env.DB.prepare(`
        SELECT content FROM sec_filing_sections
        WHERE filing_id = ? AND section_type = 'mda'
    `).bind(parseInt(currentFilingId)).first();

    const previousMda = await env.DB.prepare(`
        SELECT content FROM sec_filing_sections
        WHERE filing_id = ? AND section_type = 'mda'
    `).bind(parseInt(previousFilingId)).first();

    if (!currentMda || !previousMda) {
        return { success: false, error: 'MD&A section not found for one or both filings' };
    }

    return {
        success: true,
        message: 'Diff comparison not yet computed. Run sec_compute_mda_diffs.py to generate.',
        current_length: currentMda.content?.length || 0,
        previous_length: previousMda.content?.length || 0
    };
}

// Helper to hash text for caching
async function hashText(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
