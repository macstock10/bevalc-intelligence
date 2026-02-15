/**
 * Module 10: AI Brief Generation
 *
 * Uses Claude to generate a 3-5 sentence company intelligence brief
 * from all data gathered by modules 1-9.
 *
 * Requires: ANTHROPIC_API_KEY (already available in Worker env)
 */

export async function enrich(context, env) {
    if (!env.ANTHROPIC_API_KEY) {
        console.log('[Brief] SKIPPED: no ANTHROPIC_API_KEY');
        return {};
    }

    const { company_name, company_id, state, website_url, industry,
        employee_count_range, founding_year, revenue_range,
        google_rating, google_review_count, google_address,
        instagram_handle, facebook_url, linkedin_url,
        untappd_rating, vivino_rating, funding_total, funding_stage,
        tech_stack, has_ecommerce } = context;

    console.log(`[Brief] Generating AI brief for ${company_name}`);

    // Build context summary for Claude
    const facts = [];
    if (website_url) facts.push(`Website: ${website_url}`);
    if (industry) facts.push(`Industry: ${industry}`);
    if (employee_count_range) facts.push(`Employees: ${employee_count_range}`);
    if (founding_year) facts.push(`Founded: ${founding_year}`);
    if (revenue_range) facts.push(`Revenue: ${revenue_range}`);
    if (state) facts.push(`State: ${state}`);
    if (google_rating) facts.push(`Google Rating: ${google_rating}/5 (${google_review_count || 0} reviews)`);
    if (google_address) facts.push(`Address: ${google_address}`);
    if (instagram_handle) facts.push(`Instagram: @${instagram_handle}`);
    if (linkedin_url) facts.push(`LinkedIn: ${linkedin_url}`);
    if (untappd_rating) facts.push(`Untappd Rating: ${untappd_rating}/5`);
    if (vivino_rating) facts.push(`Vivino Rating: ${vivino_rating}/5`);
    if (funding_total) facts.push(`Funding: ${funding_total} (${funding_stage || 'unknown stage'})`);
    if (tech_stack) {
        try {
            const stack = JSON.parse(tech_stack);
            if (stack.length > 0) facts.push(`Tech Stack: ${stack.slice(0, 5).join(', ')}`);
        } catch { /* ignore */ }
    }
    if (has_ecommerce) facts.push('Has e-commerce / DTC capability');

    if (facts.length === 0) {
        console.log('[Brief] No enrichment data to summarize');
        return {};
    }

    try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 300,
                messages: [{
                    role: 'user',
                    content: `Write a 3-5 sentence company intelligence brief for "${company_name}" based ONLY on these verified facts. Be specific and factual. Do not speculate or add information not in the facts. Format as a single paragraph.

VERIFIED FACTS:
${facts.map(f => `- ${f}`).join('\n')}

Write the brief:`
                }]
            })
        });

        if (resp.ok) {
            const data = await resp.json();
            const brief = data.content?.[0]?.text?.trim();
            if (brief) {
                console.log(`[Brief] Generated ${brief.length} char brief`);
                return { ai_brief: brief };
            }
        } else {
            console.error(`[Brief] Claude API returned ${resp.status}`);
        }
    } catch (e) {
        console.error(`[Brief] Error: ${e.message}`);
    }

    return {};
}
