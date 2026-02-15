/**
 * Module 5: Contact Enrichment
 *
 * Finds key contacts at the company using Hunter.io domain search.
 * Returns contacts as a special _contacts array (multi-row, written separately).
 *
 * Requires: HUNTER_IO_API_KEY
 * Optional: ZEROBOUNCE_API_KEY (for email verification)
 */

export async function enrich(context, env) {
    const { company_name, website_url } = context;

    if (!env.HUNTER_IO_API_KEY) {
        console.log('[Contacts] SKIPPED: no HUNTER_IO_API_KEY');
        return {};
    }

    if (!website_url) {
        console.log('[Contacts] SKIPPED: no website_url — cannot search domain');
        return {};
    }

    const domain = extractDomain(website_url);
    if (!domain) {
        console.log('[Contacts] SKIPPED: could not extract domain');
        return {};
    }

    console.log(`[Contacts] Searching Hunter.io for domain: ${domain}`);
    const contacts = [];

    try {
        const resp = await fetch(
            `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${env.HUNTER_IO_API_KEY}&limit=10`
        );

        if (resp.ok) {
            const data = await resp.json();
            const emails = data.data?.emails || [];

            for (const e of emails) {
                const contact = {
                    full_name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
                    title: e.position || null,
                    email: e.value || null,
                    email_verified: e.verification?.status === 'valid' ? 1 : 0,
                    email_verification_score: e.confidence ? e.confidence / 100 : null,
                    linkedin_url: e.linkedin || null,
                    linkedin_headline: null,
                    phone: e.phone_number || null,
                    source: 'hunter_io',
                    is_decision_maker: isDecisionMaker(e.position) ? 1 : 0,
                };
                contacts.push(contact);
            }

            console.log(`[Contacts] Hunter.io found ${contacts.length} contacts`);
        } else {
            console.log(`[Contacts] Hunter.io returned ${resp.status}`);
        }
    } catch (e) {
        console.error(`[Contacts] Error: ${e.message}`);
    }

    // Return contacts in special _contacts key (handled separately by orchestrator)
    return { _contacts: contacts };
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

function isDecisionMaker(title) {
    if (!title) return false;
    const lower = title.toLowerCase();
    const dmKeywords = ['ceo', 'founder', 'owner', 'president', 'director', 'vp', 'vice president',
        'chief', 'head of', 'general manager', 'managing', 'partner', 'principal'];
    return dmKeywords.some(kw => lower.includes(kw));
}
