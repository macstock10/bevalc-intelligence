/**
 * Module 7: Consumer Platform Data
 *
 * Checks consumer review platforms for ratings and engagement:
 * - Untappd (beer/brewery) — requires UNTAPPD_CLIENT_ID + UNTAPPD_CLIENT_SECRET
 * - Vivino (wine) — requires VIVINO_API_KEY or scraping
 *
 * These APIs help gauge consumer traction and brand reputation.
 */

export async function enrich(context, env) {
    const { company_name } = context;
    const result = {};

    // Untappd brewery search
    if (env.UNTAPPD_CLIENT_ID && env.UNTAPPD_CLIENT_SECRET) {
        try {
            console.log(`[Consumer] Searching Untappd for ${company_name}`);
            const resp = await fetch(
                `https://api.untappd.com/v4/search/brewery?q=${encodeURIComponent(company_name)}&client_id=${env.UNTAPPD_CLIENT_ID}&client_secret=${env.UNTAPPD_CLIENT_SECRET}&limit=1`
            );

            if (resp.ok) {
                const data = await resp.json();
                const brewery = data.response?.brewery?.items?.[0]?.brewery;
                if (brewery) {
                    result.untappd_brewery_id = String(brewery.brewery_id);
                    result.untappd_rating = brewery.rating?.rating_score || null;
                    result.untappd_checkin_count = brewery.stats?.total_count || null;
                    result.untappd_beer_count = brewery.stats?.total_count || null;
                    console.log(`[Consumer] Untappd: rating=${result.untappd_rating}, checkins=${result.untappd_checkin_count}`);
                }
            }
        } catch (e) {
            console.error(`[Consumer] Untappd error: ${e.message}`);
        }
    } else {
        console.log('[Consumer] SKIPPED Untappd: no UNTAPPD_CLIENT_ID');
    }

    // Vivino winery search
    if (env.VIVINO_API_KEY) {
        try {
            console.log(`[Consumer] Searching Vivino for ${company_name}`);
            const resp = await fetch(
                `https://www.vivino.com/api/search/wineries?q=${encodeURIComponent(company_name)}`,
                { headers: { 'Authorization': `Bearer ${env.VIVINO_API_KEY}` } }
            );

            if (resp.ok) {
                const data = await resp.json();
                const winery = data.wineries?.[0];
                if (winery) {
                    result.vivino_winery_id = String(winery.id);
                    result.vivino_rating = winery.statistics?.ratings_average || null;
                    result.vivino_review_count = winery.statistics?.ratings_count || null;
                    result.vivino_wine_count = winery.statistics?.wines_count || null;
                    console.log(`[Consumer] Vivino: rating=${result.vivino_rating}, reviews=${result.vivino_review_count}`);
                }
            }
        } catch (e) {
            console.error(`[Consumer] Vivino error: ${e.message}`);
        }
    } else {
        console.log('[Consumer] SKIPPED Vivino: no VIVINO_API_KEY');
    }

    if (Object.keys(result).length === 0) {
        console.log('[Consumer] No consumer platform data found');
    }

    return result;
}
