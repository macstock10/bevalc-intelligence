/**
 * Module 8: Funding Data
 *
 * Queries Crunchbase for funding information:
 * - Total raised, funding stage, investors
 * - Last funding date and amount
 *
 * Requires: CRUNCHBASE_API_KEY
 */

export async function enrich(context, env) {
    const { company_name } = context;

    if (!env.CRUNCHBASE_API_KEY) {
        console.log('[Funding] SKIPPED: no CRUNCHBASE_API_KEY');
        return {};
    }

    console.log(`[Funding] Searching Crunchbase for ${company_name}`);
    const result = {};

    try {
        // Search for the organization
        const searchResp = await fetch('https://api.crunchbase.com/api/v4/autocompletes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-cb-user-key': env.CRUNCHBASE_API_KEY
            },
            body: JSON.stringify({
                query: company_name,
                collection_ids: ['organizations'],
                limit: 1
            })
        });

        if (!searchResp.ok) {
            console.log(`[Funding] Crunchbase search returned ${searchResp.status}`);
            return {};
        }

        const searchData = await searchResp.json();
        const orgId = searchData.entities?.[0]?.identifier?.permalink;
        if (!orgId) {
            console.log('[Funding] No Crunchbase organization found');
            return {};
        }

        // Get funding details
        const orgResp = await fetch(
            `https://api.crunchbase.com/api/v4/entities/organizations/${orgId}?field_ids=funding_total,last_funding_type,num_funding_rounds,last_funding_at,investor_identifiers`,
            { headers: { 'X-cb-user-key': env.CRUNCHBASE_API_KEY } }
        );

        if (orgResp.ok) {
            const orgData = await orgResp.json();
            const props = orgData.properties || {};

            if (props.funding_total?.value) {
                result.funding_total = `$${formatFunding(props.funding_total.value)}`;
            }
            if (props.last_funding_type) result.funding_stage = props.last_funding_type;
            if (props.last_funding_at) result.last_funding_date = props.last_funding_at;
            if (props.investor_identifiers?.length > 0) {
                result.funding_investors = JSON.stringify(
                    props.investor_identifiers.map(i => i.value).slice(0, 10)
                );
            }

            console.log(`[Funding] Found: total=${result.funding_total || 'none'}, stage=${result.funding_stage || 'none'}`);
        }
    } catch (e) {
        console.error(`[Funding] Error: ${e.message}`);
    }

    return result;
}

function formatFunding(amount) {
    if (amount >= 1e9) return `${(amount / 1e9).toFixed(1)}B`;
    if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `${(amount / 1e3).toFixed(0)}K`;
    return String(amount);
}
