/**
 * Module 3: Domain Intelligence
 *
 * Analyzes the company's domain for:
 * - Registration date and registrar (via WHOIS)
 * - Tech stack detection (via Wappalyzer/BuiltWith)
 * - E-commerce and age verification indicators
 *
 * Requires: WHOISXML_API_KEY and/or WAPPALYZER_API_KEY
 */

export async function enrich(context, env) {
    const { website_url } = context;

    if (!website_url) {
        console.log('[Domain] SKIPPED: no website_url in context');
        return {};
    }

    const hasWhois = !!env.WHOISXML_API_KEY;
    const hasWappalyzer = !!env.WAPPALYZER_API_KEY;

    if (!hasWhois && !hasWappalyzer) {
        console.log('[Domain] SKIPPED: no WHOISXML_API_KEY or WAPPALYZER_API_KEY');
        return {};
    }

    const domain = extractDomain(website_url);
    if (!domain) {
        console.log('[Domain] SKIPPED: could not extract domain from URL');
        return {};
    }

    console.log(`[Domain] Analyzing domain: ${domain}`);
    const result = {};

    // WHOIS lookup
    if (hasWhois) {
        try {
            const resp = await fetch(
                `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${env.WHOISXML_API_KEY}&domainName=${domain}&outputFormat=JSON`
            );
            if (resp.ok) {
                const data = await resp.json();
                const record = data?.WhoisRecord;
                if (record) {
                    if (record.createdDate) result.domain_registered_date = record.createdDate.split('T')[0];
                    if (record.registrarName) result.domain_registrar = record.registrarName;
                }
                console.log(`[Domain] WHOIS: registered ${result.domain_registered_date || 'unknown'}`);
            }
        } catch (e) {
            console.error(`[Domain] WHOIS error: ${e.message}`);
        }
    }

    // Tech stack detection
    if (hasWappalyzer) {
        try {
            const resp = await fetch(
                `https://api.wappalyzer.com/v2/lookup/?urls=${encodeURIComponent(website_url)}`,
                { headers: { 'x-api-key': env.WAPPALYZER_API_KEY } }
            );
            if (resp.ok) {
                const data = await resp.json();
                const technologies = data?.[0]?.technologies || [];
                const techNames = technologies.map(t => t.name);

                if (techNames.length > 0) {
                    result.tech_stack = JSON.stringify(techNames);
                }

                // Detect e-commerce platforms
                const ecommerceKeywords = ['Shopify', 'WooCommerce', 'BigCommerce', 'Magento', 'Square Online', 'Squarespace Commerce'];
                result.has_ecommerce = techNames.some(t => ecommerceKeywords.some(kw => t.includes(kw))) ? 1 : 0;

                // Detect age verification
                const ageVerifyKeywords = ['AgeChecker', 'Agegate', 'Veratad'];
                result.has_age_verification = techNames.some(t => ageVerifyKeywords.some(kw => t.includes(kw))) ? 1 : 0;

                console.log(`[Domain] Tech stack: ${techNames.length} technologies, ecommerce=${result.has_ecommerce}`);
            }
        } catch (e) {
            console.error(`[Domain] Wappalyzer error: ${e.message}`);
        }
    }

    return result;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}
