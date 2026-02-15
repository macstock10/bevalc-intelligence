/**
 * Module 2: Firmographics Enrichment
 *
 * Queries People Data Labs and/or OpenCorporates for company details:
 * employee count, founding year, revenue range, entity type, industry.
 *
 * Requires: PDL_API_KEY (People Data Labs)
 * Optional: OPENCORPORATES_API_KEY
 */

export async function enrich(context, env) {
    const { company_name, website_url } = context;

    if (!env.PDL_API_KEY) {
        console.log('[Firmographics] SKIPPED: no PDL_API_KEY');
        return {};
    }

    console.log(`[Firmographics] Enriching firmographics for ${company_name}`);
    const result = {};

    try {
        // Build query params — use website if available for better matching
        const params = new URLSearchParams({ name: company_name, min_likelihood: '3' });
        if (website_url) {
            params.set('website', website_url);
        }

        const resp = await fetch(`https://api.peopledatalabs.com/v5/company/enrich?${params}`, {
            headers: { 'X-Api-Key': env.PDL_API_KEY }
        });

        if (resp.ok) {
            const data = await resp.json();

            if (data.employee_count) {
                result.employee_count_range = categorizeEmployeeCount(data.employee_count);
            }
            if (data.founded) result.founding_year = data.founded;
            if (data.estimated_annual_revenue) {
                result.revenue_range = data.estimated_annual_revenue;
            }
            if (data.type) result.entity_type = data.type;
            if (data.industry) result.industry = data.industry;

            console.log(`[Firmographics] PDL returned: ${JSON.stringify(result)}`);
        } else {
            console.log(`[Firmographics] PDL returned ${resp.status}`);
        }
    } catch (e) {
        console.error(`[Firmographics] Error: ${e.message}`);
    }

    return result;
}

function categorizeEmployeeCount(count) {
    if (count <= 10) return '1-10';
    if (count <= 50) return '11-50';
    if (count <= 200) return '51-200';
    if (count <= 500) return '201-500';
    if (count <= 1000) return '501-1000';
    if (count <= 5000) return '1001-5000';
    return '5000+';
}
