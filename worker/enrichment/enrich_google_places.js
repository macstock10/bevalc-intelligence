/**
 * Module 4: Google Places
 *
 * Searches Google Places API for the company to get:
 * - Rating and review count
 * - Address, phone, category
 * - Business hours and photo count
 *
 * Requires: GOOGLE_PLACES_API_KEY
 */

export async function enrich(context, env) {
    const { company_name, state } = context;

    if (!env.GOOGLE_PLACES_API_KEY) {
        console.log('[GooglePlaces] SKIPPED: no GOOGLE_PLACES_API_KEY');
        return {};
    }

    console.log(`[GooglePlaces] Searching for ${company_name}`);
    const result = {};

    try {
        // Step 1: Find Place from Text
        const searchQuery = state ? `${company_name} ${state}` : company_name;
        const findResp = await fetch(
            `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery)}&inputtype=textquery&fields=place_id&key=${env.GOOGLE_PLACES_API_KEY}`
        );

        if (!findResp.ok) {
            console.log(`[GooglePlaces] Find place returned ${findResp.status}`);
            return {};
        }

        const findData = await findResp.json();
        const placeId = findData.candidates?.[0]?.place_id;
        if (!placeId) {
            console.log('[GooglePlaces] No place found');
            return {};
        }

        result.google_place_id = placeId;

        // Step 2: Place Details
        const fields = 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,types,opening_hours,photos';
        const detailsResp = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${env.GOOGLE_PLACES_API_KEY}`
        );

        if (detailsResp.ok) {
            const detailsData = await detailsResp.json();
            const place = detailsData.result;

            if (place) {
                if (place.rating) result.google_rating = place.rating;
                if (place.user_ratings_total) result.google_review_count = place.user_ratings_total;
                if (place.formatted_address) result.google_address = place.formatted_address;
                if (place.formatted_phone_number) result.google_phone = place.formatted_phone_number;
                if (place.types?.length > 0) result.google_category = place.types[0];
                if (place.opening_hours?.weekday_text) {
                    result.google_hours = JSON.stringify(place.opening_hours.weekday_text);
                }
                if (place.photos) result.google_photos_count = place.photos.length;

                console.log(`[GooglePlaces] Found: rating=${result.google_rating}, reviews=${result.google_review_count}`);
            }
        }
    } catch (e) {
        console.error(`[GooglePlaces] Error: ${e.message}`);
    }

    return result;
}
