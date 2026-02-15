/**
 * Module 6: Social Media Discovery
 *
 * Discovers social media handles by checking common URL patterns.
 * No API key required — uses direct HTTP checks.
 *
 * Checks: Instagram, Facebook, Twitter/X, LinkedIn, TikTok
 */

export async function enrich(context, env) {
    const { company_name, website_url } = context;
    console.log(`[Social] Discovering social profiles for ${company_name}`);

    const result = {};

    // If we have a website, try to scrape social links from it
    if (website_url) {
        try {
            const resp = await fetch(website_url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BevAlcIntelBot/1.0)' },
                signal: AbortSignal.timeout(8000),
                redirect: 'follow'
            });

            if (resp.ok) {
                const html = await resp.text();

                // Extract social media URLs from HTML
                const instagram = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)/);
                const facebook = html.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_.]+)/);
                const twitter = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
                const linkedin = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_-]+)/);
                const tiktok = html.match(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+)/);

                if (instagram) result.instagram_handle = instagram[1];
                if (facebook) result.facebook_url = facebook[0];
                if (twitter) result.twitter_handle = twitter[1];
                if (linkedin) result.linkedin_url = linkedin[0];
                if (tiktok) result.tiktok_handle = tiktok[1];

                console.log(`[Social] Found from website: ${Object.keys(result).join(', ') || 'none'}`);
            }
        } catch (e) {
            console.log(`[Social] Website scrape failed: ${e.message}`);
        }
    }

    // If no social links found, we could try Google CSE here in the future
    if (Object.keys(result).length === 0) {
        console.log('[Social] No social profiles found');
    }

    return result;
}
