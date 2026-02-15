/**
 * Company Enrichment Orchestrator
 *
 * Runs 10 enrichment modules in a defined order:
 *   Phase A (series): resolve_website → firmographics → domain → google_places
 *   Phase B (parallel): contacts, social, consumer, funding, trademark, brief
 *
 * Each module returns a dict of fields. The orchestrator merges them
 * and returns { enrichment, contacts } for the caller to write to D1.
 */

import { enrich as resolveWebsite } from './resolve_website.js';
import { enrich as enrichFirmographics } from './enrich_firmographics.js';
import { enrich as enrichDomain } from './enrich_domain.js';
import { enrich as enrichGooglePlaces } from './enrich_google_places.js';
import { enrich as enrichContacts } from './enrich_contacts.js';
import { enrich as enrichSocial } from './enrich_social.js';
import { enrich as enrichConsumer } from './enrich_consumer.js';
import { enrich as enrichFunding } from './enrich_funding.js';
import { enrich as enrichTrademark } from './enrich_trademark.js';
import { enrich as generateBrief } from './generate_brief.js';

export async function runEnrichment(companyId, companyName, state, env) {
    const startTime = Date.now();
    console.log(`[Enrichment] Starting enrichment for company_id=${companyId} "${companyName}"`);

    const context = { company_id: companyId, company_name: companyName, state };

    // Phase A: Series — each module feeds results to the next
    const websiteResult = await safeEnrich('resolve_website', resolveWebsite, context, env);
    Object.assign(context, websiteResult);

    const firmoResult = await safeEnrich('firmographics', enrichFirmographics, context, env);
    Object.assign(context, firmoResult);

    const domainResult = await safeEnrich('domain', enrichDomain, context, env);
    Object.assign(context, domainResult);

    const placesResult = await safeEnrich('google_places', enrichGooglePlaces, context, env);
    Object.assign(context, placesResult);

    // Phase B: Parallel — independent modules run concurrently
    const [contactsResult, socialResult, consumerResult,
           fundingResult, trademarkResult, briefResult] = await Promise.all([
        safeEnrich('contacts', enrichContacts, context, env),
        safeEnrich('social', enrichSocial, context, env),
        safeEnrich('consumer', enrichConsumer, context, env),
        safeEnrich('funding', enrichFunding, context, env),
        safeEnrich('trademark', enrichTrademark, context, env),
        safeEnrich('brief', generateBrief, context, env),
    ]);

    // Extract contacts (multi-row, stored separately)
    const contacts = contactsResult._contacts || [];

    // Build enrichment_sources tracking
    const sources = {
        resolve_website: Object.keys(websiteResult).length > 0,
        firmographics: Object.keys(firmoResult).length > 0,
        domain: Object.keys(domainResult).length > 0,
        google_places: Object.keys(placesResult).length > 0,
        contacts: contacts.length > 0,
        social: Object.keys(socialResult).length > 0,
        consumer: Object.keys(consumerResult).length > 0,
        funding: Object.keys(fundingResult).length > 0,
        trademark: Object.keys(trademarkResult).length > 0,
        brief: Object.keys(briefResult).length > 0,
    };

    // Merge all results into one flat object (excluding _contacts)
    const enrichment = {
        company_id: companyId,
        company_name: companyName,
        ...websiteResult,
        ...firmoResult,
        ...domainResult,
        ...placesResult,
        ...stripPrivateKeys(contactsResult),
        ...socialResult,
        ...consumerResult,
        ...fundingResult,
        ...trademarkResult,
        ...briefResult,
        enriched_at: new Date().toISOString(),
        enrichment_sources: JSON.stringify(sources),
        enrichment_version: '1.0',
    };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const activeModules = Object.values(sources).filter(Boolean).length;
    console.log(`[Enrichment] Complete: ${activeModules}/10 modules returned data, ${contacts.length} contacts, ${elapsed}s`);

    return { enrichment, contacts };
}

/**
 * Wraps a module's enrich() call with error handling.
 * If a module throws, log the error and return {} so other modules continue.
 */
async function safeEnrich(name, enrichFn, context, env) {
    try {
        return await enrichFn(context, env);
    } catch (e) {
        console.error(`[Enrichment] Module "${name}" threw: ${e.message}`);
        return {};
    }
}

/**
 * Remove keys starting with _ from a result dict (used for _contacts).
 */
function stripPrivateKeys(obj) {
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith('_')) cleaned[k] = v;
    }
    return cleaned;
}
