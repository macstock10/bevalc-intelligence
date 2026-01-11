/**
 * BevAlc Intelligence API Worker
 * Cloudflare Worker for D1 database queries + Stripe integration
 */

// Security headers for all responses
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    'https://bevalcintel.com',
    'https://www.bevalcintel.com',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
];

// Verify Stripe webhook signature
async function verifyStripeSignature(payload, signature, secret) {
    if (!signature || !secret) return false;

    const parts = signature.split(',');
    let timestamp = null;
    let sig = null;

    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') timestamp = value;
        if (key === 'v1') sig = value;
    }

    if (!timestamp || !sig) return false;

    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const expectedSig = Array.from(new Uint8Array(signatureBytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return sig === expectedSig;
}

// Verify user token for authenticated endpoints
async function verifyUserToken(email, token, env) {
    if (!email || !token) return false;

    const user = await env.DB.prepare(
        'SELECT preferences_token FROM user_preferences WHERE email = ? AND preferences_token = ?'
    ).bind(email.toLowerCase(), token).first();

    return !!user;
}

// Get CORS headers based on origin
function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
    };
}

// Rate limiting configuration
const RATE_LIMIT_REQUESTS = 60;
const RATE_LIMIT_WINDOW = 60;
const rateLimitMap = new Map();

function cleanupRateLimitMap() {
    const now = Date.now();
    const windowMs = RATE_LIMIT_WINDOW * 1000;
    for (const [ip, data] of rateLimitMap.entries()) {
        if (now - data.windowStart > windowMs * 2) {
            rateLimitMap.delete(ip);
        }
    }
}

function checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = RATE_LIMIT_WINDOW * 1000;
    
    if (Math.random() < 0.01) cleanupRateLimitMap();
    
    let data = rateLimitMap.get(ip);
    
    if (!data || (now - data.windowStart) > windowMs) {
        data = { windowStart: now, count: 1 };
        rateLimitMap.set(ip, data);
        return { allowed: true, remaining: RATE_LIMIT_REQUESTS - 1 };
    }
    
    if (data.count >= RATE_LIMIT_REQUESTS) {
        const retryAfter = Math.ceil((data.windowStart + windowMs - now) / 1000);
        return { allowed: false, remaining: 0, retryAfter };
    }
    
    data.count++;
    return { allowed: true, remaining: RATE_LIMIT_REQUESTS - data.count };
}

// TTB Category/Subcategory mapping - subcategory name -> array of TTB codes
const TTB_SUBCATEGORIES = {
  // Whiskey
  "Bourbon": ["STRAIGHT BOURBON WHISKY", "BOURBON WHISKY", "BOURBON WHISKY BIB", "STRAIGHT BOURBON WHISKY BLENDS", "BLENDED BOURBON WHISKY"],
  "Rye": ["STRAIGHT RYE WHISKY", "RYE WHISKY", "RYE WHISKY BIB", "STRAIGHT RYE WHISKY BLENDS", "BLENDED RYE WHISKY"],
  "American Single Malt": ["AMERICAN SINGLE MALT WHISKEY", "AMERICAN SINGLE MALT WHISKEY - BIB", "STRAIGHT AMERICAN SINGLE MALT"],
  "Scotch": ["SCOTCH WHISKY", "SCOTCH WHISKY FB", "SCOTCH WHISKY USB", "SINGLE MALT SCOTCH WHISKY", "UNBLENDED SCOTCH WHISKY USB", "DILUTED SCOTCH WHISKY FB", "DILUTED SCOTCH WHISKY USB"],
  "Irish Whiskey": ["IRISH WHISKY", "IRISH WHISKY FB", "IRISH WHISKY USB", "DILUTED IRISH WHISKY FB", "DILUTED IRISH WHISKY USB"],
  "Canadian Whisky": ["CANADIAN WHISKY", "CANADIAN WHISKY FB", "CANADIAN WHISKY USB", "DILUTED CANADIAN WHISKY FB", "DILUTED CANADIAN WHISKY USB"],
  "Corn Whiskey": ["STRAIGHT CORN WHISKY", "CORN WHISKY", "CORN WHISKY BIB", "STRAIGHT CORN WHISKY BLENDS", "BLENDED CORN WHISKY"],
  "Malt Whisky": ["STRAIGHT MALT WHISKY", "MALT WHISKY"],
  "Blended Whiskey": ["STRAIGHT WHISKY", "STRAIGHT WHISKY BLENDS", "WHISKY BLENDS", "BLENDED WHISKY", "BLENDED LIGHT WHISKY", "LIGHT WHISKY", "DILUTED BLENDED WHISKY", "OTHER WHISKY BLENDS", "OTHER STRAIGHT BLENDED WHISKY", "WHISKY", "WHISKY BOTTLED IN BOND (BIB)", "OTHER WHISKY BIB", "OTHER STRAIGHT WHISKY"],
  "Flavored Whiskey": ["OTHER WHISKY (FLAVORED)", "WHISKY ORANGE FLAVORED", "WHISKY GRAPE FLAVORED", "WHISKY LIME FLAVORED", "WHISKY LEMON FLAVORED", "WHISKY CHERRY FLAVORED", "WHISKY CHOCOLATE FLAVORED", "WHISKY MINT FLAVORED", "WHISKY PEPPERMINT FLAVORED", "WHISKY OTHER FLAVORED"],
  "Other Whiskey": ["WHISKY PROPRIETARY", "SPIRIT WHISKY", "DILUTED WHISKY", "OTHER IMPORTED WHISKY", "OTHER IMPORTED WHISKY FB", "OTHER IMPORTED WHISKY USB", "DILUTED OTHER IMPORTED WHISKY FB", "DILUTED OTHER IMPORTED WHISKY USB", "WHISKY SPECIALTIES", "LIQUEURS (WHISKY)"],
  // Vodka
  "Unflavored Vodka": ["VODKA", "VODKA 80-89 PROOF", "VODKA 90-99 PROOF", "VODKA 100 PROOF UP", "VODKA 80-89 PROOF FB", "VODKA 80-89 PROOF USB", "VODKA 90-99 PROOF FB", "VODKA 90-99 PROOF USB", "VODKA 100 PROOF UP FB", "VODKA 100 PROOF UP USB", "OTHER VODKA", "DILUTED VODKA", "DILUTED VODKA FB", "DILUTED VODKA USB"],
  "Flavored Vodka": ["VODKA - FLAVORED", "VODKA - ORANGE FLAVORED", "VODKA - GRAPE FLAVORED", "VODKA - LIME FLAVORED", "VODKA - LEMON FLAVORED", "VODKA - CHERRY FLAVORED", "VODKA - CHOCOLATE FLAVORED", "VODKA - MINT FLAVORED", "VODKA - PEPPERMINT FLAVORED", "VODKA - OTHER FLAVORED"],
  "Other Vodka": ["VODKA SPECIALTIES", "LIQUEURS (VODKA)"],
  // Tequila
  "Tequila": ["TEQUILA FB", "TEQUILA USB", "DILUTED TEQUILA FB", "DILUTED TEQUILA USB"],
  "Mezcal": ["MEZCAL", "MEZCAL FB", "MEZCAL US", "DILUTED MEZCAL", "FLAVORED MEZCAL"],
  "Other Tequila": ["AGAVE SPIRITS", "FLAVORED AGAVE SPIRIT", "FLAVORED TEQUILA"],
  // Gin
  "London Dry Gin": ["LONDON DRY GIN", "LONDON DRY DISTILLED GIN", "LONDON DRY DISTILLED GIN FB", "LONDON DRY DISTILLED GIN USB", "LONDON DRY GIN FB", "LONDON DRY GIN USB"],
  "Distilled Gin": ["DISTILLED GIN", "OTHER DISTILLED GIN", "OTHER DISTILLED GIN FB", "OTHER DISTILLED GIN USB"],
  "Flavored Gin": ["GIN - FLAVORED", "GIN - MINT FLAVORED", "GIN - ORANGE FLAVORED", "GIN - LEMON FLAVORED", "GIN - CHERRY FLAVORED", "GIN - APPLE FLAVORED", "GIN - BLACKBERRY FLAVORED", "GIN - PEACH FLAVORED", "GIN - GRAPE FLAVORED", "OTHER GIN - FLAVORED"],
  "Other Gin": ["GIN", "OTHER GIN", "OTHER GIN FB", "OTHER GIN USB", "DILUTED GIN", "DILUTED GIN FB", "DILUTED GIN USB", "GIN SPECIALTIES", "LIQUEURS (GIN)", "SLOE GIN"],
  // Rum
  "White Rum": ["U.S. RUM (WHITE)", "UR.S. RUM (WHITE)", "PUERTO RICAN RUM (WHITE)", "VIRGIN ISLANDS RUM (WHITE)", "HAWAIIAN RUM (WHITE)", "FLORIDA RUM (WHITE)", "OTHER RUM (WHITE)", "OTHER WHITE RUM", "CUBAN RUM WHITE FB", "JAMAICAN RUM WHITE FB", "JAMAICAN RUM WHITE USB", "GUIANAN RUM WHITE FB", "GUIANAN RUM WHITE USB", "MARTINICAN RUM WHITE FB", "MARTINICAN RUM WHITE USB", "OTHER RUM WHITE FB", "OTHER RUM WHITE USB", "DILUTED RUM (WHITE)", "DILUTED RUM WHITE FB", "DILUTED RUM WHITE USB"],
  "Gold/Aged Rum": ["U.S. RUM (GOLD)", "PUERTO RICAN RUM (GOLD)", "VIRGIN ISLANDS RUM (GOLD)", "VIRGIN ISLANDS RUM", "HAWAIIAN RUM (GOLD)", "FLORIDA RUM (GOLD)", "OTHER RUM (GOLD)", "CUBAN RUM GOLD FB", "JAMAICAN RUM GOLD FB", "JAMICAN RUM GOLD USB", "DUTCH GUIANAN RUM GOLD FB", "DUTCH GUIANAN RUM GOLD USB", "MARTINICAN RUM GOLD FB", "MARTINICAN RUM GOLD USB", "OTHER RUM GOLD FB", "OTHER RUM GOLD USB", "DILUTED RUM (GOLD)", "DILUTED RUM GOLD FB", "DILUTED RUM GOLD USB"],
  "Flavored Rum": ["RUM FLAVORED (BOLD)", "FLAVORED RUM (BOLD)", "RUM ORANGE GLAVORED", "RUM ORANGE FLAVORED", "RUM GRAPE FLAVORED", "RUM LIME FLAVORED", "RUM LEMON FLAVORED", "RUM CHERRY FLAVORED", "RUM CHOCOLATE FLAVORED", "RUM MINT FLAVORED", "RUM PEPPERMINT FLAVORED", "RUM OTHER FLAVORED", "DOMESTIC FLAVORED RUM", "IMPORTED FLAVORED RUM"],
  "Other Rum": ["FOREIGN RUM", "OTHER FOREIGN RUM", "OTHER FORIEGN RUM", "FRENCH GUIANAN RUM FB", "RUM SPECIALTIES", "LIQUEURS (RUM)", "CACHACA"],
  // Brandy
  "Cognac": ["COGNAC (BRANDY) FB", "COGNAC (BRANDY) USB"],
  "Armagnac": ["ARMAGNAC (BRANDY) FB", "ARMAGNAC (BRANDY) USB"],
  "American Brandy": ["BRANDY", "CALIFORNIA BRANDY", "CALIFORNIA GRAPE BRANDY", "CALIFORNIA DRIED BRANDY", "CALIFORNIA LEES BRANDY", "CALIFORNIA POMACE OR MARC BRANDY", "CALIFORNIA RESIDUE BRANDY", "CALIFORNIA NEUTRAL BRANDY", "OTHER CALIFORNIA BRANDY", "NEW YORK BRANDY", "NEW YORK GRAPE BRANDY", "NEW YORK DRIED BRANDY", "NEW YORK LEES BRANDY", "NEW YORK POMACE OR MARC BRANDY", "NEW YORK RESIDUE BRANDY", "NEW YORK NEUTRAL BRANDY", "OTHER NEW YORK BRANDY", "OTHER DOMESTIC GRAPE BRANDY", "DRIED BRANDY", "LEES BRANDY", "POMACE OR MARC BRANDY", "RESIDUE BRANDY", "NEUTRAL BRANDY", "IMMATURE BRANDY", "OTHER BRANDY"],
  "Fruit Brandy": ["FRUIT BRANDY", "APPLE BRANDY", "APPLE BRANDY (CALVADOS)", "CHERRY BRANDY", "PLUM BRANDY", "PLUM BRANDY (SLIVOVITZ)", "BLACKBERRY BRANDY", "BLENDED APPLE JACK BRANDY", "PEAR BRANDY", "APRICOT BRANDY", "OTHER FRUIT BRANDY", "FOREIGN FRUIT BRANDY"],
  "Grappa & Pisco": ["OTHER GRAPE BRANDY (PISCO, GRAPPA) FB", "OTHER GRAPE BRANDY (GRAPPA) USB"],
  "Flavored Brandy": ["BRANDY - FLAVORED", "BRANDY - APRICOT FLAVORED", "BRANDY - BLACKBERRY FLAVORED", "BRANDY - PEACH FLAVORED", "BRANDY - CHERRY FLAVORED", "BRANDY - GINGER FLAVORED", "BRANDY - COFFEE FLAVORED", "BRANDY APPLE FLAVORED", "BRANDY APRICOT FLAVORED", "BRANDY BLACKBERRY FLAVORED", "BRANDY CHERRY FLAVORED", "BRANDY COFFEE FLAVORED", "BRANDY GINGER FLAVORED", "BRANDY PEACH FLAVORED", "OTHER BRANDY - FLAVORED", "OTHER FLAVORED BRANDY", "BLACKBERRY FLAVORED BRANDY", "CHERRY FLAVORED BRANDY", "APRICOT FLAVORED BRANDY", "PEACH FLAVORED BRANDY", "GINGER FLAVORED BRANDY"],
  "Other Brandy": ["FRENCH BRANDY", "OTHER FRENCH BRANDY FB", "OTHER FRENCH BRANDY USB", "ITALIAN GRAPE BRANDY FB", "ITALIAN GRAPE BRANDY USB", "SPANISH GRAPE BRANDY FB", "SPANISH GRAPE BRANDY USB", "PORTUGUESE GRAPE BRANDY FB", "PORTUGUESE GRAPE BRANDY USB", "GREEK GRAPE BRANDY FB", "GREEK GRAPE BRANDY USB", "GERMAN GRAPE BRANDY FB", "GERMAN GRAPE BRANDY USB", "AUSTRALIAN GRAPE BRANDY FB", "AUSTRALIAN GRAPE BRANDY USB", "SOUTH AFRICAN GRAPE BRANDY FB", "SOUTH AFRICAN GRAPE BRANDY USB", "OTHER FOREIGN BRANDY", "OTHER FOREIGN BRANDY (CONT.)", "DILUTED BRANDY FB", "DILUTED BRANDY USB", "LIQUEUR & BRANDY"],
  // Wine
  "Red Wine": ["TABLE RED WINE"],
  "White Wine": ["TABLE WHITE WINE"],
  "Rosé Wine": ["ROSE WINE"],
  "Sparkling Wine": ["SPARKLING WINE/CHAMPAGNE", "SPARKLING WINE/ CIDER", "SPARKLING WINE/MEAD", "CARBONATED WINE", "CARBONATED WINE/CIDER", "CARBONATED WINE/MEAD"],
  "Dessert Wine": ["DESSERT /PORT/SHERRY/(COOKING) WINE", "DESSERT FLAVORED WINE", "DESSERT FRUIT WINE", "HONEY BASED DESSERT WINE", "APPLE BASED DESSERT FLAVORED WINE", "APPLE DESSERT WINE/CIDER"],
  "Flavored Wine": ["TABLE FLAVORED WINE", "APPLE BASED FLAVORED WINE", "HONEY BASED TABLE WINE"],
  "Fruit Wine": ["TABLE FRUIT WINE", "APPLE TABLE WINE/CIDER"],
  "Fortified Wine": ["VERMOUTH/MIXED TYPES"],
  "Sake": ["SAKE", "SAKE - IMPORTED", "SAKE - DOMESTIC FLAVORED", "SAKE - IMPORTED FLAVORED"],
  "Other Wine": [],
  // Beer
  "Lager/Beer": ["BEER", "IRC BEER", "IRC BEER-IMPORTED", "OTHER MALT BEVERAGES (BEER)", "OTHER MALT BEVERAGES"],
  "Ale": ["ALE"],
  "Stout": ["STOUT"],
  "Porter": ["PORTER"],
  "Malt Liquor": ["MALT LIQUOR", "MALT BEVERAGES"],
  "Flavored Malt Beverages": ["MALT BEVERAGES SPECIALITIES - FLAVORED", "MALT BEVERAGES SPECIALITIES"],
  "Non-Alcoholic Beer": ["CEREAL BEVERAGES - NEAR BEER (NON ALCOHOLIC)"],
  "Other Beer": [],
  // Liqueur
  "Fruit Liqueurs": ["CORDIALS (FRUIT & PEELS)", "FRUIT FLAVORED LIQUEURS", "CURACAO", "TRIPLE SEC", "OTHER FRUITS & PEELS LIQUEURS", "OTHER FRUIT & PEELS LIQUEURS", "FRUITS & PEELS SCHNAPPS LIQUEUR"],
  "Cream Liqueurs": ["CORDIALS (CREMES OR CREAMS)", "CREME DE CACAO WHITE", "CREME DE CACAO BROWN", "CREME DE MENTHE WHITE", "CREME DE MENTHE GREEN", "CREME DE ALMOND (NOYAUX)", "DAIRY CREAM LIQUEUR/CORDIAL", "NON DAIRY CREME LIQUEUR/CORDIAL", "OTHER LIQUEUR (CREME OR CREAMS)", "OTHER LIQUEUR (CREMES OR CREAMS)"],
  "Herbal Liqueurs": ["CORDIALS (HERBS & SEEDS)", "ANISETTE, OUZO, OJEN", "KUMMEL", "ARACK/RAKI", "SAMBUCA", "OTHER (HERBS & SEEDS)", "OTHER HERB & SEED CORDIALS/LIQUEURS", "HERBS AND SEEDS SCHNAPPS LIQUEUR", "HERBS & SEEDS SCHNAPPS LIQUEUR"],
  "Coffee Liqueurs": ["COFFEE (CAFE) LIQUEUR"],
  "Nut Liqueurs": ["AMARETTO"],
  "Schnapps": ["PEPPERMINT SCHNAPPS"],
  "Other Liqueurs": ["ROCK & RYE, RUM & BRANDY (ETC.)", "SPECIALTIES & PROPRIETARIES", "SPECIALITIES & PROPRIETARIES", "OTHER SPECIALTIES & PROPRIETARIES", "BITTERS - BEVERAGE", "BITTERS - BEVERAGE*"],
  // RTD/Cocktails
  "Whiskey Cocktails": ["WHISKY MANHATTAN (48 PROOF UP)", "WHISKY MANHATTAN (UNDER 48 PROOF)", "WHISKY MANHATTAN UNDER 48 PROOF", "WHISKY OLD FASHIONED (48 PROOF UP)", "WHISKY OLD FASHIONED (UNDER 48 PROOF)", "WHISKY OLD FASHIONED UNDER 48 PROOF", "WHISKY SOUR (48 PROOF UP )", "WHISKY SOUR (UNDER 48 PROOF)", "WHISKY SOUR UNDER 48 PROOF"],
  "Vodka Cocktails": ["VODKA MARTINI (48 PROOF UP)", "VODKA MARTINI (UNDER 48 PROOF)", "VODKA MARTINI  UNDER 48 PROOF", "VODKA MARTINI 48 PROOF UP", "SCREW DRIVER", "BLOODY MARY"],
  "Gin Cocktails": ["GIN MARTINI (48 PROOF UP)", "GIN MARTINI (UNDER 48 PROOF)", "GIN MARTINI 48 PROOF UP", "GIN MARTINI UNDER 48 PROOF", "GIN SOUR (UNDER 48 PROOF)", "GIN SOUR UNDER 48 PROOF", "COLLINS"],
  "Rum Cocktails": ["DAIQUIRI (48 PROOF UP)", "DAIQUIRI (UNDER 48 PROOF)", "DAIQUIRI 48 PROOF UP", "DAIQUIRI UNDER 48 PROOF", "COLADA (48PROOF UP)", "COLADA (48 PROOF UP )", "COLADA (UNDER 48 PROOF)", "COLADA (UNDER 48 PROOF )"],
  "Tequila Cocktails": ["MARGARITA (48 PROOF UP)", "MARGARITA (UNDER 48 PROOF)", "MARGARITA 48 PROOF UP", "MARGARITA UNDER 48 PROOF", "OTHER TEQUILA-BASED COCKTAILS (UNDER 48 PROOF)"],
  "Brandy Cocktails": ["BRANDY STINGER (48 PROOF UP)", "BRANDY STINGER (UNDER 48 PROOF)", "BRANDY STINGER UNDER 48 PROOF", "BRANDY SIDE CAR (48 PROOF UP)", "BRANDY SIDE CAR (UNDER 48 PROOF)", "BRANDY SIDE CAR UNDER 48 PROOF"],
  "Other Cocktails": ["COCKTAILS 48 PROOF UP", "COCKTAILS 48 PROOF UP (CONT)", "COCKTAILS UNDER 48 PROOF", "COCKTAILS UNDER 48 PROOF (CONT)", "COCKTAILS UNDER 48 PR(CONT)", "MIXED DRINKS-HI BALLS COCKTAILS", "OTHER COCKTAILS (48 PROOF UP)", "OTHER COCTAILS (48PROOF UP)", "OTHER COCKTAILS (UNDER 48 PROOF)", "OTHER MIXED DRINKS HI-BALLS COCKTAILS", "EGG NOG"],
  // Other
  "Neutral Spirits": ["NEUTRAL SPIRITS - GRAIN", "NEUTRAL SPIRITS - FRUIT", "NEUTRAL SPIRITS - CANE", "NEUTRAL SPIRITS - VEGETABLE", "NEUTRAL SPIRITS - PETROLEUM", "GRAIN SPIRITS", "OTHER SPIRITS"],
  "Non-Alcoholic": ["NON ALCOHOLIC MIXES", "NON ALCOHOL MIXES"],
  "Administrative": ["ADMINISTRATIVE WITHDRAWAL"]
};

