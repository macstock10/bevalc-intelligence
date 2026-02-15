/**
 * Module 9: Trademark Data
 *
 * Searches USPTO TESS (Trademark Electronic Search System) for brand trademarks.
 * USPTO TESS is a free public database — no API key required.
 *
 * Note: USPTO doesn't have a proper REST API. The TESS system uses
 * form-based queries. This module uses the TSDR (Trademark Status
 * & Document Retrieval) API which provides JSON data for known serial numbers.
 *
 * For now, this is a stub that will be filled in when we determine the best
 * approach for trademark search (scraping TESS vs. paid API like TrademarkAPI).
 */

export async function enrich(context, env) {
    const { company_name } = context;

    // USPTO TESS doesn't have a clean REST API.
    // Options for future implementation:
    // 1. TrademarkAPI.com (paid, has REST API)
    // 2. Scrape TESS search results (fragile)
    // 3. USPTO bulk data download + local search

    console.log('[Trademark] SKIPPED: trademark search not yet implemented');
    return {};
}
