/**
 * Module 1: Resolve Website
 *
 * Finds the company's website URL by checking internal data sources.
 * This module works WITHOUT external API keys by querying D1 for:
 *   1. label_website from COLA enrichment (OCR-extracted from labels)
 *   2. website_url from old company_enhancements table
 *   3. website_url from company_enrichments (if previously partially enriched)
 *
 * When PDL_API_KEY is available, also queries People Data Labs for website.
 */

export async function enrich(context, env) {
    const { company_id, company_name } = context;
    console.log(`[ResolveWebsite] Resolving website for company_id=${company_id}`);

    let website_url = null;

    // Source 1: Check label_website from COLA enrichment pipeline (most reliable)
    try {
        const labelResult = await env.DB.prepare(`
            SELECT co.label_website
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ? AND co.label_website IS NOT NULL AND co.label_website != ''
            LIMIT 1
        `).bind(company_id).first();

        if (labelResult?.label_website) {
            website_url = normalizeUrl(labelResult.label_website);
            console.log(`[ResolveWebsite] Found via label_website: ${website_url}`);
        }
    } catch (e) {
        console.error(`[ResolveWebsite] Label website query failed: ${e.message}`);
    }

    // Source 2: Check old company_enhancements table
    if (!website_url) {
        try {
            const oldResult = await env.DB.prepare(`
                SELECT website_url FROM company_enhancements WHERE company_id = ? AND website_url IS NOT NULL
            `).bind(company_id).first();

            if (oldResult?.website_url) {
                website_url = normalizeUrl(oldResult.website_url);
                console.log(`[ResolveWebsite] Found via old company_enhancements: ${website_url}`);
            }
        } catch (e) {
            // Table may not exist — that's fine
        }
    }

    // Source 3: Check company_enrichments (partial prior enrichment)
    if (!website_url) {
        try {
            const existingResult = await env.DB.prepare(`
                SELECT website_url FROM company_enrichments WHERE company_id = ? AND website_url IS NOT NULL
            `).bind(company_id).first();

            if (existingResult?.website_url) {
                website_url = normalizeUrl(existingResult.website_url);
                console.log(`[ResolveWebsite] Found via company_enrichments: ${website_url}`);
            }
        } catch (e) {
            // Table may not exist yet
        }
    }

    // Source 4: People Data Labs (when API key available)
    if (!website_url && env.PDL_API_KEY) {
        try {
            const resp = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?name=${encodeURIComponent(company_name)}&min_likelihood=3`, {
                headers: { 'X-Api-Key': env.PDL_API_KEY }
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.website) {
                    website_url = normalizeUrl(data.website);
                    console.log(`[ResolveWebsite] Found via PDL: ${website_url}`);
                }
            }
        } catch (e) {
            console.error(`[ResolveWebsite] PDL lookup failed: ${e.message}`);
        }
    }

    if (!website_url) {
        console.log(`[ResolveWebsite] No website found for ${company_name}`);
        return {};
    }

    return { website_url };
}

function normalizeUrl(url) {
    if (!url) return null;
    url = url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    // Remove trailing slash
    return url.replace(/\/+$/, '');
}