// Get TTB codes for a subcategory name
function getSubcategoryCodes(subcategory) {
    return TTB_SUBCATEGORIES[subcategory] || [];
}

// Get all TTB codes mapped to specific subcategories for a parent category
// Used by "Other X" filters to exclude specifically mapped codes
function getAllMappedCodesForCategory(parentCategory) {
    const categorySubcategories = {
        'Whiskey': ['Bourbon', 'Rye', 'American Single Malt', 'Scotch', 'Irish Whiskey', 'Canadian Whisky', 'Corn Whiskey', 'Malt Whisky', 'Blended Whiskey', 'Flavored Whiskey'],
        'Vodka': ['Unflavored Vodka', 'Flavored Vodka'],
        'Tequila': ['Tequila', 'Mezcal'],
        'Rum': ['Light Rum', 'Dark Rum', 'Spiced Rum', 'Flavored Rum', 'Cachaça'],
        'Gin': ['London Dry Gin', 'Flavored Gin'],
        'Brandy': ['Grape Brandy', 'Cognac', 'Armagnac', 'Fruit Brandy', 'Grappa', 'Pisco'],
        'Wine': ['Red Wine', 'White Wine', 'Rosé Wine', 'Sparkling Wine', 'Dessert Wine', 'Fruit Wine', 'Fortified Wine', 'Sake'],
        'Beer': ['Lager\\Beer', 'Ale', 'Stout/Porter', 'Hard Seltzer', 'Flavored Malt Beverages'],
        'Liqueur': ['Cream Liqueur', 'Fruit Liqueur', 'Herbal Liqueur', 'Nut Liqueur', 'Coffee Liqueur', 'Chocolate Liqueur', 'Schnapps', 'Triple Sec'],
        'Cocktails': ['RTD Cocktails', 'Gin Cocktails', 'Whiskey Cocktails', 'Rum Cocktails', 'Vodka Cocktails', 'Tequila Cocktails', 'Brandy Cocktails']
    };

    const subcategories = categorySubcategories[parentCategory] || [];
    const allCodes = [];
    for (const subcat of subcategories) {
        const codes = TTB_SUBCATEGORIES[subcat] || [];
        allCodes.push(...codes);
    }
    return allCodes;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Dynamic CORS headers based on origin + security headers
        const corsHeaders = getCorsHeaders(request);
        const allHeaders = { ...corsHeaders, ...SECURITY_HEADERS };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: allHeaders });
        }

        // Rate limiting check (skip for Stripe webhooks - they have signature verification)
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!path.includes('/api/stripe/webhook')) {
            const rateLimit = checkRateLimit(clientIP);

            if (!rateLimit.allowed) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Rate limit exceeded. Please slow down.',
                    retryAfter: rateLimit.retryAfter
                }), {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': String(rateLimit.retryAfter),
                        ...allHeaders
                    }
                });
            }
        }

        try {
            // SEO Pages (HTML responses)
            if (path.startsWith('/company/')) {
                return await handleCompanyPage(path, env, allHeaders);
            } else if (path.startsWith('/brand/')) {
                return await handleBrandPage(path, env, allHeaders);
            } else if (path.startsWith('/category/')) {
                return await handleCategoryPage(path, env, allHeaders);
            } else if (path === '/sitemap.xml' || path.startsWith('/sitemap-')) {
                return await handleSitemap(path, env);
            }

            let response;

            // Stripe endpoints
            if (path === '/api/stripe/create-checkout' && request.method === 'POST') {
                response = await handleCreateCheckout(request, env);
            } else if (path === '/api/stripe/webhook' && request.method === 'POST') {
                return await handleStripeWebhook(request, env, allHeaders);
            } else if (path === '/api/stripe/customer-status') {
                response = await handleCustomerStatus(url, env);
            } else if (path === '/api/stripe/verify-session') {
                response = await handleVerifySession(url, env);
            } else if (path === '/api/stripe/create-portal-session' && request.method === 'POST') {
                response = await handleCreatePortalSession(request, env);
            }
            // User preferences endpoints
            else if (path === '/api/user/preferences' && request.method === 'GET') {
                response = await handleGetPreferences(url, env);
            } else if (path === '/api/user/preferences' && request.method === 'POST') {
                response = await handleSavePreferences(request, env);
            } else if (path === '/api/user/send-preferences-link' && request.method === 'POST') {
                response = await handleSendPreferencesLink(request, env);
            } else if (path === '/api/user/list-by-category') {
                response = await handleListUsersByCategory(url, env);
            } else if (path === '/api/user/check' && request.method === 'GET') {
                response = await handleCheckUserExists(url, env);
            } else if (path === '/api/user/signup-free' && request.method === 'POST') {
                response = await handleSignupFree(request, env);
            }
            // Watchlist endpoints
            else if (path === '/api/watchlist' && request.method === 'GET') {
                response = await handleGetWatchlist(url, env);
            } else if (path === '/api/watchlist/check' && request.method === 'GET') {
                response = await handleCheckWatchlist(url, env);
            } else if (path === '/api/watchlist/counts' && request.method === 'GET') {
                response = await handleWatchlistCounts(url, env);
            } else if (path === '/api/watchlist/add' && request.method === 'POST') {
                response = await handleAddToWatchlist(request, env);
            } else if (path === '/api/watchlist/remove' && request.method === 'POST') {
                response = await handleRemoveFromWatchlist(request, env);
            }
            // Database endpoints
            else if (path === '/api/search') {
                response = await handleSearch(url, env);
            } else if (path === '/api/export') {
                response = await handleExport(url, env);
            } else if (path === '/api/filters') {
                response = await handleFilters(env);
            } else if (path === '/api/record') {
                response = await handleRecord(url, env);
            } else if (path === '/api/stats') {
                response = await handleStats(env);
            } else if (path === '/api/categories') {
                response = await handleCategories(env);
            } else {
                response = { success: false, error: 'Not found' };
            }

            return new Response(JSON.stringify(response), {
                headers: {
                    'Content-Type': 'application/json',
                    ...allHeaders
                }
            });
        } catch (error) {
            return new Response(JSON.stringify({
                success: false,
                error: error.message
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...allHeaders
                }
            });
        }
    }
};

// ==========================================
// STRIPE HANDLERS
// ==========================================

async function handleCreateCheckout(request, env) {
    const body = await request.json();
    const { email, successUrl, cancelUrl, tier } = body;

    const stripeSecretKey = env.STRIPE_SECRET_KEY;

    // Determine price ID based on tier
    let priceId;
    let tierName;
    if (tier === 'premier') {
        priceId = env.STRIPE_PREMIER_PRICE_ID;
        tierName = 'premier';
    } else {
        // Default to category_pro for backwards compatibility
        priceId = env.STRIPE_CATEGORY_PRO_PRICE_ID || env.STRIPE_PRICE_ID;
        tierName = 'category_pro';
    }

    if (!stripeSecretKey || !priceId) {
        return { success: false, error: 'Stripe not configured' };
    }

    const checkoutData = {
        'mode': 'subscription',
        'payment_method_types[]': 'card',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': successUrl || 'https://bevalcintel.com/success.html?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url': cancelUrl || 'https://bevalcintel.com/#pricing',
        'metadata[tier]': tierName,
        'metadata[product]': 'bevalc_intelligence'
    };

    // Pre-fill email if provided
    if (email) {
        checkoutData['customer_email'] = email;
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(checkoutData)
    });

    const session = await response.json();

    if (session.error) {
        return { success: false, error: session.error.message };
    }
    
    return {
        success: true,
        url: session.url,
        sessionId: session.id
    };
}

async function handleStripeWebhook(request, env, headers) {
    const body = await request.text();

    // Verify Stripe webhook signature if secret is configured
    const signature = request.headers.get('Stripe-Signature');
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret) {
        const isValid = await verifyStripeSignature(body, signature, webhookSecret);
        if (!isValid) {
            console.error('Invalid Stripe webhook signature');
            return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json', ...headers }
            });
        }
    } else {
        console.warn('STRIPE_WEBHOOK_SECRET not configured - signature verification skipped');
    }

    let event;
    try {
        event = JSON.parse(body);
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...headers }
        });
    }
    
    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const customerEmail = session.customer_email || session.customer_details?.email;
            const customerId = session.customer;
            const tier = session.metadata?.tier || 'category_pro';

            if (customerEmail) {
                console.log(`Subscription activated for: ${customerEmail}, tier: ${tier}`);

                // Generate unique preferences token
                const preferencesToken = generateToken();

                // Create or update user_preferences record with tier
                try {
                    await env.DB.prepare(`
                        INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                        VALUES (?, ?, 1, ?, ?, '[]', datetime('now'))
                        ON CONFLICT(email) DO UPDATE SET
                            stripe_customer_id = excluded.stripe_customer_id,
                            is_pro = 1,
                            tier = excluded.tier,
                            preferences_token = COALESCE(user_preferences.preferences_token, excluded.preferences_token),
                            updated_at = datetime('now')
                    `).bind(customerEmail.toLowerCase(), customerId, tier, preferencesToken).run();

                    console.log(`User preferences record created/updated for: ${customerEmail}, tier: ${tier}`);

                    // Sync to Loops - mark as Pro with no categories selected yet
                    await syncToLoops(customerEmail, [], true, true, env);

                } catch (dbError) {
                    console.error(`Failed to create user_preferences record: ${dbError.message}`);
                }
            }
            break;
        }
        
        case 'customer.subscription.updated': {
            const subscription = event.data.object;
            console.log(`Subscription updated: ${subscription.id}`);
            break;
        }
        
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            console.log(`Subscription deleted: ${subscription.id}`);
            
            // Mark user as no longer Pro
            try {
                // Get user email first for Loops sync
                const user = await env.DB.prepare(
                    'SELECT email FROM user_preferences WHERE stripe_customer_id = ?'
                ).bind(customerId).first();
                
                await env.DB.prepare(`
                    UPDATE user_preferences
                    SET is_pro = 0, tier = NULL, tier_category = NULL, categories = '[]', updated_at = datetime('now')
                    WHERE stripe_customer_id = ?
                `).bind(customerId).run();
                console.log(`User marked as non-Pro for customer: ${customerId}`);
                
                // Sync to Loops - remove Pro status and clear categories
                if (user && user.email) {
                    await syncToLoops(user.email, [], false, true, env);
                }
            } catch (dbError) {
                console.error(`Failed to update user_preferences: ${dbError.message}`);
            }
            break;
        }
        
        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            console.log(`Payment failed for invoice: ${invoice.id}`);
            break;
        }
    }
    
    return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json', ...headers }
    });
}

async function handleCustomerStatus(url, env) {
    const email = url.searchParams.get('email');

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    // First check D1 database for is_pro flag (allows admin overrides)
    const dbUser = await env.DB.prepare(
        'SELECT is_pro, stripe_customer_id FROM user_preferences WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (dbUser && dbUser.is_pro === 1) {
        return {
            success: true,
            status: 'pro',
            email,
            customerId: dbUser.stripe_customer_id || null,
            source: 'database'
        };
    }

    // Fall back to Stripe check
    const stripeSecretKey = env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
        return { success: false, error: 'Stripe not configured' };
    }

    const response = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email)}'`,
        {
            headers: {
                'Authorization': `Bearer ${stripeSecretKey}`
            }
        }
    );

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
        return { success: true, status: 'free', email };
    }

    const customer = data.data[0];

    const subsResponse = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active`,
        {
            headers: {
                'Authorization': `Bearer ${stripeSecretKey}`
            }
        }
    );

    const subsData = await subsResponse.json();

    if (subsData.data && subsData.data.length > 0) {
        return {
            success: true,
            status: 'pro',
            email,
            customerId: customer.id,
            subscriptionId: subsData.data[0].id
        };
    }

    return { success: true, status: 'free', email };
}

async function handleVerifySession(url, env) {
    const sessionId = url.searchParams.get('session_id');
    
    if (!sessionId) {
        return { success: false, error: 'Session ID required' };
    }
    
    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
        return { success: false, error: 'Stripe not configured' };
    }
    
    const response = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
        {
            headers: {
                'Authorization': `Bearer ${stripeSecretKey}`
            }
        }
    );
    
    const session = await response.json();
    
    if (session.error) {
        return { success: false, error: session.error.message };
    }
    
    // Return immediately - don't query D1 here (too slow)
    // Frontend will fetch preferences token separately
    return {
        success: true,
        status: session.status === 'complete' ? 'complete' : session.status,
        customer_email: session.customer_email || session.customer_details?.email,
        payment_status: session.payment_status,
        subscription_id: session.subscription
    };
}

async function handleCreatePortalSession(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }
    
    const { email, returnUrl } = body;
    
    if (!email) {
        return { success: false, error: 'Email required' };
    }
    
    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
        return { success: false, error: 'Stripe not configured' };
    }
    
    // Find customer by email
    const searchResponse = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email)}'`,
        {
            headers: {
                'Authorization': `Bearer ${stripeSecretKey}`
            }
        }
    );
    
    const searchData = await searchResponse.json();
    
    if (!searchData.data || searchData.data.length === 0) {
        return { success: false, error: 'No customer found' };
    }
    
    const customerId = searchData.data[0].id;
    
    // Create portal session
    const portalResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            'customer': customerId,
            'return_url': returnUrl || 'https://bevalcintel.com/account.html'
        })
    });
    
    const portalData = await portalResponse.json();
    
    if (portalData.error) {
        return { success: false, error: portalData.error.message };
    }
    
    return {
        success: true,
        url: portalData.url
    };
}

// ==========================================
// USER PREFERENCES HANDLERS
// ==========================================

function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

const AVAILABLE_CATEGORIES = [
    'Whiskey', 'Vodka', 'Tequila', 'Rum', 'Gin',
    'Brandy', 'Wine', 'Beer', 'Liqueur', 'RTD/Cocktails', 'Other'
];

// Sync user's category preferences to Loops as tags
async function syncToLoops(email, categories, isPro, receiveFreeReport, env) {
    const loopsApiKey = env.LOOPS_API_KEY;
    
    if (!loopsApiKey) {
        console.log('LOOPS_API_KEY not configured, skipping sync');
        return { success: false, error: 'Loops not configured' };
    }
    
    try {
        // Build the contact update payload
        // Loops uses custom fields - we'll use boolean fields for each category
        const contactData = {
            email: email.toLowerCase(),
            userGroup: isPro ? 'pro' : 'free',
            // Category subscriptions as boolean fields
            subscribedWhiskey: categories.includes('Whiskey'),
            subscribedVodka: categories.includes('Vodka'),
            subscribedTequila: categories.includes('Tequila'),
            subscribedRum: categories.includes('Rum'),
            subscribedGin: categories.includes('Gin'),
            subscribedBrandy: categories.includes('Brandy'),
            subscribedWine: categories.includes('Wine'),
            subscribedBeer: categories.includes('Beer'),
            subscribedLiqueur: categories.includes('Liqueur'),
            subscribedRTD: categories.includes('RTD'),
            // Free report preference
            subscribedFreeReport: receiveFreeReport,
            // Pro status
            isPro: isPro
        };
        
        const response = await fetch('https://app.loops.so/api/v1/contacts/update', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${loopsApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(contactData)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            console.error('Loops sync failed:', result);
            return { success: false, error: result.message || 'Loops sync failed' };
        }
        
        console.log(`Loops sync successful for ${email}:`, categories);
        return { success: true };
    } catch (e) {
        console.error('Loops sync error:', e.message);
        return { success: false, error: e.message };
    }
}

async function handleGetPreferences(url, env) {
    const token = url.searchParams.get('token');
    const email = url.searchParams.get('email');
    
    if (!token && !email) {
        return { success: false, error: 'Token or email required' };
    }
    
    let query, param;
    if (token) {
        query = 'SELECT * FROM user_preferences WHERE preferences_token = ?';
        param = token;
    } else {
        query = 'SELECT * FROM user_preferences WHERE email = ?';
        param = email.toLowerCase();
    }
    
    try {
        let user = await env.DB.prepare(query).bind(param).first();
        
        // If no user record and searching by email, check if they're Pro in Stripe
        if (!user && email) {
            const stripeSecretKey = env.STRIPE_SECRET_KEY;
            if (stripeSecretKey) {
                const searchResponse = await fetch(
                    `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email.toLowerCase())}'`,
                    { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                );
                const searchData = await searchResponse.json();
                
                if (searchData.data && searchData.data.length > 0) {
                    const customerId = searchData.data[0].id;
                    
                    const subsResponse = await fetch(
                        `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active`,
                        { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                    );
                    const subsData = await subsResponse.json();
                    
                    if (subsData.data && subsData.data.length > 0) {
                        // Determine tier from subscription price
                        const subscription = subsData.data[0];
                        const priceId = subscription.items?.data?.[0]?.price?.id;
                        let tier = 'category_pro'; // default
                        if (priceId === env.STRIPE_PREMIER_PRICE_ID) {
                            tier = 'premier';
                        }

                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, ?, ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, tier, newToken).run();

                        user = {
                            email: email.toLowerCase(),
                            is_pro: 1,
                            tier: tier,
                            tier_category: null,
                            preferences_token: newToken,
                            categories: '[]',
                            receive_free_report: 1
                        };
                        console.log(`Created missing user_preferences record for Pro user: ${email}, tier: ${tier}`);
                    }
                }
            }
        }
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        let categories = [];
        try {
            categories = JSON.parse(user.categories || '[]');
        } catch (e) {
            categories = [];
        }

        // Check if category can be changed (1-week cooldown)
        let canChangeCategory = true;
        let categoryChangeCooldownEnds = null;
        if (user.category_changed_at) {
            const changedAt = new Date(user.category_changed_at);
            const cooldownEnd = new Date(changedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
            if (new Date() < cooldownEnd) {
                canChangeCategory = false;
                categoryChangeCooldownEnds = cooldownEnd.toISOString();
            }
        }

        return {
            success: true,
            email: user.email,
            is_pro: user.is_pro === 1,
            tier: user.tier || null,
            tier_category: user.tier_category || null,
            can_change_category: canChangeCategory,
            category_change_cooldown_ends: categoryChangeCooldownEnds,
            categories: categories,
            receive_free_report: user.receive_free_report === 1,
            available_categories: AVAILABLE_CATEGORIES
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleSavePreferences(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const { token, categories, tier_category, receive_free_report, confirm_category_change } = body;

    if (!token) {
        return { success: false, error: 'Token required' };
    }

    try {
        // Get user with tier info
        const user = await env.DB.prepare(
            'SELECT email, is_pro, tier, tier_category, category_changed_at FROM user_preferences WHERE preferences_token = ?'
        ).bind(token).first();

        if (!user) {
            return { success: false, error: 'Invalid token' };
        }

        if (user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required to select categories' };
        }

        const receiveFreeReport = receive_free_report !== false;

        // Handle Category Pro tier (single category)
        if (user.tier === 'category_pro') {
            if (tier_category !== undefined) {
                // Validate category
                if (!AVAILABLE_CATEGORIES.includes(tier_category)) {
                    return { success: false, error: 'Invalid category' };
                }

                // Check if this is a category change (not initial selection)
                const isInitialSelection = !user.tier_category;
                const isCategoryChange = user.tier_category && user.tier_category !== tier_category;

                if (isCategoryChange) {
                    // Check cooldown (1 week)
                    if (user.category_changed_at) {
                        const changedAt = new Date(user.category_changed_at);
                        const cooldownEnd = new Date(changedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
                        if (new Date() < cooldownEnd) {
                            return {
                                success: false,
                                error: 'Category change on cooldown',
                                cooldown_ends: cooldownEnd.toISOString()
                            };
                        }
                    }

                    // Require confirmation for category changes
                    if (!confirm_category_change) {
                        return {
                            success: false,
                            error: 'Confirmation required for category change',
                            requires_confirmation: true,
                            current_category: user.tier_category,
                            new_category: tier_category
                        };
                    }
                }

                // Update tier_category
                const setCooldown = isCategoryChange ? ", category_changed_at = datetime('now')" : (isInitialSelection ? ", category_changed_at = NULL" : "");
                await env.DB.prepare(`
                    UPDATE user_preferences
                    SET tier_category = ?, receive_free_report = ?, updated_at = datetime('now')${setCooldown}
                    WHERE preferences_token = ?
                `).bind(tier_category, receiveFreeReport ? 1 : 0, token).run();

                // Sync to Loops
                await syncToLoops(user.email, [tier_category], true, receiveFreeReport, env);

                return {
                    success: true,
                    message: isInitialSelection ? 'Category selected' : 'Category updated',
                    tier_category: tier_category,
                    category_changed: isCategoryChange
                };
            }

            // Just updating receive_free_report
            await env.DB.prepare(`
                UPDATE user_preferences
                SET receive_free_report = ?, updated_at = datetime('now')
                WHERE preferences_token = ?
            `).bind(receiveFreeReport ? 1 : 0, token).run();

            return { success: true, message: 'Preferences saved' };
        }

        // Handle Premier tier (multiple categories) - existing logic
        if (!Array.isArray(categories)) {
            return { success: false, error: 'Categories must be an array' };
        }

        const validCategories = categories.filter(c => AVAILABLE_CATEGORIES.includes(c));

        await env.DB.prepare(`
            UPDATE user_preferences
            SET categories = ?, receive_free_report = ?, updated_at = datetime('now')
            WHERE preferences_token = ?
        `).bind(
            JSON.stringify(validCategories),
            receiveFreeReport ? 1 : 0,
            token
        ).run();

        // Sync to Loops
        const loopsResult = await syncToLoops(
            user.email,
            validCategories,
            true,
            receiveFreeReport,
            env
        );

        return {
            success: true,
            message: 'Preferences saved',
            categories: validCategories,
            loopsSynced: loopsResult.success
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleSendPreferencesLink(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }
    
    const { email } = body;
    
    if (!email) {
        return { success: false, error: 'Email required' };
    }
    
    try {
        let user = await env.DB.prepare(
            'SELECT preferences_token, is_pro FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();
        
        // If no user record exists, check if they're Pro in Stripe and create one
        if (!user) {
            const stripeSecretKey = env.STRIPE_SECRET_KEY;
            if (stripeSecretKey) {
                // Check Stripe for Pro status
                const searchResponse = await fetch(
                    `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email.toLowerCase())}'`,
                    { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                );
                const searchData = await searchResponse.json();
                
                if (searchData.data && searchData.data.length > 0) {
                    const customerId = searchData.data[0].id;
                    
                    // Check for active subscription
                    const subsResponse = await fetch(
                        `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active`,
                        { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                    );
                    const subsData = await subsResponse.json();
                    
                    if (subsData.data && subsData.data.length > 0) {
                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, newToken).run();
                        
                        user = { preferences_token: newToken, is_pro: 1 };
                        console.log(`Created missing user_preferences record for Pro user: ${email}`);
                    }
                }
            }
            
            if (!user) {
                return { success: false, error: 'No account found for this email' };
            }
        }
        
        if (user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }
        
        // Here you would integrate with Loops to send the email
        // For now, just return the token (in production, send via email only)
        const preferencesUrl = `https://bevalcintel.com/preferences.html?token=${user.preferences_token}`;
        
        // TODO: Send email via Loops API
        // await sendLoopsEmail(email, 'preferences_link', { url: preferencesUrl });
        
        return {
            success: true,
            message: 'Preferences link sent to your email',
            // Remove this in production - only for testing
            _debug_url: preferencesUrl
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleListUsersByCategory(url, env) {
    const category = url.searchParams.get('category');
    const apiKey = url.searchParams.get('api_key');
    
    // Simple API key check for your report scripts
    if (apiKey !== env.REPORT_API_KEY) {
        return { success: false, error: 'Unauthorized' };
    }
    
    try {
        let query;
        let users;
        
        if (category) {
            // Get users subscribed to a specific category
            users = await env.DB.prepare(`
                SELECT email, categories FROM user_preferences 
                WHERE is_pro = 1 AND categories LIKE ?
            `).bind(`%"${category}"%`).all();
        } else {
            // Get all pro users
            users = await env.DB.prepare(`
                SELECT email, categories FROM user_preferences WHERE is_pro = 1
            `).all();
        }
        
        return {
            success: true,
            category: category || 'all',
            users: (users.results || []).map(u => ({
                email: u.email,
                categories: JSON.parse(u.categories || '[]')
            }))
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Check if user exists (for login/signup flow)
async function handleCheckUserExists(url, env) {
    const email = url.searchParams.get('email');

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    try {
        // Check user_preferences table
        const user = await env.DB.prepare(
            'SELECT email FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (user) {
            return { success: true, exists: true };
        }

        // Also check Stripe for existing customers
        const stripeSecretKey = env.STRIPE_SECRET_KEY;
        if (stripeSecretKey) {
            const searchResponse = await fetch(
                `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email.toLowerCase())}'`,
                { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
            );
            const searchData = await searchResponse.json();

            if (searchData.data && searchData.data.length > 0) {
                return { success: true, exists: true };
            }
        }

        return { success: true, exists: false };
    } catch (e) {
        console.error('Check user error:', e);
        return { success: true, exists: false }; // Default to false on error
    }
}

// Send welcome email via Resend API
async function sendWelcomeEmail(toEmail, env) {
    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
        console.log('RESEND_API_KEY not configured, skipping welcome email');
        return { success: false, error: 'Email not configured' };
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="background: #0d9488; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">BevAlc Intelligence</h1>
        </div>
        <div style="padding: 32px;">
            <h2 style="color: #1e293b; font-size: 24px; margin: 0 0 16px 0;">Welcome to BevAlc Intelligence!</h2>
            <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                Thanks for signing up. You'll now receive our free weekly snapshot of TTB COLA filings, straight to your inbox every Saturday.
            </p>
            <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="color: #1e293b; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px 0;">What you'll get</p>
                <p style="color: #475569; font-size: 15px; margin: 8px 0;"><span style="color: #0d9488; margin-right: 8px;">&#10003;</span> Weekly PDF report with new TTB approvals</p>
                <p style="color: #475569; font-size: 15px; margin: 8px 0;"><span style="color: #0d9488; margin-right: 8px;">&#10003;</span> New brand and SKU launches across all categories</p>
                <p style="color: #475569; font-size: 15px; margin: 8px 0;"><span style="color: #0d9488; margin-right: 8px;">&#10003;</span> Market trends and filing activity insights</p>
            </div>
            <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                While you wait for your first report, explore our database of over 1 million COLA records:
            </p>
            <div style="text-align: center; margin-bottom: 32px;">
                <a href="https://bevalcintel.com/database" style="display: inline-block; background: #0d9488; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 16px;">Search the Database</a>
            </div>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <div style="background: #f0fdfa; border-radius: 8px; padding: 20px; text-align: center;">
                <p style="color: #0d9488; font-weight: 600; font-size: 14px; margin: 0 0 8px 0;">Need more?</p>
                <p style="color: #475569; font-size: 14px; margin: 0 0 12px 0;">Pro members get category-specific reports, watchlist alerts, and unlimited CSV exports.</p>
                <a href="https://bevalcintel.com/#pricing" style="color: #0d9488; font-size: 14px; font-weight: 500;">Learn about Pro &rarr;</a>
            </div>
        </div>
        <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; 2026 BevAlc Intelligence. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'BevAlc Intelligence <hello@bevalcintel.com>',
                to: toEmail,
                subject: 'Welcome to BevAlc Intelligence',
                html: html,
            }),
        });

        if (response.ok) {
            console.log(`Welcome email sent to ${toEmail}`);
            return { success: true };
        } else {
            const error = await response.text();
            console.error(`Failed to send welcome email: ${error}`);
            return { success: false, error };
        }
    } catch (e) {
        console.error('Welcome email error:', e.message);
        return { success: false, error: e.message };
    }
}

// Sign up a free user
async function handleSignupFree(request, env) {
    try {
        const body = await request.json();
        const email = body.email?.toLowerCase()?.trim();

        if (!email) {
            return { success: false, error: 'Email required' };
        }

        // Check if user already exists
        const existing = await env.DB.prepare(
            'SELECT email FROM user_preferences WHERE email = ?'
        ).bind(email).first();

        if (existing) {
            return { success: true, message: 'User already exists', existing: true };
        }

        // Create new free user record
        const newToken = generateToken();
        await env.DB.prepare(`
            INSERT INTO user_preferences (email, is_pro, preferences_token, categories, receive_free_report, updated_at)
            VALUES (?, 0, ?, '[]', 1, datetime('now'))
        `).bind(email, newToken).run();

        // Send welcome email (non-blocking, don't fail signup if email fails)
        sendWelcomeEmail(email, env).catch(e => console.error('Welcome email failed:', e));

        return { success: true, message: 'User created', existing: false, emailSent: true };
    } catch (e) {
        console.error('Signup free error:', e);
        return { success: false, error: e.message };
    }
}

// ==========================================
// WATCHLIST HANDLERS
// ==========================================

async function handleGetWatchlist(url, env) {
    const email = url.searchParams.get('email');
    const token = url.searchParams.get('token');

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    try {
        // Verify user is Pro and optionally verify token
        const user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }

        // If token is provided, verify it matches
        if (token && user.preferences_token && token !== user.preferences_token) {
            console.warn(`Invalid token attempt for watchlist GET: ${email}`);
            return { success: false, error: 'Invalid token' };
        }

        // Log when token is not provided (for monitoring)
        if (!token) {
            console.warn(`Watchlist GET without token for: ${email}`);
        }

        // Get all watchlist items for this user
        const result = await env.DB.prepare(`
            SELECT type, value, created_at FROM watchlist
            WHERE email = ?
            ORDER BY created_at DESC
        `).bind(email.toLowerCase()).all();

        // Group by type
        const watchlist = {
            brands: [],
            companies: []
        };

        for (const item of (result.results || [])) {
            if (item.type === 'brand') {
                watchlist.brands.push({ value: item.value, created_at: item.created_at });
            } else if (item.type === 'company') {
                watchlist.companies.push({ value: item.value, created_at: item.created_at });
            }
        }

        return {
            success: true,
            watchlist
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleCheckWatchlist(url, env) {
    const email = url.searchParams.get('email');
    const type = url.searchParams.get('type');
    const value = url.searchParams.get('value');

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    try {
        const result = await env.DB.prepare(`
            SELECT 1 FROM watchlist WHERE email = ? AND type = ? AND value = ?
        `).bind(email.toLowerCase(), type, value).first();

        return {
            success: true,
            isWatching: !!result
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleWatchlistCounts(url, env) {
    const brand = url.searchParams.get('brand');
    const company = url.searchParams.get('company');
    const keyword = url.searchParams.get('keyword');
    const subcategory = url.searchParams.get('subcategory');

    const counts = {};

    try {
        if (brand) {
            const result = await env.DB.prepare(
                'SELECT COUNT(*) as cnt FROM colas WHERE brand_name = ?'
            ).bind(brand).first();
            counts.brand = result?.cnt || 0;
        }

        if (company) {
            const result = await env.DB.prepare(
                'SELECT COUNT(*) as cnt FROM colas WHERE company_name = ?'
            ).bind(company).first();
            counts.company = result?.cnt || 0;
        }

        if (keyword && keyword.length >= 3) {
            const result = await env.DB.prepare(
                'SELECT COUNT(*) as cnt FROM colas WHERE fanciful_name LIKE ?'
            ).bind(`%${keyword}%`).first();
            counts.keyword = result?.cnt || 0;
        }

        if (subcategory) {
            const result = await env.DB.prepare(
                'SELECT COUNT(*) as cnt FROM colas WHERE class_type_code = ?'
            ).bind(subcategory).first();
            counts.subcategory = result?.cnt || 0;
        }

        return { success: true, counts };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleAddToWatchlist(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const { email, type, value, token } = body;

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    // Only allow brand and company types for now
    if (!['brand', 'company'].includes(type)) {
        return { success: false, error: 'Invalid type. Must be brand or company.' };
    }

    try {
        // Verify user is Pro and optionally verify token
        const user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }

        // If token is provided, verify it matches
        if (token && user.preferences_token && token !== user.preferences_token) {
            console.warn(`Invalid token attempt for watchlist ADD: ${email}`);
            return { success: false, error: 'Invalid token' };
        }

        // Log when token is not provided (for monitoring)
        if (!token) {
            console.warn(`Watchlist ADD without token for: ${email}`);
        }

        // Add to watchlist (INSERT OR IGNORE handles duplicates)
        await env.DB.prepare(`
            INSERT OR IGNORE INTO watchlist (email, type, value, created_at)
            VALUES (?, ?, ?, datetime('now'))
        `).bind(email.toLowerCase(), type, value).run();

        // Sync to Loops for email alerts
        await syncWatchlistToLoops(email.toLowerCase(), type, value, true, env);

        return { success: true, message: 'Added to watchlist' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleRemoveFromWatchlist(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const { email, type, value, token } = body;

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    try {
        // Verify user exists and optionally verify token
        const user = await env.DB.prepare(
            'SELECT preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        // If token is provided, verify it matches
        if (token && user && user.preferences_token && token !== user.preferences_token) {
            console.warn(`Invalid token attempt for watchlist REMOVE: ${email}`);
            return { success: false, error: 'Invalid token' };
        }

        // Log when token is not provided (for monitoring)
        if (!token) {
            console.warn(`Watchlist REMOVE without token for: ${email}`);
        }

        await env.DB.prepare(`
            DELETE FROM watchlist WHERE email = ? AND type = ? AND value = ?
        `).bind(email.toLowerCase(), type, value).run();

        // Sync to Loops
        await syncWatchlistToLoops(email.toLowerCase(), type, value, false, env);

        return { success: true, message: 'Removed from watchlist' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Sync watchlist changes to Loops for email alerts
async function syncWatchlistToLoops(email, type, value, isAdding, env) {
    const loopsApiKey = env.LOOPS_API_KEY;

    if (!loopsApiKey) {
        console.log('LOOPS_API_KEY not configured, skipping watchlist sync');
        return { success: false, error: 'Loops not configured' };
    }

    try {
        // Get current watchlist for this user
        const watchlistResult = await env.DB.prepare(`
            SELECT type, value FROM watchlist WHERE email = ?
        `).bind(email).all();

        const brands = [];
        const companies = [];

        for (const item of (watchlistResult.results || [])) {
            if (item.type === 'brand') brands.push(item.value);
            else if (item.type === 'company') companies.push(item.value);
        }

        // Update Loops contact with watchlist data
        const contactData = {
            email: email,
            watchlistBrands: brands.join(', '),
            watchlistCompanies: companies.join(', '),
            hasWatchlist: brands.length > 0 || companies.length > 0
        };

        const response = await fetch('https://app.loops.so/api/v1/contacts/update', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${loopsApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(contactData)
        });

        if (!response.ok) {
            const result = await response.json();
            console.error('Loops watchlist sync failed:', result);
            return { success: false, error: result.message || 'Loops sync failed' };
        }

        console.log(`Loops watchlist sync successful for ${email}`);
        return { success: true };
    } catch (e) {
        console.error('Loops watchlist sync error:', e.message);
        return { success: false, error: e.message };
    }
}

// ==========================================
// DATABASE HANDLERS
// ==========================================

// Comprehensive TTB code to category lookup - all 420+ codes explicitly mapped
const TTB_CODE_TO_CATEGORY = {
    // Whiskey (70 codes)
    "STRAIGHT BOURBON WHISKY": "Whiskey", "BOURBON WHISKY": "Whiskey", "BOURBON WHISKY BIB": "Whiskey",
    "STRAIGHT BOURBON WHISKY BLENDS": "Whiskey", "BLENDED BOURBON WHISKY": "Whiskey",
    "STRAIGHT RYE WHISKY": "Whiskey", "RYE WHISKY": "Whiskey", "RYE WHISKY BIB": "Whiskey",
    "STRAIGHT RYE WHISKY BLENDS": "Whiskey", "BLENDED RYE WHISKY": "Whiskey",
    "AMERICAN SINGLE MALT WHISKEY": "Whiskey", "AMERICAN SINGLE MALT WHISKEY - BIB": "Whiskey",
    "STRAIGHT AMERICAN SINGLE MALT": "Whiskey", "SCOTCH WHISKY": "Whiskey", "SCOTCH WHISKY FB": "Whiskey",
    "SCOTCH WHISKY USB": "Whiskey", "SINGLE MALT SCOTCH WHISKY": "Whiskey", "UNBLENDED SCOTCH WHISKY USB": "Whiskey",
    "DILUTED SCOTCH WHISKY FB": "Whiskey", "DILUTED SCOTCH WHISKY USB": "Whiskey",
    "IRISH WHISKY": "Whiskey", "IRISH WHISKY FB": "Whiskey", "IRISH WHISKY USB": "Whiskey",
    "DILUTED IRISH WHISKY FB": "Whiskey", "DILUTED IRISH WHISKY USB": "Whiskey",
    "CANADIAN WHISKY": "Whiskey", "CANADIAN WHISKY FB": "Whiskey", "CANADIAN WHISKY USB": "Whiskey",
    "DILUTED CANADIAN WHISKY FB": "Whiskey", "DILUTED CANADIAN WHISKY USB": "Whiskey",
    "STRAIGHT CORN WHISKY": "Whiskey", "CORN WHISKY": "Whiskey", "CORN WHISKY BIB": "Whiskey",
    "STRAIGHT CORN WHISKY BLENDS": "Whiskey", "BLENDED CORN WHISKY": "Whiskey",
    "STRAIGHT MALT WHISKY": "Whiskey", "MALT WHISKY": "Whiskey",
    "STRAIGHT WHISKY": "Whiskey", "STRAIGHT WHISKY BLENDS": "Whiskey", "WHISKY BLENDS": "Whiskey",
    "BLENDED WHISKY": "Whiskey", "BLENDED LIGHT WHISKY": "Whiskey", "LIGHT WHISKY": "Whiskey",
    "DILUTED BLENDED WHISKY": "Whiskey", "OTHER WHISKY BLENDS": "Whiskey", "OTHER STRAIGHT BLENDED WHISKY": "Whiskey",
    "WHISKY": "Whiskey", "WHISKY BOTTLED IN BOND (BIB)": "Whiskey", "OTHER WHISKY BIB": "Whiskey",
    "OTHER STRAIGHT WHISKY": "Whiskey", "OTHER WHISKY (FLAVORED)": "Whiskey",
    "WHISKY ORANGE FLAVORED": "Whiskey", "WHISKY GRAPE FLAVORED": "Whiskey", "WHISKY LIME FLAVORED": "Whiskey",
    "WHISKY LEMON FLAVORED": "Whiskey", "WHISKY CHERRY FLAVORED": "Whiskey", "WHISKY CHOCOLATE FLAVORED": "Whiskey",
    "WHISKY MINT FLAVORED": "Whiskey", "WHISKY PEPPERMINT FLAVORED": "Whiskey", "WHISKY OTHER FLAVORED": "Whiskey",
    "WHISKY PROPRIETARY": "Whiskey", "SPIRIT WHISKY": "Whiskey", "DILUTED WHISKY": "Whiskey",
    "OTHER IMPORTED WHISKY": "Whiskey", "OTHER IMPORTED WHISKY FB": "Whiskey", "OTHER IMPORTED WHISKY USB": "Whiskey",
    "DILUTED OTHER IMPORTED WHISKY FB": "Whiskey", "DILUTED OTHER IMPORTED WHISKY USB": "Whiskey",
    "WHISKY SPECIALTIES": "Whiskey", "LIQUEURS (WHISKY)": "Whiskey",
    // Vodka (26 codes)
    "VODKA": "Vodka", "VODKA 80-89 PROOF": "Vodka", "VODKA 90-99 PROOF": "Vodka", "VODKA 100 PROOF UP": "Vodka",
    "VODKA 80-89 PROOF FB": "Vodka", "VODKA 80-89 PROOF USB": "Vodka", "VODKA 90-99 PROOF FB": "Vodka",
    "VODKA 90-99 PROOF USB": "Vodka", "VODKA 100 PROOF UP FB": "Vodka", "VODKA 100 PROOF UP USB": "Vodka",
    "OTHER VODKA": "Vodka", "DILUTED VODKA": "Vodka", "DILUTED VODKA FB": "Vodka", "DILUTED VODKA USB": "Vodka",
    "VODKA - FLAVORED": "Vodka", "VODKA - ORANGE FLAVORED": "Vodka", "VODKA - GRAPE FLAVORED": "Vodka",
    "VODKA - LIME FLAVORED": "Vodka", "VODKA - LEMON FLAVORED": "Vodka", "VODKA - CHERRY FLAVORED": "Vodka",
    "VODKA - CHOCOLATE FLAVORED": "Vodka", "VODKA - MINT FLAVORED": "Vodka", "VODKA - PEPPERMINT FLAVORED": "Vodka",
    "VODKA - OTHER FLAVORED": "Vodka", "VODKA SPECIALTIES": "Vodka", "LIQUEURS (VODKA)": "Vodka",
    // Tequila (12 codes)
    "TEQUILA FB": "Tequila", "TEQUILA USB": "Tequila", "DILUTED TEQUILA FB": "Tequila", "DILUTED TEQUILA USB": "Tequila",
    "MEZCAL": "Tequila", "MEZCAL FB": "Tequila", "MEZCAL US": "Tequila", "DILUTED MEZCAL": "Tequila",
    "FLAVORED MEZCAL": "Tequila", "AGAVE SPIRITS": "Tequila", "FLAVORED AGAVE SPIRIT": "Tequila", "FLAVORED TEQUILA": "Tequila",
    // Gin (30 codes)
    "LONDON DRY GIN": "Gin", "LONDON DRY DISTILLED GIN": "Gin", "LONDON DRY DISTILLED GIN FB": "Gin",
    "LONDON DRY DISTILLED GIN USB": "Gin", "LONDON DRY GIN FB": "Gin", "LONDON DRY GIN USB": "Gin",
    "DISTILLED GIN": "Gin", "OTHER DISTILLED GIN": "Gin", "OTHER DISTILLED GIN FB": "Gin", "OTHER DISTILLED GIN USB": "Gin",
    "GIN - FLAVORED": "Gin", "GIN - MINT FLAVORED": "Gin", "GIN - ORANGE FLAVORED": "Gin", "GIN - LEMON FLAVORED": "Gin",
    "GIN - CHERRY FLAVORED": "Gin", "GIN - APPLE FLAVORED": "Gin", "GIN - BLACKBERRY FLAVORED": "Gin",
    "GIN - PEACH FLAVORED": "Gin", "GIN - GRAPE FLAVORED": "Gin", "OTHER GIN - FLAVORED": "Gin",
    "GIN": "Gin", "OTHER GIN": "Gin", "OTHER GIN FB": "Gin", "OTHER GIN USB": "Gin",
    "DILUTED GIN": "Gin", "DILUTED GIN FB": "Gin", "DILUTED GIN USB": "Gin",
    "GIN SPECIALTIES": "Gin", "LIQUEURS (GIN)": "Gin", "SLOE GIN": "Gin",
    // Rum (60 codes)
    "U.S. RUM (WHITE)": "Rum", "UR.S. RUM (WHITE)": "Rum", "PUERTO RICAN RUM (WHITE)": "Rum",
    "VIRGIN ISLANDS RUM (WHITE)": "Rum", "HAWAIIAN RUM (WHITE)": "Rum", "FLORIDA RUM (WHITE)": "Rum",
    "OTHER RUM (WHITE)": "Rum", "OTHER WHITE RUM": "Rum", "CUBAN RUM WHITE FB": "Rum",
    "JAMAICAN RUM WHITE FB": "Rum", "JAMAICAN RUM WHITE USB": "Rum", "GUIANAN RUM WHITE FB": "Rum",
    "GUIANAN RUM WHITE USB": "Rum", "MARTINICAN RUM WHITE FB": "Rum", "MARTINICAN RUM WHITE USB": "Rum",
    "OTHER RUM WHITE FB": "Rum", "OTHER RUM WHITE USB": "Rum", "DILUTED RUM (WHITE)": "Rum",
    "DILUTED RUM WHITE FB": "Rum", "DILUTED RUM WHITE USB": "Rum", "U.S. RUM (GOLD)": "Rum",
    "PUERTO RICAN RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM": "Rum",
    "HAWAIIAN RUM (GOLD)": "Rum", "FLORIDA RUM (GOLD)": "Rum", "OTHER RUM (GOLD)": "Rum",
    "CUBAN RUM GOLD FB": "Rum", "JAMAICAN RUM GOLD FB": "Rum", "JAMICAN RUM GOLD USB": "Rum",
    "DUTCH GUIANAN RUM GOLD FB": "Rum", "DUTCH GUIANAN RUM GOLD USB": "Rum", "MARTINICAN RUM GOLD FB": "Rum",
    "MARTINICAN RUM GOLD USB": "Rum", "OTHER RUM GOLD FB": "Rum", "OTHER RUM GOLD USB": "Rum",
    "DILUTED RUM (GOLD)": "Rum", "DILUTED RUM GOLD FB": "Rum", "DILUTED RUM GOLD USB": "Rum",
    "RUM FLAVORED (BOLD)": "Rum", "FLAVORED RUM (BOLD)": "Rum", "RUM ORANGE GLAVORED": "Rum",
    "RUM ORANGE FLAVORED": "Rum", "RUM GRAPE FLAVORED": "Rum", "RUM LIME FLAVORED": "Rum",
    "RUM LEMON FLAVORED": "Rum", "RUM CHERRY FLAVORED": "Rum", "RUM CHOCOLATE FLAVORED": "Rum",
    "RUM MINT FLAVORED": "Rum", "RUM PEPPERMINT FLAVORED": "Rum", "RUM OTHER FLAVORED": "Rum",
    "DOMESTIC FLAVORED RUM": "Rum", "IMPORTED FLAVORED RUM": "Rum", "FOREIGN RUM": "Rum",
    "OTHER FOREIGN RUM": "Rum", "OTHER FORIEGN RUM": "Rum", "FRENCH GUIANAN RUM FB": "Rum",
    "RUM SPECIALTIES": "Rum", "LIQUEURS (RUM)": "Rum", "CACHACA": "Rum",
    // Brandy (70 codes)
    "COGNAC (BRANDY) FB": "Brandy", "COGNAC (BRANDY) USB": "Brandy", "ARMAGNAC (BRANDY) FB": "Brandy",
    "ARMAGNAC (BRANDY) USB": "Brandy", "BRANDY": "Brandy", "CALIFORNIA BRANDY": "Brandy",
    "CALIFORNIA GRAPE BRANDY": "Brandy", "CALIFORNIA DRIED BRANDY": "Brandy", "CALIFORNIA LEES BRANDY": "Brandy",
    "CALIFORNIA POMACE OR MARC BRANDY": "Brandy", "CALIFORNIA RESIDUE BRANDY": "Brandy",
    "CALIFORNIA NEUTRAL BRANDY": "Brandy", "OTHER CALIFORNIA BRANDY": "Brandy", "NEW YORK BRANDY": "Brandy",
    "NEW YORK GRAPE BRANDY": "Brandy", "NEW YORK DRIED BRANDY": "Brandy", "NEW YORK LEES BRANDY": "Brandy",
    "NEW YORK POMACE OR MARC BRANDY": "Brandy", "NEW YORK RESIDUE BRANDY": "Brandy",
    "NEW YORK NEUTRAL BRANDY": "Brandy", "OTHER NEW YORK BRANDY": "Brandy", "OTHER DOMESTIC GRAPE BRANDY": "Brandy",
    "DRIED BRANDY": "Brandy", "LEES BRANDY": "Brandy", "POMACE OR MARC BRANDY": "Brandy",
    "RESIDUE BRANDY": "Brandy", "NEUTRAL BRANDY": "Brandy", "IMMATURE BRANDY": "Brandy", "OTHER BRANDY": "Brandy",
    "FRUIT BRANDY": "Brandy", "APPLE BRANDY": "Brandy", "APPLE BRANDY (CALVADOS)": "Brandy",
    "CHERRY BRANDY": "Brandy", "PLUM BRANDY": "Brandy", "PLUM BRANDY (SLIVOVITZ)": "Brandy",
    "BLACKBERRY BRANDY": "Brandy", "BLENDED APPLE JACK BRANDY": "Brandy", "PEAR BRANDY": "Brandy",
    "APRICOT BRANDY": "Brandy", "OTHER FRUIT BRANDY": "Brandy", "FOREIGN FRUIT BRANDY": "Brandy",
    "OTHER GRAPE BRANDY (PISCO, GRAPPA) FB": "Brandy", "OTHER GRAPE BRANDY (GRAPPA) USB": "Brandy",
    "BRANDY - FLAVORED": "Brandy", "BRANDY - APRICOT FLAVORED": "Brandy", "BRANDY - BLACKBERRY FLAVORED": "Brandy",
    "BRANDY - PEACH FLAVORED": "Brandy", "BRANDY - CHERRY FLAVORED": "Brandy", "BRANDY - GINGER FLAVORED": "Brandy",
    "BRANDY - COFFEE FLAVORED": "Brandy", "BRANDY APPLE FLAVORED": "Brandy", "BRANDY APRICOT FLAVORED": "Brandy",
    "BRANDY BLACKBERRY FLAVORED": "Brandy", "BRANDY CHERRY FLAVORED": "Brandy", "BRANDY COFFEE FLAVORED": "Brandy",
    "BRANDY GINGER FLAVORED": "Brandy", "BRANDY PEACH FLAVORED": "Brandy", "OTHER BRANDY - FLAVORED": "Brandy",
    "OTHER FLAVORED BRANDY": "Brandy", "BLACKBERRY FLAVORED BRANDY": "Brandy", "CHERRY FLAVORED BRANDY": "Brandy",
    "APRICOT FLAVORED BRANDY": "Brandy", "PEACH FLAVORED BRANDY": "Brandy", "GINGER FLAVORED BRANDY": "Brandy",
    "FRENCH BRANDY": "Brandy", "OTHER FRENCH BRANDY FB": "Brandy", "OTHER FRENCH BRANDY USB": "Brandy",
    "ITALIAN GRAPE BRANDY FB": "Brandy", "ITALIAN GRAPE BRANDY USB": "Brandy", "SPANISH GRAPE BRANDY FB": "Brandy",
    "SPANISH GRAPE BRANDY USB": "Brandy", "PORTUGUESE GRAPE BRANDY FB": "Brandy", "PORTUGUESE GRAPE BRANDY USB": "Brandy",
    "GREEK GRAPE BRANDY FB": "Brandy", "GREEK GRAPE BRANDY USB": "Brandy", "GERMAN GRAPE BRANDY FB": "Brandy",
    "GERMAN GRAPE BRANDY USB": "Brandy", "AUSTRALIAN GRAPE BRANDY FB": "Brandy", "AUSTRALIAN GRAPE BRANDY USB": "Brandy",
    "SOUTH AFRICAN GRAPE BRANDY FB": "Brandy", "SOUTH AFRICAN GRAPE BRANDY USB": "Brandy",
    "OTHER FOREIGN BRANDY": "Brandy", "OTHER FOREIGN BRANDY (CONT.)": "Brandy",
    "DILUTED BRANDY FB": "Brandy", "DILUTED BRANDY USB": "Brandy", "LIQUEUR & BRANDY": "Brandy",
    // Wine (28 codes)
    "TABLE RED WINE": "Wine", "TABLE WHITE WINE": "Wine", "ROSE WINE": "Wine",
    "SPARKLING WINE/CHAMPAGNE": "Wine", "SPARKLING WINE/ CIDER": "Wine", "SPARKLING WINE/MEAD": "Wine",
    "CARBONATED WINE": "Wine", "CARBONATED WINE/CIDER": "Wine", "CARBONATED WINE/MEAD": "Wine",
    "DESSERT /PORT/SHERRY/(COOKING) WINE": "Wine", "DESSERT FLAVORED WINE": "Wine", "DESSERT FRUIT WINE": "Wine",
    "HONEY BASED DESSERT WINE": "Wine", "APPLE BASED DESSERT FLAVORED WINE": "Wine", "APPLE DESSERT WINE/CIDER": "Wine",
    "TABLE FLAVORED WINE": "Wine", "APPLE BASED FLAVORED WINE": "Wine", "HONEY BASED TABLE WINE": "Wine",
    "TABLE FRUIT WINE": "Wine", "APPLE TABLE WINE/CIDER": "Wine", "VERMOUTH/MIXED TYPES": "Wine",
    "SAKE": "Wine", "SAKE - IMPORTED": "Wine", "SAKE - DOMESTIC FLAVORED": "Wine", "SAKE - IMPORTED FLAVORED": "Wine",
    // Beer (14 codes)
    "BEER": "Beer", "IRC BEER": "Beer", "IRC BEER-IMPORTED": "Beer",
    "OTHER MALT BEVERAGES (BEER)": "Beer", "OTHER MALT BEVERAGES": "Beer", "ALE": "Beer", "STOUT": "Beer",
    "PORTER": "Beer", "MALT LIQUOR": "Beer", "MALT BEVERAGES": "Beer",
    "MALT BEVERAGES SPECIALITIES - FLAVORED": "Beer", "MALT BEVERAGES SPECIALITIES": "Beer",
    "CEREAL BEVERAGES - NEAR BEER (NON ALCOHOLIC)": "Beer",
    // Liqueur (35 codes)
    "CORDIALS (FRUIT & PEELS)": "Liqueur", "FRUIT FLAVORED LIQUEURS": "Liqueur", "CURACAO": "Liqueur",
    "TRIPLE SEC": "Liqueur", "OTHER FRUITS & PEELS LIQUEURS": "Liqueur", "OTHER FRUIT & PEELS LIQUEURS": "Liqueur",
    "FRUITS & PEELS SCHNAPPS LIQUEUR": "Liqueur", "CORDIALS (CREMES OR CREAMS)": "Liqueur",
    "CREME DE CACAO WHITE": "Liqueur", "CREME DE CACAO BROWN": "Liqueur", "CREME DE MENTHE WHITE": "Liqueur",
    "CREME DE MENTHE GREEN": "Liqueur", "CREME DE ALMOND (NOYAUX)": "Liqueur", "DAIRY CREAM LIQUEUR/CORDIAL": "Liqueur",
    "NON DAIRY CREME LIQUEUR/CORDIAL": "Liqueur", "OTHER LIQUEUR (CREME OR CREAMS)": "Liqueur",
    "OTHER LIQUEUR (CREMES OR CREAMS)": "Liqueur", "CORDIALS (HERBS & SEEDS)": "Liqueur",
    "ANISETTE, OUZO, OJEN": "Liqueur", "KUMMEL": "Liqueur", "ARACK/RAKI": "Liqueur", "SAMBUCA": "Liqueur",
    "OTHER (HERBS & SEEDS)": "Liqueur", "OTHER HERB & SEED CORDIALS/LIQUEURS": "Liqueur",
    "HERBS AND SEEDS SCHNAPPS LIQUEUR": "Liqueur", "HERBS & SEEDS SCHNAPPS LIQUEUR": "Liqueur",
    "COFFEE (CAFE) LIQUEUR": "Liqueur", "AMARETTO": "Liqueur", "PEPPERMINT SCHNAPPS": "Liqueur",
    "ROCK & RYE, RUM & BRANDY (ETC.)": "Liqueur", "SPECIALTIES & PROPRIETARIES": "Liqueur",
    "SPECIALITIES & PROPRIETARIES": "Liqueur", "OTHER SPECIALTIES & PROPRIETARIES": "Liqueur",
    "BITTERS - BEVERAGE": "Liqueur", "BITTERS - BEVERAGE*": "Liqueur",
    // RTD/Cocktails (45 codes)
    "WHISKY MANHATTAN (48 PROOF UP)": "RTD/Cocktails", "WHISKY MANHATTAN (UNDER 48 PROOF)": "RTD/Cocktails",
    "WHISKY MANHATTAN UNDER 48 PROOF": "RTD/Cocktails", "WHISKY OLD FASHIONED (48 PROOF UP)": "RTD/Cocktails",
    "WHISKY OLD FASHIONED (UNDER 48 PROOF)": "RTD/Cocktails", "WHISKY OLD FASHIONED UNDER 48 PROOF": "RTD/Cocktails",
    "WHISKY SOUR (48 PROOF UP )": "RTD/Cocktails", "WHISKY SOUR (UNDER 48 PROOF)": "RTD/Cocktails", "WHISKY SOUR UNDER 48 PROOF": "RTD/Cocktails",
    "VODKA MARTINI (48 PROOF UP)": "RTD/Cocktails", "VODKA MARTINI (UNDER 48 PROOF)": "RTD/Cocktails",
    "VODKA MARTINI  UNDER 48 PROOF": "RTD/Cocktails", "VODKA MARTINI 48 PROOF UP": "RTD/Cocktails",
    "SCREW DRIVER": "RTD/Cocktails", "BLOODY MARY": "RTD/Cocktails",
    "GIN MARTINI (48 PROOF UP)": "RTD/Cocktails", "GIN MARTINI (UNDER 48 PROOF)": "RTD/Cocktails",
    "GIN MARTINI 48 PROOF UP": "RTD/Cocktails", "GIN MARTINI UNDER 48 PROOF": "RTD/Cocktails",
    "GIN SOUR (UNDER 48 PROOF)": "RTD/Cocktails", "GIN SOUR UNDER 48 PROOF": "RTD/Cocktails", "COLLINS": "RTD/Cocktails",
    "DAIQUIRI (48 PROOF UP)": "RTD/Cocktails", "DAIQUIRI (UNDER 48 PROOF)": "RTD/Cocktails",
    "DAIQUIRI 48 PROOF UP": "RTD/Cocktails", "DAIQUIRI UNDER 48 PROOF": "RTD/Cocktails",
    "COLADA (48PROOF UP)": "RTD/Cocktails", "COLADA (48 PROOF UP )": "RTD/Cocktails",
    "COLADA (UNDER 48 PROOF)": "RTD/Cocktails", "COLADA (UNDER 48 PROOF )": "RTD/Cocktails",
    "MARGARITA (48 PROOF UP)": "RTD/Cocktails", "MARGARITA (UNDER 48 PROOF)": "RTD/Cocktails",
    "MARGARITA 48 PROOF UP": "RTD/Cocktails", "MARGARITA UNDER 48 PROOF": "RTD/Cocktails",
    "OTHER TEQUILA-BASED COCKTAILS (UNDER 48 PROOF)": "RTD/Cocktails",
    "BRANDY STINGER (48 PROOF UP)": "RTD/Cocktails", "BRANDY STINGER (UNDER 48 PROOF)": "RTD/Cocktails",
    "BRANDY STINGER UNDER 48 PROOF": "RTD/Cocktails", "BRANDY SIDE CAR (48 PROOF UP)": "RTD/Cocktails",
    "BRANDY SIDE CAR (UNDER 48 PROOF)": "RTD/Cocktails", "BRANDY SIDE CAR UNDER 48 PROOF": "RTD/Cocktails",
    "COCKTAILS 48 PROOF UP": "RTD/Cocktails", "COCKTAILS 48 PROOF UP (CONT)": "RTD/Cocktails",
    "COCKTAILS UNDER 48 PROOF": "RTD/Cocktails", "COCKTAILS UNDER 48 PROOF (CONT)": "RTD/Cocktails",
    "COCKTAILS UNDER 48 PR(CONT)": "RTD/Cocktails", "MIXED DRINKS-HI BALLS COCKTAILS": "RTD/Cocktails",
    "OTHER COCKTAILS (48 PROOF UP)": "RTD/Cocktails", "OTHER COCTAILS (48PROOF UP)": "RTD/Cocktails",
    "OTHER COCKTAILS (UNDER 48 PROOF)": "RTD/Cocktails", "OTHER MIXED DRINKS HI-BALLS COCKTAILS": "RTD/Cocktails", "EGG NOG": "RTD/Cocktails",
    // Other (10 codes)
    "NEUTRAL SPIRITS - GRAIN": "Other", "NEUTRAL SPIRITS - FRUIT": "Other", "NEUTRAL SPIRITS - CANE": "Other",
    "NEUTRAL SPIRITS - VEGETABLE": "Other", "NEUTRAL SPIRITS - PETROLEUM": "Other",
    "GRAIN SPIRITS": "Other", "OTHER SPIRITS": "Other",
    "NON ALCOHOLIC MIXES": "Other", "NON ALCOHOL MIXES": "Other", "ADMINISTRATIVE WITHDRAWAL": "Other",
};

// Fallback patterns for unknown codes (used only when exact match fails)
const FALLBACK_PATTERNS = [
    // Beer first to catch MALT BEVERAGE before MALT WHISKY
    ['MALT BEVER', 'Beer'], ['MALT LIQ', 'Beer'], ['BEER', 'Beer'], ['ALE', 'Beer'],
    ['STOUT', 'Beer'], ['LAGER', 'Beer'], ['PORTER', 'Beer'],
    // Whiskey - WHISK catches both WHISKY and WHISKEY
    ['WHISK', 'Whiskey'], ['BOURBON', 'Whiskey'], ['SCOTCH', 'Whiskey'], ['TENNESSEE', 'Whiskey'],
    ['VODKA', 'Vodka'],
    ['TEQUILA', 'Tequila'], ['MEZCAL', 'Tequila'], ['AGAVE', 'Tequila'],
    ['GIN', 'Gin'],
    ['RUM', 'Rum'], ['CACHACA', 'Rum'],
    ['BRANDY', 'Brandy'], ['COGNAC', 'Brandy'], ['ARMAGNAC', 'Brandy'], ['GRAPPA', 'Brandy'], ['PISCO', 'Brandy'],
    ['WINE', 'Wine'], ['CHAMPAGNE', 'Wine'], ['SHERRY', 'Wine'], ['VERMOUTH', 'Wine'], ['SAKE', 'Wine'],
    ['LIQUEUR', 'Liqueur'], ['CORDIAL', 'Liqueur'], ['SCHNAPPS', 'Liqueur'], ['AMARETTO', 'Liqueur'],
    ['COCKTAIL', 'RTD/Cocktails'], ['MARGARITA', 'RTD/Cocktails'], ['DAIQUIRI', 'RTD/Cocktails'], ['MARTINI', 'RTD/Cocktails'], ['COLADA', 'RTD/Cocktails'],
];

function getCategory(classTypeCode) {
    if (!classTypeCode) return 'Other';

    // Try exact lookup first
    if (TTB_CODE_TO_CATEGORY[classTypeCode]) {
        return TTB_CODE_TO_CATEGORY[classTypeCode];
    }

    const upper = classTypeCode.toUpperCase();

    // Try uppercase exact lookup
    if (TTB_CODE_TO_CATEGORY[upper]) {
        return TTB_CODE_TO_CATEGORY[upper];
    }

    // Fallback: pattern matching for unknown codes
    for (const [pattern, category] of FALLBACK_PATTERNS) {
        if (upper.includes(pattern)) {
            return category;
        }
    }

    return 'Other';
}

// Get all TTB codes that belong to a specific category
// Used for exact-match category filtering in search/export
function getCodesForCategory(category) {
    const codes = [];
    for (const [code, cat] of Object.entries(TTB_CODE_TO_CATEGORY)) {
        if (cat === category) {
            codes.push(code);
        }
    }
    return codes;
}

async function handleSearch(url, env) {
    const params = url.searchParams;
    const page = Math.max(1, parseInt(params.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || 50));

    const sortColumn = params.get('sort') || 'approval_date';
    const sortOrder = params.get('order') === 'asc' ? 'ASC' : 'DESC';

    const validSortColumns = ['ttb_id', 'brand_name', 'class_type_code', 'origin_code', 'approval_date', 'status'];
    const safeSortColumn = validSortColumns.includes(sortColumn) ? sortColumn : 'approval_date';

    const MAX_PAGES = 500;
    if (page > MAX_PAGES) {
        return {
            success: false,
            error: `Page limit exceeded. Maximum ${MAX_PAGES} pages allowed.`
        };
    }

    const offset = (page - 1) * limit;

    const query = params.get('q')?.trim();
    const origin = params.get('origin');
    const classType = params.get('class_type');
    const category = params.get('category');
    const subcategory = params.get('subcategory');  // Subcategory name (e.g., "Bourbon", "Irish Whiskey")
    const status = params.get('status');
    const dateFrom = params.get('date_from');
    const dateTo = params.get('date_to');
    const signal = params.get('signal');  // NEW_BRAND, NEW_SKU, REFILE, or comma-separated

    let whereClause = '1=1';
    const queryParams = [];

    if (query) {
        whereClause += ` AND (
            brand_name LIKE ? OR
            fanciful_name LIKE ? OR
            ttb_id LIKE ? OR
            company_name LIKE ?
        )`;
        const searchTerm = `%${query}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (origin) {
        whereClause += ' AND origin_code = ?';
        queryParams.push(origin);
    }

    if (classType) {
        whereClause += ' AND class_type_code = ?';
        queryParams.push(classType);
    }

    // Subcategory filter: uses TTB_SUBCATEGORIES mapping to get array of TTB codes
    if (subcategory) {
        const subcategoryCodes = getSubcategoryCodes(subcategory);
        if (subcategoryCodes.length > 0) {
            // Specific subcategory with mapped codes - use IN clause
            const placeholders = subcategoryCodes.map(() => '?').join(',');
            whereClause += ` AND class_type_code IN (${placeholders})`;
            subcategoryCodes.forEach(code => queryParams.push(code));
        } else if (subcategory.startsWith('Other ')) {
            // "Other X" subcategory - exclude all mapped codes for parent category
            const parentCategory = subcategory.replace('Other ', '');
            const allMappedCodes = getAllMappedCodesForCategory(parentCategory);
            if (allMappedCodes.length > 0) {
                const placeholders = allMappedCodes.map(() => '?').join(',');
                whereClause += ` AND class_type_code NOT IN (${placeholders})`;
                allMappedCodes.forEach(code => queryParams.push(code));
            }
        }
    }

    if (category && category !== 'Other') {
        // Use exact code matching from TTB_CODE_TO_CATEGORY lookup
        const categoryCodes = getCodesForCategory(category);
        if (categoryCodes.length > 0) {
            const placeholders = categoryCodes.map(() => '?').join(',');
            whereClause += ` AND class_type_code IN (${placeholders})`;
            categoryCodes.forEach(code => queryParams.push(code));
        }
    }

    if (status) {
        whereClause += ' AND status = ?';
        queryParams.push(status);
    }

    if (dateFrom) {
        const parts = dateFrom.split('-');
        if (parts.length === 3) {
            const [year, month] = parts;
            whereClause += ' AND (year > ? OR (year = ? AND month >= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month));
        }
    }

    if (dateTo) {
        const parts = dateTo.split('-');
        if (parts.length === 3) {
            const [year, month] = parts;
            whereClause += ' AND (year < ? OR (year = ? AND month <= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month));
        }
    }

    // Signal filter: NEW_BRAND, NEW_SKU, REFILE, or comma-separated (e.g., "NEW_BRAND,NEW_SKU")
    if (signal) {
        const validSignals = ['NEW_BRAND', 'NEW_SKU', 'NEW_COMPANY', 'REFILE'];
        const signals = signal.split(',').map(s => s.trim().toUpperCase()).filter(s => validSignals.includes(s));
        if (signals.length > 0) {
            const placeholders = signals.map(() => '?').join(',');
            whereClause += ` AND signal IN (${placeholders})`;
            signals.forEach(s => queryParams.push(s));
        }
    }

    const countQuery = `SELECT COUNT(*) as total FROM colas WHERE ${whereClause}`;
    const countResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
    const total = countResult?.total || 0;

    let orderByClause;
    if (safeSortColumn === 'approval_date') {
        // Use year/month/day for proper chronological sorting (approval_date is MM/DD/YYYY string)
        orderByClause = `ORDER BY COALESCE(year, 9999) ${sortOrder}, COALESCE(month, 99) ${sortOrder}, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ${sortOrder}, ttb_id ${sortOrder}`;
    } else {
        orderByClause = `ORDER BY ${safeSortColumn} ${sortOrder}`;
    }

    const dataQuery = `
        SELECT
            ttb_id, status, brand_name, fanciful_name,
            class_type_code, origin_code, approval_date, signal, refile_count
        FROM colas
        WHERE ${whereClause}
        ${orderByClause}
        LIMIT ? OFFSET ?
    `;
    const dataParams = [...queryParams, limit, offset];
    const dataResult = await env.DB.prepare(dataQuery).bind(...dataParams).all();

    return {
        success: true,
        data: dataResult.results || [],
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function handleExport(url, env) {
    const params = url.searchParams;

    // Verify Pro status
    const email = params.get('email');
    const token = params.get('token');
    if (!email) {
        return { success: false, error: 'Email required for export' };
    }

    // Check if user is Pro and get tier info
    let userTier = null;
    let userTierCategory = null;

    try {
        let user = await env.DB.prepare(
            'SELECT is_pro, tier, tier_category, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        // If token is provided, verify it matches
        if (token && user && user.preferences_token && token !== user.preferences_token) {
            console.warn(`Invalid token attempt for export: ${email}`);
            return { success: false, error: 'Invalid token' };
        }

        // Log when token is not provided (for monitoring)
        if (!token) {
            console.warn(`Export request without token for: ${email}`);
        }

        // If no user record exists, check if they're Pro in Stripe and create one
        if (!user) {
            const stripeSecretKey = env.STRIPE_SECRET_KEY;
            if (stripeSecretKey) {
                const searchResponse = await fetch(
                    `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email.toLowerCase())}'`,
                    { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                );
                const searchData = await searchResponse.json();

                if (searchData.data && searchData.data.length > 0) {
                    const customerId = searchData.data[0].id;

                    const subsResponse = await fetch(
                        `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=1`,
                        { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
                    );
                    const subsData = await subsResponse.json();

                    if (subsData.data && subsData.data.length > 0) {
                        // Determine tier from subscription price
                        const subscription = subsData.data[0];
                        const priceId = subscription.items?.data?.[0]?.price?.id;
                        let tier = 'category_pro';
                        if (priceId === env.STRIPE_PREMIER_PRICE_ID) {
                            tier = 'premier';
                        }

                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, ?, ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, tier, newToken).run();

                        user = { is_pro: 1, tier: tier, tier_category: null };
                        console.log(`Created missing user_preferences record for Pro user: ${email}, tier: ${tier}`);
                    }
                }
            }
        }

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required for export' };
        }

        userTier = user.tier;
        userTierCategory = user.tier_category;

        // Category Pro users must have selected a category to export
        if (userTier === 'category_pro' && !userTierCategory) {
            return { success: false, error: 'Please select your category in account settings before exporting' };
        }
    } catch (e) {
        console.error('Error checking Pro status:', e);
        return { success: false, error: 'Could not verify Pro status' };
    }

    // Export limit: max 1000 rows
    const EXPORT_LIMIT = 1000;

    const sortColumn = params.get('sort') || 'approval_date';
    const sortOrder = params.get('order') === 'asc' ? 'ASC' : 'DESC';

    const validSortColumns = ['ttb_id', 'brand_name', 'class_type_code', 'origin_code', 'approval_date', 'status'];
    const safeSortColumn = validSortColumns.includes(sortColumn) ? sortColumn : 'approval_date';

    const query = params.get('q')?.trim();
    const origin = params.get('origin');
    const classType = params.get('class_type');
    let category = params.get('category');
    const subcategory = params.get('subcategory');
    const status = params.get('status');
    const dateFrom = params.get('date_from');
    const dateTo = params.get('date_to');

    // Category Pro users can only export within their category
    if (userTier === 'category_pro' && userTierCategory) {
        category = userTierCategory; // Force category filter
    }

    let whereClause = '1=1';
    const queryParams = [];

    if (query) {
        whereClause += ` AND (
            brand_name LIKE ? OR
            fanciful_name LIKE ? OR
            ttb_id LIKE ? OR
            company_name LIKE ?
        )`;
        const searchTerm = `%${query}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (origin) {
        whereClause += ' AND origin_code = ?';
        queryParams.push(origin);
    }

    if (classType) {
        whereClause += ' AND class_type_code = ?';
        queryParams.push(classType);
    }

    // Subcategory filter: uses TTB_SUBCATEGORIES mapping to get array of TTB codes
    if (subcategory) {
        const subcategoryCodes = getSubcategoryCodes(subcategory);
        if (subcategoryCodes.length > 0) {
            // Specific subcategory with mapped codes - use IN clause
            const placeholders = subcategoryCodes.map(() => '?').join(',');
            whereClause += ` AND class_type_code IN (${placeholders})`;
            subcategoryCodes.forEach(code => queryParams.push(code));
        } else if (subcategory.startsWith('Other ')) {
            // "Other X" subcategory - exclude all mapped codes for parent category
            const parentCategory = subcategory.replace('Other ', '');
            const allMappedCodes = getAllMappedCodesForCategory(parentCategory);
            if (allMappedCodes.length > 0) {
                const placeholders = allMappedCodes.map(() => '?').join(',');
                whereClause += ` AND class_type_code NOT IN (${placeholders})`;
                allMappedCodes.forEach(code => queryParams.push(code));
            }
        }
    }

    if (category && category !== 'Other') {
        // Use exact code matching from TTB_CODE_TO_CATEGORY lookup
        const categoryCodes = getCodesForCategory(category);
        if (categoryCodes.length > 0) {
            const placeholders = categoryCodes.map(() => '?').join(',');
            whereClause += ` AND class_type_code IN (${placeholders})`;
            categoryCodes.forEach(code => queryParams.push(code));
        }
    }

    if (status) {
        whereClause += ' AND status = ?';
        queryParams.push(status);
    }

    if (dateFrom) {
        const parts = dateFrom.split('-');
        if (parts.length === 3) {
            const [year, month] = parts;
            whereClause += ' AND (year > ? OR (year = ? AND month >= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month));
        }
    }

    if (dateTo) {
        const parts = dateTo.split('-');
        if (parts.length === 3) {
            const [year, month] = parts;
            whereClause += ' AND (year < ? OR (year = ? AND month <= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month));
        }
    }

    // Get total count for info
    const countQuery = `SELECT COUNT(*) as total FROM colas WHERE ${whereClause}`;
    const countResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
    const total = countResult?.total || 0;

    let orderByClause;
    if (safeSortColumn === 'approval_date') {
        // Use year/month/day for proper chronological sorting (approval_date is MM/DD/YYYY string)
        orderByClause = `ORDER BY COALESCE(year, 9999) ${sortOrder}, COALESCE(month, 99) ${sortOrder}, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ${sortOrder}, ttb_id ${sortOrder}`;
    } else {
        orderByClause = `ORDER BY ${safeSortColumn} ${sortOrder}`;
    }

    // Export query - all fields from detail card
    const dataQuery = `
        SELECT
            ttb_id, brand_name, fanciful_name, signal, status, approval_date,
            class_type_code, origin_code, type_of_application,
            vendor_code, serial_number, total_bottle_capacity,
            for_sale_in, qualifications, plant_registry,
            company_name, street, state, contact_person, phone_number,
            grape_varietal, wine_vintage, appellation, alcohol_content, ph_level
        FROM colas
        WHERE ${whereClause}
        ${orderByClause}
        LIMIT ?
    `;
    const dataParams = [...queryParams, EXPORT_LIMIT];
    const dataResult = await env.DB.prepare(dataQuery).bind(...dataParams).all();

    return {
        success: true,
        data: dataResult.results || [],
        total: total,
        exported: (dataResult.results || []).length,
        limit: EXPORT_LIMIT
    };
}

async function handleFilters(env) {
    const [origins, classTypes, statuses] = await Promise.all([
        env.DB.prepare('SELECT DISTINCT origin_code FROM colas WHERE origin_code IS NOT NULL AND origin_code != "" ORDER BY origin_code').all(),
        env.DB.prepare('SELECT DISTINCT class_type_code FROM colas WHERE class_type_code IS NOT NULL AND class_type_code != "" ORDER BY class_type_code').all(),
        env.DB.prepare('SELECT DISTINCT status FROM colas WHERE status IS NOT NULL AND status != "" ORDER BY status').all()
    ]);

    return {
        success: true,
        filters: {
            origins: (origins.results || []).map(r => r.origin_code),
            class_types: (classTypes.results || []).map(r => r.class_type_code),
            statuses: (statuses.results || []).map(r => r.status)
        }
    };
}

async function handleCategories(env) {
    return {
        success: true,
        categories: ['Whiskey', 'Vodka', 'Tequila', 'Rum', 'Gin', 'Brandy', 'Wine', 'Beer', 'Liqueur', 'Cocktails', 'Other Spirits', 'Other']
    };
}

async function handleRecord(url, env) {
    const ttbId = url.searchParams.get('id');
    if (!ttbId) {
        return { success: false, error: 'Missing TTB ID' };
    }

    const result = await env.DB.prepare(
        'SELECT * FROM colas WHERE ttb_id = ?'
    ).bind(ttbId).first();

    if (!result) {
        return { success: false, error: 'Record not found' };
    }

    // Look up website: brand first, company as fallback
    let websiteUrl = null;

    // Try brand-specific website first
    if (result.brand_name) {
        const brandWebsite = await env.DB.prepare(
            'SELECT website_url FROM brand_websites WHERE brand_name = ?'
        ).bind(result.brand_name).first();
        if (brandWebsite?.website_url) {
            websiteUrl = brandWebsite.website_url;
        }
    }

    // Fall back to company website
    if (!websiteUrl && result.company_name) {
        const companyWebsite = await env.DB.prepare(`
            SELECT cw.website_url
            FROM company_websites cw
            JOIN company_aliases ca ON ca.company_id = cw.company_id
            WHERE ca.raw_name = ?
        `).bind(result.company_name).first();
        if (companyWebsite?.website_url) {
            websiteUrl = companyWebsite.website_url;
        }
    }

    return {
        success: true,
        data: {
            ...result,
            website_url: websiteUrl
        }
    };
}

async function handleStats(env) {
    const stats = await env.DB.prepare(`
        SELECT
            COUNT(*) as total,
            COUNT(DISTINCT origin_code) as origins,
            COUNT(DISTINCT class_type_code) as class_types,
            MIN(approval_date) as oldest,
            MAX(approval_date) as newest
        FROM colas
    `).first();

    return {
        success: true,
        stats
    };
}

// ==========================================
// SEO PAGE HANDLERS
// ==========================================

const BASE_URL = 'https://bevalcintel.com';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function makeSlug(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/&/g, 'and')
        .replace(/'/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .replace(/-+/g, '-');
}

function formatNumber(num) {
    return new Intl.NumberFormat().format(num || 0);
}

function getPageLayout(title, description, content, jsonLd = null, canonical = null) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | BevAlc Intelligence</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonical || BASE_URL}">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
    <style>
        /* Navigation styles */
        .nav { background: white; border-bottom: 1px solid var(--color-border); position: fixed; top: 0; left: 0; right: 0; z-index: 100; }
        .nav-container { max-width: 1200px; margin: 0 auto; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
        .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--color-text); text-decoration: none; }
        .nav-links { display: flex; gap: 24px; }
        .nav-links a { color: var(--color-text-secondary); text-decoration: none; font-size: 0.9rem; }
        .nav-links a:hover { color: var(--color-primary); }

        .seo-page { padding-top: 80px; max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 48px; }

        /* Improved header with hero styling */
        .seo-header {
            background: linear-gradient(135deg, #f0fdfa 0%, #f8fafc 50%, #f0f9ff 100%);
            margin: 0 -24px 40px -24px;
            padding: 48px 24px 40px;
            border-bottom: 1px solid #e2e8f0;
        }
        .seo-header-inner { max-width: 1200px; margin: 0 auto; }
        .seo-header h1 {
            font-family: var(--font-display);
            font-size: 2.25rem;
            margin-bottom: 16px;
            color: #0f172a;
            line-height: 1.2;
        }
        .seo-header .meta {
            color: #64748b;
            font-size: 1rem;
            display: flex;
            flex-wrap: wrap;
            gap: 8px 16px;
            align-items: center;
        }
        .seo-header .meta a { color: #0d9488; font-weight: 500; }
        .seo-header .meta a:hover { text-decoration: underline; }
        .category-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: white;
            border: 1px solid #e2e8f0;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 500;
            color: #334155;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .category-badge::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #0d9488; }
        .meta-stats { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .meta-line { margin: 0; color: #64748b; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
        .meta-line strong { color: #1e293b; font-weight: 600; }
        .meta-icon { font-size: 1rem; opacity: 0.7; }

        /* Improved cards */
        .seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 32px; }
        .seo-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            transition: box-shadow 0.2s, border-color 0.2s;
        }
        .seo-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-color: #cbd5e1; }
        .seo-card h2 {
            font-size: 0.75rem;
            color: #64748b;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 600;
        }
        .stat-value { font-size: 2.25rem; font-weight: 700; color: #0f172a; line-height: 1.2; }
        .stat-label { font-size: 0.875rem; color: #64748b; margin-top: 4px; }
        .stat-label a { color: #0d9488; font-weight: 500; }

        /* Brand chips */
        .brand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
        .brand-chip {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.15s ease;
            text-decoration: none;
        }
        .brand-chip:hover { border-color: #0d9488; background: #f0fdfa; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(13,148,136,0.1); }
        .brand-chip a { color: #1e293b; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; text-decoration: none; }
        .brand-chip .count { color: #94a3b8; font-size: 0.8rem; flex-shrink: 0; margin-left: 8px; font-weight: 500; }

        /* Tables */
        .filings-table { width: 100%; border-collapse: separate; border-spacing: 0; }
        .filings-table th {
            background: #f8fafc;
            font-weight: 600;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            padding: 14px 16px;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
        }
        .filings-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
            font-size: 0.9rem;
        }
        .filings-table tbody tr { transition: background 0.15s; }
        .filings-table tbody tr:hover { background: #f8fafc; }
        .filings-table tbody tr:nth-child(even) { background: #fafbfc; }
        .filings-table tbody tr:nth-child(even):hover { background: #f1f5f9; }
        .filings-table a { color: #0d9488; font-weight: 500; text-decoration: none; }
        .filings-table a:hover { text-decoration: underline; }

        /* Signal badges */
        .signal-badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em; }
        .signal-new-company { background: #f3e8ff; color: #7c3aed; }
        .signal-new-brand { background: #dcfce7; color: #15803d; }
        .signal-new-sku { background: #dbeafe; color: #1d4ed8; }
        .signal-refile { background: #f1f5f9; color: #64748b; }

        /* Bar charts */
        .bar-chart { margin: 8px 0; }
        .bar-row { display: flex; align-items: center; margin-bottom: 10px; }
        .bar-label { width: 60px; font-size: 0.875rem; color: #64748b; font-weight: 500; }
        .bar-container { flex: 1; height: 28px; background: #f1f5f9; border-radius: 6px; overflow: hidden; margin: 0 12px; }
        .bar-fill { height: 100%; background: linear-gradient(90deg, #0d9488, #14b8a6); border-radius: 6px; min-width: 4px; transition: width 0.4s ease; }
        .bar-value { width: 50px; text-align: right; font-size: 0.875rem; font-weight: 600; color: #1e293b; }

        /* Related links */
        .related-links { margin-top: 48px; padding-top: 32px; border-top: 1px solid #e2e8f0; }
        .related-links h3 { margin-bottom: 16px; font-size: 1.1rem; color: #1e293b; }
        .related-links a {
            display: inline-block;
            margin-right: 12px;
            margin-bottom: 10px;
            color: #0d9488;
            background: #f0fdfa;
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            transition: background 0.15s;
        }
        .related-links a:hover { background: #ccfbf1; text-decoration: none; }

        /* Breadcrumb */
        .breadcrumb { margin-bottom: 0; font-size: 0.8rem; color: #94a3b8; }
        .breadcrumb a { color: #64748b; text-decoration: none; }
        .breadcrumb a:hover { color: #0d9488; }

        /* Pro blur styles */
        .seo-blur { filter: blur(8px) !important; user-select: none !important; pointer-events: none !important; }
        .pro-locked { position: relative; }
        .pro-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,255,255,0.95); padding: 24px 32px; border-radius: 12px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 10; }
        .pro-overlay h3 { margin: 0 0 8px 0; font-size: 1.1rem; }
        .pro-overlay p { margin: 0 0 16px 0; color: var(--color-text-secondary); font-size: 0.9rem; }
        .pro-overlay .btn { background: var(--color-primary); color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; }
        .pro-overlay .btn:hover { background: var(--color-primary-dark, #0a7c72); }

        /* Full page paywall */
        .page-paywall { min-height: 400px; position: relative; }
        .page-paywall .seo-blur { filter: blur(12px) !important; pointer-events: none !important; user-select: none !important; }
        .page-paywall::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.3);
            z-index: 99;
        }
        .page-paywall .page-overlay {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 40px 48px;
            border-radius: 16px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.3);
            max-width: 420px;
            width: 90%;
            z-index: 100;
        }
        .page-paywall .page-overlay h3 { font-size: 1.4rem; margin: 0 0 12px 0; }
        .page-paywall .page-overlay p { font-size: 1rem; line-height: 1.5; }
        .page-paywall .page-overlay .btn { padding: 14px 32px; font-size: 1rem; }

        /* Mobile responsive tables */
        .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }

        /* Mobile menu styles */
        .mobile-menu-btn {
            display: none;
            flex-direction: column;
            justify-content: space-between;
            width: 24px;
            height: 18px;
            background: none;
            border: none;
            cursor: pointer;
            padding: 0;
        }
        .hamburger-line {
            width: 100%;
            height: 2px;
            background-color: var(--color-text);
            transition: all 0.3s ease;
        }
        .mobile-menu {
            display: none;
            flex-direction: column;
            background: white;
            border-top: 1px solid var(--color-border);
            padding: 16px 24px;
        }
        .mobile-menu.active { display: flex; }
        .mobile-menu-link {
            padding: 12px 0;
            color: var(--color-text);
            text-decoration: none;
            border-bottom: 1px solid var(--color-border);
        }
        .mobile-menu-link:last-child { border-bottom: none; }
        .mobile-menu-link:hover { color: var(--color-primary); }

        @media (max-width: 768px) {
            .seo-page { padding-left: 16px; padding-right: 16px; }
            .seo-header { margin: 0 -16px 32px -16px; padding: 32px 16px 28px; }
            .seo-header h1 { font-size: 1.5rem; }
            .seo-header .meta { font-size: 0.9rem; gap: 6px 12px; }
            .category-badge { padding: 5px 12px; font-size: 0.8rem; }
            .seo-grid { grid-template-columns: 1fr; gap: 16px; }
            .seo-card { padding: 20px; overflow: hidden; }
            .stat-value { font-size: 1.75rem; }
            .brand-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
            .brand-chip { padding: 10px 12px; }
            .filings-table { min-width: 550px; }
            .filings-table th, .filings-table td { padding: 10px 12px; font-size: 0.8rem; }
            .bar-label { width: 50px; font-size: 0.8rem; }
            .bar-container { height: 24px; margin: 0 8px; }
            .bar-value { width: 40px; font-size: 0.8rem; }
            .related-links { margin-top: 32px; padding-top: 24px; }
            .related-links a { padding: 5px 12px; font-size: 0.8rem; margin-right: 8px; }
            .nav-links { display: none; }
            .mobile-menu-btn { display: flex; }
        }
        @media (max-width: 480px) {
            .seo-header h1 { font-size: 1.35rem; }
            .brand-grid { grid-template-columns: 1fr; }
            .brand-chip { padding: 10px 12px; }
            .meta-stats { gap: 4px; }
            .meta-line { font-size: 0.85rem; }
        }
    </style>
</head>
<body>
    <nav class="nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">BevAlc Intelligence</a>
            <div class="nav-links">
                <a href="/database.html">Database</a>
                <a href="/#pricing">Pricing</a>
                <a href="/account.html">Account</a>
            </div>
            <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Menu">
                <span class="hamburger-line"></span>
                <span class="hamburger-line"></span>
                <span class="hamburger-line"></span>
            </button>
        </div>
        <div class="mobile-menu" id="mobile-menu">
            <a class="mobile-menu-link" href="/">Home</a>
            <a class="mobile-menu-link" href="/database.html">Database</a>
            <a class="mobile-menu-link" href="/#pricing">Pricing</a>
            <a class="mobile-menu-link" href="/account.html">Account</a>
        </div>
    </nav>
    <main class="seo-page">
        ${content}
    </main>
    <footer style="padding: 48px 24px; text-align: center; color: var(--color-text-secondary); border-top: 1px solid var(--color-border); margin-top: 64px;">
        <p>&copy; ${new Date().getFullYear()} BevAlc Intelligence. TTB COLA data updated weekly.</p>
        <p style="margin-top: 8px;"><a href="/database.html">Search Database</a> · <a href="/#pricing">Pricing</a></p>
    </footer>
    <script>
        // Mobile menu toggle
        (function() {
            const menuBtn = document.getElementById('mobile-menu-btn');
            const mobileMenu = document.getElementById('mobile-menu');
            if (menuBtn && mobileMenu) {
                menuBtn.addEventListener('click', function() {
                    mobileMenu.classList.toggle('active');
                });
            }
        })();

        // Check Pro status and unlock content
        (function() {
            function unlockContent() {
                document.querySelectorAll('.seo-blur').forEach(el => el.classList.remove('seo-blur'));
                document.querySelectorAll('.pro-overlay').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.pro-locked').forEach(el => el.classList.remove('pro-locked'));
                document.querySelectorAll('.page-paywall').forEach(el => el.classList.remove('page-paywall'));
            }

            try {
                const urlParams = new URLSearchParams(window.location.search);

                // Allow granting/revoking Pro access for testing
                if (urlParams.get('pro') === 'grant') {
                    document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
                    unlockContent();
                    return;
                }
                if (urlParams.get('pro') === 'revoke') {
                    document.cookie = 'bevalc_pro=; path=/; max-age=0';
                    const user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');
                    delete user.isPro;
                    delete user.is_pro;
                    localStorage.setItem('bevalc_user', JSON.stringify(user));
                    return;
                }

                // Check Pro cookie (only set for verified Pro users)
                if (document.cookie.includes('bevalc_pro=1')) {
                    unlockContent();
                    return;
                }

                const user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');

                // Immediate check from localStorage
                if (user.isPro || user.is_pro) {
                    unlockContent();
                    return;
                }

                // If user has email but no Pro flag, verify with API
                if (user.email) {
                    fetch('https://bevalc-api.mac-rowan.workers.dev/api/stripe/customer-status?email=' + encodeURIComponent(user.email))
                        .then(r => r.json())
                        .then(data => {
                            if (data.success && data.status === 'pro') {
                                // Update localStorage and set Pro cookie
                                user.isPro = true;
                                localStorage.setItem('bevalc_user', JSON.stringify(user));
                                document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
                                unlockContent();
                            }
                        })
                        .catch(() => {});
                }
            } catch(e) { console.error('Pro check error:', e); }
        })();
    </script>
</body>
</html>`;
}

// Company Page Handler
async function handleCompanyPage(path, env, headers) {
    const slug = path.replace('/company/', '').replace(/\/$/, '');

    if (!slug) {
        return new Response('Not Found', { status: 404 });
    }

    // Get company by slug (try direct match first)
    let company = await env.DB.prepare(`
        SELECT * FROM companies WHERE slug = ? AND total_filings >= 1
    `).bind(slug).first();

    // If not found, try to find via company_aliases (handles DBA names like "Moonshine Depot, RMRH Enterprises")
    if (!company) {
        // Convert slug to search terms (e.g., "moonshine-depot-rmrh" -> ["moonshine", "depot", "rmrh"])
        const searchTerms = slug.split('-').filter(t => t.length > 2);

        if (searchTerms.length >= 1) {
            // For single terms (e.g., "diageo"), search for canonical_name starting with that term
            // For multiple terms, use the pattern matching approach
            let aliasResult = null;

            if (searchTerms.length === 1) {
                // Single word lookup - find companies whose canonical name starts with this term
                aliasResult = await env.DB.prepare(`
                    SELECT * FROM companies
                    WHERE UPPER(canonical_name) LIKE UPPER(?)
                    AND total_filings >= 1
                    ORDER BY total_filings DESC
                    LIMIT 1
                `).bind(`${searchTerms[0]}%`).first();
            } else {
                // Multi-word lookup - search for raw_name containing these terms
                const pattern = `%${searchTerms.slice(0, 3).join('%')}%`;
                aliasResult = await env.DB.prepare(`
                    SELECT c.* FROM companies c
                    JOIN company_aliases ca ON c.id = ca.company_id
                    WHERE UPPER(ca.raw_name) LIKE UPPER(?)
                    AND c.total_filings >= 1
                    LIMIT 1
                `).bind(pattern).first();
            }
            company = aliasResult;
        }
    }

    // Last resort: search directly in colas table for company_name matching the slug pattern
    if (!company) {
        const searchTerms = slug.split('-').filter(t => t.length > 2);
        if (searchTerms.length >= 1) {
            // Try multiple patterns to handle possessives (e.g., "kvasirs" from "Kvasir's")
            // Strip trailing 's' from terms as a fallback
            const termsToUse = searchTerms.slice(0, 4);
            const strippedTerms = termsToUse.map(t => t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

            // Build patterns - for single terms, also try prefix match
            const patterns = searchTerms.length === 1
                ? [`${termsToUse[0]}%`, `%${termsToUse[0]}%`]
                : [`%${termsToUse.join('%')}%`, `%${strippedTerms.join('%')}%`];

            let colaResult = null;
            for (const pattern of patterns) {
                colaResult = await env.DB.prepare(`
                    SELECT company_name, COUNT(*) as cnt
                    FROM colas
                    WHERE UPPER(company_name) LIKE UPPER(?)
                    GROUP BY company_name
                    ORDER BY cnt DESC
                    LIMIT 1
                `).bind(pattern).first();
                if (colaResult) break;
            }

            if (colaResult) {
                // Create a minimal company object for rendering
                company = {
                    id: null,
                    canonical_name: colaResult.company_name,
                    display_name: colaResult.company_name,
                    total_filings: colaResult.cnt,
                    slug: slug
                };
            }
        }
    }

    if (!company) {
        return new Response('Company not found', { status: 404 });
    }

    // Determine if we have a normalized company (with id) or a virtual one (from colas search)
    const hasCompanyId = company.id !== null;

    // Get actual filing count from colas (companies.total_filings may be stale)
    let actualTotalFilings;
    if (hasCompanyId) {
        const countResult = await env.DB.prepare(`
            SELECT COUNT(*) as cnt FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
        `).bind(company.id).first();
        actualTotalFilings = countResult?.cnt || company.total_filings;
    } else {
        const countResult = await env.DB.prepare(`
            SELECT COUNT(*) as cnt FROM colas WHERE company_name = ?
        `).bind(company.canonical_name).first();
        actualTotalFilings = countResult?.cnt || company.total_filings;
    }
    company.total_filings = actualTotalFilings;
    let brands = [];
    let categories = [];
    let recentFilings = [];
    let dbaNames = [];

    if (hasCompanyId) {
        // Normalized company - use company_aliases join
        const brandsResult = await env.DB.prepare(`
            SELECT brand_name, COUNT(*) as cnt
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            GROUP BY brand_name
            ORDER BY cnt DESC
            LIMIT 20
        `).bind(company.id).all();
        brands = brandsResult.results || [];

        const categoriesResult = await env.DB.prepare(`
            SELECT class_type_code, COUNT(*) as cnt
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            GROUP BY class_type_code
            ORDER BY cnt DESC
            LIMIT 10
        `).bind(company.id).all();
        categories = categoriesResult.results || [];

        const recentResult = await env.DB.prepare(`
            SELECT ttb_id, brand_name, fanciful_name, class_type_code, approval_date, signal, state, co.company_name as filing_entity
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            ORDER BY COALESCE(co.year, 9999) DESC, COALESCE(co.month, 99) DESC, CAST(SUBSTR(co.approval_date, 4, 2) AS INTEGER) DESC, co.ttb_id DESC
            LIMIT 10
        `).bind(company.id).all();
        recentFilings = recentResult.results || [];

        // Get DBA names (compound aliases like "DBA NAME, LEGAL ENTITY")
        const dbaResult = await env.DB.prepare(`
            SELECT dba_name FROM (
                SELECT TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1)) as dba_name,
                       ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1))) ORDER BY raw_name) as rn
                FROM company_aliases
                WHERE company_id = ? AND raw_name LIKE '%,%'
            ) WHERE rn = 1
            ORDER BY dba_name
            LIMIT 10
        `).bind(company.id).all();
        dbaNames = (dbaResult.results || []).map(r => r.dba_name).filter(n => n && n.length > 0);
    } else {
        // Virtual company - search directly by company_name pattern
        const companyName = company.canonical_name;

        const brandsResult = await env.DB.prepare(`
            SELECT brand_name, COUNT(*) as cnt
            FROM colas
            WHERE company_name = ?
            GROUP BY brand_name
            ORDER BY cnt DESC
            LIMIT 20
        `).bind(companyName).all();
        brands = brandsResult.results || [];

        const categoriesResult = await env.DB.prepare(`
            SELECT class_type_code, COUNT(*) as cnt
            FROM colas
            WHERE company_name = ?
            GROUP BY class_type_code
            ORDER BY cnt DESC
            LIMIT 10
        `).bind(companyName).all();
        categories = categoriesResult.results || [];

        const recentResult = await env.DB.prepare(`
            SELECT ttb_id, brand_name, fanciful_name, class_type_code, approval_date, signal, state, company_name as filing_entity
            FROM colas
            WHERE company_name = ?
            ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) DESC, ttb_id DESC
            LIMIT 10
        `).bind(companyName).all();
        recentFilings = recentResult.results || [];
    }

    // Get primary location for this company (most common state/city)
    let primaryLocation = null;
    if (hasCompanyId) {
        const locationResult = await env.DB.prepare(`
            SELECT state, COUNT(*) as cnt
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ? AND state IS NOT NULL AND state != ''
            GROUP BY state
            ORDER BY cnt DESC
            LIMIT 1
        `).bind(company.id).first();
        primaryLocation = locationResult?.state || null;
    } else {
        const locationResult = await env.DB.prepare(`
            SELECT state, COUNT(*) as cnt
            FROM colas
            WHERE company_name = ? AND state IS NOT NULL AND state != ''
            GROUP BY state
            ORDER BY cnt DESC
            LIMIT 1
        `).bind(company.canonical_name).first();
        primaryLocation = locationResult?.state || null;
    }

    // Get related companies (same top category)
    const topCategory = categories[0]?.class_type_code;
    let relatedCompanies = [];
    if (topCategory && hasCompanyId) {
        const relatedResult = await env.DB.prepare(`
            SELECT c.canonical_name, c.slug, c.total_filings, COUNT(*) as category_filings
            FROM companies c
            JOIN company_aliases ca ON c.id = ca.company_id
            JOIN colas co ON ca.raw_name = co.company_name
            WHERE c.id != ? AND co.class_type_code = ? AND c.total_filings >= 10
            GROUP BY c.id
            ORDER BY category_filings DESC
            LIMIT 5
        `).bind(company.id, topCategory).all();
        relatedCompanies = relatedResult.results || [];
    }

    // Calculate category percentages (deduplicated by category name)
    const totalCatFilings = categories.reduce((sum, c) => sum + c.cnt, 0);
    const categoryMap = new Map();
    for (const c of categories) {
        const name = getCategory(c.class_type_code);
        if (categoryMap.has(name)) {
            categoryMap.get(name).count += c.cnt;
        } else {
            categoryMap.set(name, { name, count: c.cnt });
        }
    }
    const categoryBars = Array.from(categoryMap.values())
        .map(c => ({ ...c, pct: Math.round((c.count / totalCatFilings) * 100) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    // Build brand-focused HTML
    const topBrandNames = brands.slice(0, 5).map(b => b.brand_name);
    const brandListText = topBrandNames.length > 0
        ? topBrandNames.slice(0, -1).join(', ') + (topBrandNames.length > 1 ? ' and ' : '') + topBrandNames[topBrandNames.length - 1]
        : '';

    const title = `${company.display_name} Brands & Portfolio`;
    const description = `Explore ${company.display_name}'s beverage portfolio including ${brandListText}. ${formatNumber(company.total_filings)} TTB COLA filings across ${formatNumber(brands.length)}+ brands.`;

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": company.canonical_name,
        "description": description,
        "url": `${BASE_URL}/company/${slug}`,
        "brand": brands.slice(0, 10).map(b => ({
            "@type": "Brand",
            "name": b.brand_name
        }))
    };

    const content = `
        <header class="seo-header">
            <div class="seo-header-inner">
                <div class="breadcrumb">
                    <a href="/">Home</a> / <a href="/database.html">Database</a> / Company
                </div>
                <h1>${escapeHtml(company.display_name)}</h1>
                <div class="meta">
                    <span><strong>${formatNumber(brands.length)}+</strong> Brands</span>
                    <span><strong>${formatNumber(company.total_filings)}</strong> Filings</span>
                </div>
                <div class="meta-stats">
                    <p class="meta-line"><span class="meta-icon">📅</span> Filing since <strong>${escapeHtml(company.first_filing || 'N/A')}</strong></p>
                    ${primaryLocation ? `<p class="meta-line"><span class="meta-icon">📍</span> ${escapeHtml(primaryLocation)}</p>` : ''}
                    ${dbaNames.length > 0 ? `<p class="meta-line"><span class="meta-icon">🏢</span> Also operates as: ${dbaNames.slice(0, 3).map(n => escapeHtml(n)).join(', ')}${dbaNames.length > 3 ? '...' : ''}</p>` : ''}
                </div>
            </div>
        </header>

        <div class="page-paywall pro-locked">
            <div class="seo-blur">
                <section class="seo-card" style="margin-bottom: 32px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
                    <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                        ${escapeHtml(company.display_name)} is a beverage alcohol company with <strong>${formatNumber(company.total_filings)}</strong> TTB COLA filings.
                        ${brands.length > 0 ? `Their portfolio includes brands such as <strong>${brands.slice(0, 3).map(b => escapeHtml(b.brand_name)).join('</strong>, <strong>')}</strong>${brands.length > 3 ? `, <strong>${escapeHtml(brands[3].brand_name)}</strong>` : ''}${brands.length > 4 ? `, and more` : ''}.` : ''}
                        ${categoryBars.length > 0 ? `The company primarily operates in the <strong>${categoryBars.slice(0, 2).map(c => c.name.toLowerCase()).join('</strong> and <strong>')}</strong> ${categoryBars.length > 1 ? 'categories' : 'category'}.` : ''}
                    </p>
                </section>

                <div class="seo-grid">
                    <div class="seo-card">
                        <h2>Total Filings</h2>
                        <div class="stat-value">${formatNumber(company.total_filings)}</div>
                        <div class="stat-label">TTB COLA applications</div>
                    </div>
                    <div class="seo-card">
                        <h2>Brand Portfolio</h2>
                        <div class="stat-value">${formatNumber(brands.length)}${brands.length === 20 ? '+' : ''}</div>
                        <div class="stat-label">Distinct brands filed</div>
                    </div>
                    <div class="seo-card">
                        <h2>Category Mix</h2>
                        <div class="bar-chart">
                            ${categoryBars.length > 0 ? categoryBars.map(c => `
                                <div class="bar-row">
                                    <div class="bar-label">${escapeHtml(c.name)}</div>
                                    <div class="bar-container"><div class="bar-fill" style="width: ${c.pct}%"></div></div>
                                    <div class="bar-value">${c.pct}%</div>
                                </div>
                            `).join('') : '<div style="color: #64748b; font-size: 0.9rem;">No category data</div>'}
                        </div>
                    </div>
                </div>

                <div class="seo-card" style="margin-bottom: 32px;">
                    <h2>Brand Portfolio${brands.length === 20 ? ' (Top 20)' : ` (${brands.length})`}</h2>
                    <div class="brand-grid">
                        ${brands.map(b => `
                            <div class="brand-chip">
                                <a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>
                                <span class="count">${formatNumber(b.cnt)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="seo-card">
                    <h2>Recent Filings${recentFilings.length === 10 ? ' (Latest 10)' : ''}</h2>
                    <div class="table-wrapper">
                        <table class="filings-table">
                            <thead>
                                <tr>
                                    <th>Brand</th>
                                    <th>Product</th>
                                    <th>Filing Entity</th>
                                    <th>Approved</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recentFilings.map(f => {
                                    const filingEntity = f.filing_entity ? f.filing_entity.split(',')[0].trim() : '-';
                                    return `
                                    <tr>
                                        <td><a href="/brand/${makeSlug(f.brand_name)}"><strong>${escapeHtml(f.brand_name)}</strong></a></td>
                                        <td>${escapeHtml(f.fanciful_name || '-')}</td>
                                        <td style="font-size: 0.8rem; color: #64748b;">${escapeHtml(filingEntity)}</td>
                                        <td>${escapeHtml(f.approval_date)}</td>
                                        <td>${f.signal ? `<span class="signal-badge signal-${f.signal.toLowerCase().replace(/_/g, '-')}">${f.signal.replace('_', ' ')}</span>` : '<span class="signal-badge signal-refile">—</span>'}</td>
                                    </tr>
                                `}).join('')}
                            </tbody>
                        </table>
                    </div>
                    <p style="margin-top: 16px; text-align: center;"><a href="/database.html?q=${encodeURIComponent(company.canonical_name)}">View all filings →</a></p>
                </div>

                <div class="related-links">
                    <h3>Related Companies</h3>
                    ${relatedCompanies.map(c => `<a href="/company/${c.slug}">${escapeHtml(c.canonical_name)}</a>`).join('')}
                </div>
            </div>
            <div class="pro-overlay page-overlay">
                <h3>Unlock Company Insights</h3>
                <p>Get full access to ${escapeHtml(company.display_name)}'s brand portfolio, filing history, and detailed analytics.</p>
                <a href="/#pricing" class="btn">Upgrade to Pro</a>
                <p style="margin-top: 12px; font-size: 0.85rem; color: var(--color-text-secondary);">Starting at $49/month</p>
            </div>
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/company/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
            ...headers
        }
    });
}

// Brand Page Handler
async function handleBrandPage(path, env, headers) {
    const slug = path.replace('/brand/', '').replace(/\/$/, '');

    if (!slug) {
        return new Response('Not Found', { status: 404 });
    }

    // Fast lookup via brand_slugs table
    const brandResult = await env.DB.prepare(`
        SELECT brand_name, filing_count as cnt FROM brand_slugs WHERE slug = ?
    `).bind(slug).first();

    if (!brandResult) {
        return new Response('Brand not found', { status: 404 });
    }

    // Get actual filing count from colas (brand_slugs.filing_count may be stale)
    const actualCount = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas WHERE brand_name = ?
    `).bind(brandResult.brand_name).first();

    const brand = {
        brand_name: brandResult.brand_name,
        cnt: actualCount?.cnt || brandResult.cnt
    };

    // Get company for this brand
    const companyResult = await env.DB.prepare(`
        SELECT co.company_name, c.canonical_name, c.slug
        FROM colas co
        LEFT JOIN company_aliases ca ON co.company_name = ca.raw_name
        LEFT JOIN companies c ON ca.company_id = c.id
        WHERE co.brand_name = ?
        GROUP BY co.company_name
        ORDER BY COUNT(*) DESC
        LIMIT 1
    `).bind(brand.brand_name).first();

    // Get category for this brand
    const categoryResult = await env.DB.prepare(`
        SELECT class_type_code, COUNT(*) as cnt
        FROM colas WHERE brand_name = ?
        GROUP BY class_type_code
        ORDER BY cnt DESC
        LIMIT 1
    `).bind(brand.brand_name).first();
    const primaryCategory = categoryResult ? getCategory(categoryResult.class_type_code) : 'Other';

    // Get filing timeline by year
    const timelineResult = await env.DB.prepare(`
        SELECT year, COUNT(*) as cnt,
               SUM(CASE WHEN signal = 'NEW_SKU' THEN 1 ELSE 0 END) as new_skus
        FROM colas WHERE brand_name = ?
        GROUP BY year
        ORDER BY year DESC
        LIMIT 5
    `).bind(brand.brand_name).all();
    const timeline = timelineResult.results || [];

    // Get recent products
    // Use year/month/day for proper chronological sorting (newest first)
    const productsResult = await env.DB.prepare(`
        SELECT ttb_id, fanciful_name, class_type_code, approval_date, signal
        FROM colas WHERE brand_name = ?
        ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) DESC, ttb_id DESC
        LIMIT 15
    `).bind(brand.brand_name).all();
    const products = productsResult.results || [];

    // Skip related brands query for performance - would require precomputed table
    const relatedBrands = [];

    const maxTimeline = Math.max(...timeline.map(t => t.cnt), 1);

    const title = brand.brand_name;
    const description = `${brand.brand_name} has ${formatNumber(brand.cnt)} TTB COLA filings. View product timeline, new SKUs, and filing history.`;

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Brand",
        "name": brand.brand_name,
        "category": primaryCategory,
        "description": description,
        "url": `${BASE_URL}/brand/${slug}`,
        ...(companyResult?.canonical_name && {
            "manufacturer": {
                "@type": "Organization",
                "name": companyResult.canonical_name
            }
        })
    };

    const content = `
        <header class="seo-header">
            <div class="seo-header-inner">
                <div class="breadcrumb">
                    <a href="/">Home</a> / <a href="/database.html">Database</a> / Brand
                </div>
                <h1>${escapeHtml(brand.brand_name)}</h1>
                <div class="meta">
                    ${companyResult?.canonical_name ? `<span>by <a href="/company/${companyResult.slug}">${escapeHtml(companyResult.canonical_name)}</a></span>` : ''}
                    <span class="category-badge">${escapeHtml(primaryCategory)}</span>
                    <span><strong>${formatNumber(brand.cnt)}</strong> Filings</span>
                </div>
            </div>
        </header>

        <div class="page-paywall pro-locked">
            <div class="seo-blur">
                <div class="seo-grid">
                    <div class="seo-card">
                        <h2>Total Filings</h2>
                        <div class="stat-value">${formatNumber(brand.cnt)}</div>
                        <div class="stat-label">TTB COLA applications</div>
                    </div>
                    <div class="seo-card">
                        <h2>Primary Category</h2>
                        <div class="stat-value" style="font-size: 1.75rem;">${escapeHtml(primaryCategory)}</div>
                        <div class="stat-label"><a href="/category/${makeSlug(primaryCategory)}/${new Date().getFullYear()}">View ${primaryCategory.toLowerCase()} trends →</a></div>
                    </div>
                    <div class="seo-card">
                        <h2>Filing Activity</h2>
                        <div class="bar-chart">
                            ${timeline.length > 0 ? timeline.map(t => `
                                <div class="bar-row">
                                    <div class="bar-label">${t.year}</div>
                                    <div class="bar-container"><div class="bar-fill" style="width: ${Math.round((t.cnt / maxTimeline) * 100)}%"></div></div>
                                    <div class="bar-value">${t.cnt}</div>
                                </div>
                            `).join('') : '<div style="color: #64748b; font-size: 0.9rem;">No recent activity</div>'}
                        </div>
                    </div>
                </div>

                <div class="seo-card">
                    <h2>Recent Products${products.length === 15 ? ' (showing 15)' : ` (${products.length})`}</h2>
                    <div class="table-wrapper">
                        <table class="filings-table">
                            <thead>
                                <tr>
                                    <th>Brand Name</th>
                                    <th>Fanciful Name</th>
                                    <th>Type</th>
                                    <th>Approved</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.map(p => `
                                    <tr>
                                        <td><strong>${escapeHtml(brand.brand_name)}</strong></td>
                                        <td>${escapeHtml(p.fanciful_name || '—')}</td>
                                        <td>${escapeHtml(getCategory(p.class_type_code))}</td>
                                        <td>${escapeHtml(p.approval_date)}</td>
                                        <td>${p.signal ? `<span class="signal-badge signal-${p.signal.toLowerCase().replace(/_/g, '-')}">${p.signal.replace('_', ' ')}</span>` : '<span class="signal-badge signal-refile">—</span>'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <p style="margin-top: 16px; text-align: center;"><a href="/database.html?q=${encodeURIComponent(brand.brand_name)}">View all products →</a></p>
                </div>

                <div class="related-links">
                    <h3>More ${primaryCategory} Brands</h3>
                    ${relatedBrands.map(b => `<a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>`).join('')}
                </div>
            </div>
            <div class="pro-overlay page-overlay">
                <h3>Unlock Brand Insights</h3>
                <p>Get full access to ${escapeHtml(brand.brand_name)}'s product catalog, filing history, and detailed analytics.</p>
                <a href="/#pricing" class="btn">Upgrade to Pro</a>
                <p style="margin-top: 12px; font-size: 0.85rem; color: var(--color-text-secondary);">Starting at $49/month</p>
            </div>
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/brand/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
            ...headers
        }
    });
}

// Category Page Handler
async function handleCategoryPage(path, env, headers) {
    const parts = path.replace('/category/', '').replace(/\/$/, '').split('/');
    const categorySlug = parts[0];
    const year = parseInt(parts[1]) || new Date().getFullYear();

    // Map slug to category name
    const categoryMap = {
        'whiskey': 'Whiskey', 'vodka': 'Vodka', 'tequila': 'Tequila',
        'rum': 'Rum', 'gin': 'Gin', 'brandy': 'Brandy',
        'wine': 'Wine', 'beer': 'Beer', 'liqueur': 'Liqueur',
        'cocktails': 'Cocktails', 'other': 'Other'
    };

    const category = categoryMap[categorySlug];
    if (!category) {
        return new Response('Category not found', { status: 404 });
    }

    // Get patterns for this category
    const categoryPatterns = {
        'Whiskey': ['%WHISK%', '%BOURBON%', '%SCOTCH%', '%RYE%'],
        'Vodka': ['%VODKA%'],
        'Tequila': ['%TEQUILA%', '%MEZCAL%', '%AGAVE%'],
        'Rum': ['%RUM%', '%CACHACA%'],
        'Gin': ['%GIN%'],
        'Brandy': ['%BRANDY%', '%COGNAC%', '%ARMAGNAC%', '%GRAPPA%', '%PISCO%'],
        'Wine': ['%WINE%', '%CHAMPAGNE%', '%PORT%', '%SHERRY%', '%VERMOUTH%', '%SAKE%', '%CIDER%', '%MEAD%'],
        'Beer': ['%BEER%', '%ALE%', '%MALT%', '%STOUT%', '%PORTER%'],
        'Liqueur': ['%LIQUEUR%', '%CORDIAL%', '%SCHNAPPS%', '%AMARETTO%', '%CREME DE%'],
        'Cocktails': ['%COCKTAIL%', '%MARTINI%', '%DAIQUIRI%', '%MARGARITA%']
    };

    const patterns = categoryPatterns[category] || [`%${category.toUpperCase()}%`];
    const patternCondition = patterns.map(() => 'class_type_code LIKE ?').join(' OR ');

    // Get total filings for this year
    const totalResult = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas
        WHERE year = ? AND (${patternCondition})
    `).bind(year, ...patterns).first();
    const totalFilings = totalResult?.cnt || 0;

    // Get previous year for comparison
    const prevResult = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas
        WHERE year = ? AND (${patternCondition})
    `).bind(year - 1, ...patterns).first();
    const prevFilings = prevResult?.cnt || 1;
    const yoyChange = Math.round(((totalFilings - prevFilings) / prevFilings) * 100);

    // Get new brands count
    const newBrandsResult = await env.DB.prepare(`
        SELECT COUNT(DISTINCT brand_name) as cnt FROM colas
        WHERE year = ? AND signal = 'NEW_BRAND' AND (${patternCondition})
    `).bind(year, ...patterns).first();
    const newBrands = newBrandsResult?.cnt || 0;

    // Get monthly trend
    const monthlyResult = await env.DB.prepare(`
        SELECT month, COUNT(*) as cnt FROM colas
        WHERE year = ? AND (${patternCondition})
        GROUP BY month ORDER BY month
    `).bind(year, ...patterns).all();
    const monthly = monthlyResult.results || [];
    const maxMonthly = Math.max(...monthly.map(m => m.cnt), 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Get top filing companies
    const topCompaniesResult = await env.DB.prepare(`
        SELECT c.canonical_name, c.slug, COUNT(*) as cnt
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        JOIN companies c ON ca.company_id = c.id
        WHERE co.year = ? AND (${patternCondition})
        GROUP BY c.id
        ORDER BY cnt DESC
        LIMIT 10
    `).bind(year, ...patterns).all();
    const topCompanies = topCompaniesResult.results || [];

    // Get top new brands
    const topBrandsResult = await env.DB.prepare(`
        SELECT brand_name, COUNT(*) as cnt
        FROM colas
        WHERE year = ? AND signal IN ('NEW_BRAND', 'NEW_SKU') AND (${patternCondition})
        GROUP BY brand_name
        ORDER BY cnt DESC
        LIMIT 10
    `).bind(year, ...patterns).all();
    const topBrands = topBrandsResult.results || [];

    // Available years
    const yearsResult = await env.DB.prepare(`
        SELECT DISTINCT year FROM colas WHERE year >= 2020 ORDER BY year DESC
    `).all();
    const years = (yearsResult.results || []).map(r => r.year);

    const title = `${category} Filings ${year}`;
    const description = `${formatNumber(totalFilings)} ${category} TTB COLA filings in ${year}. ${yoyChange >= 0 ? '+' : ''}${yoyChange}% vs ${year-1}. View top filers, new brands, and monthly trends.`;

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": `${category} Industry TTB Filings - ${year}`,
        "description": description,
        "url": `${BASE_URL}/category/${categorySlug}/${year}`
    };

    const content = `
        <div class="breadcrumb">
            <a href="/">Home</a> / <a href="/database.html">Database</a> / Category
        </div>
        <header class="seo-header">
            <h1>${category} Filings in ${year}</h1>
            <p class="meta">${formatNumber(totalFilings)} Total Filings · ${formatNumber(newBrands)} New Brands · ${yoyChange >= 0 ? '+' : ''}${yoyChange}% vs ${year - 1}</p>
        </header>

        <div class="seo-grid">
            <div class="seo-card">
                <h2>Total Filings</h2>
                <div class="stat-value">${formatNumber(totalFilings)}</div>
                <div class="stat-label">${yoyChange >= 0 ? '↑' : '↓'} ${Math.abs(yoyChange)}% year-over-year</div>
            </div>
            <div class="seo-card">
                <h2>New Brands</h2>
                <div class="stat-value">${formatNumber(newBrands)}</div>
                <div class="stat-label">Brands first seen in ${year}</div>
            </div>
            <div class="seo-card">
                <h2>Monthly Trend</h2>
                <div class="bar-chart">
                    ${monthly.map(m => `
                        <div class="bar-row">
                            <div class="bar-label">${monthNames[m.month - 1]}</div>
                            <div class="bar-container"><div class="bar-fill" style="width: ${Math.round((m.cnt / maxMonthly) * 100)}%"></div></div>
                            <div class="bar-value">${m.cnt}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <div class="seo-grid">
            <div class="seo-card">
                <h2>Top Filing Companies</h2>
                <table class="filings-table">
                    <tbody>
                        ${topCompanies.map((c, i) => `
                            <tr>
                                <td>${i + 1}.</td>
                                <td><a href="/company/${c.slug}">${escapeHtml(c.canonical_name)}</a></td>
                                <td style="text-align: right;">${formatNumber(c.cnt)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="seo-card">
                <h2>Top Active Brands</h2>
                <table class="filings-table">
                    <tbody>
                        ${topBrands.map((b, i) => `
                            <tr>
                                <td>${i + 1}.</td>
                                <td><a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a></td>
                                <td style="text-align: right;">${formatNumber(b.cnt)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="related-links">
            <h3>Browse by Year</h3>
            ${years.map(y => y === year ? `<strong>${y}</strong>` : `<a href="/category/${categorySlug}/${y}">${y}</a>`).join(' ')}
            <h3 style="margin-top: 24px;">Other Categories</h3>
            ${Object.entries(categoryMap).filter(([s]) => s !== categorySlug).map(([s, n]) => `<a href="/category/${s}/${year}">${n}</a>`).join('')}
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/category/${categorySlug}/${year}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
            ...headers
        }
    });
}

// Sitemap Handler - serves pre-generated sitemaps from R2
const R2_SITEMAP_URL = 'https://pub-1c889ae594b041a3b752c6c891eb718e.r2.dev/sitemaps';

async function handleSitemap(path, env) {
    // Cache headers for all sitemaps (24h edge, 1h browser)
    const cacheHeaders = {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
    };

    // Map path to R2 file
    let filename;
    if (path === '/sitemap.xml') {
        filename = 'sitemap.xml';
    } else if (path === '/sitemap-static.xml') {
        filename = 'sitemap-static.xml';
    } else if (path === '/sitemap-companies.xml') {
        filename = 'sitemap-companies.xml';
    } else {
        const brandMatch = path.match(/^\/sitemap-brands-(\d+)\.xml$/);
        if (brandMatch) {
            filename = `sitemap-brands-${brandMatch[1]}.xml`;
        }
    }

    if (!filename) {
        return new Response('Not found', { status: 404 });
    }

    // Fetch from R2
    try {
        const r2Response = await fetch(`${R2_SITEMAP_URL}/${filename}`);
        if (!r2Response.ok) {
            console.error(`Failed to fetch sitemap from R2: ${r2Response.status}`);
            return new Response('Sitemap not found', { status: 404 });
        }
        const xml = await r2Response.text();
        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error(`Error fetching sitemap from R2: ${error.message}`);
        return new Response('Error loading sitemap', { status: 500 });
    }
}

function generateUrlsetXml(urls) {
    // Use current date as lastmod (sitemaps are regenerated daily via edge cache)
    const today = new Date().toISOString().split('T')[0];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
}
