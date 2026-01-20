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
            }

            // Hub pages (e.g., /whiskey/, /tequila/)
            const hubMatch = path.match(/^\/(whiskey|tequila|vodka|gin|rum|brandy|wine|beer|liqueur|cocktails|other)\/?$/);
            if (hubMatch) {
                return await handleHubPage(hubMatch[1], env, request.headers);
            }

            if (path === '/sitemap.xml' || path.startsWith('/sitemap-')) {
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
            }
            // Enhancement endpoints
            else if (path === '/api/enhance' && request.method === 'POST') {
                response = await handleEnhance(request, env);
            } else if (path === '/api/enhance/status' && request.method === 'GET') {
                response = await handleEnhanceStatus(url, env);
            } else if (path === '/api/credits' && request.method === 'GET') {
                response = await handleGetCredits(url, env);
            } else if (path === '/api/credits/checkout' && request.method === 'POST') {
                response = await handleCreditCheckout(request, env);
            } else if (path === '/api/company-lookup' && request.method === 'GET') {
                response = await handleCompanyLookup(url, env);
            } else if (path === '/api/permits/leads' && request.method === 'GET') {
                response = await handlePermitLeads(url, env);
            } else if (path === '/api/permits/stats' && request.method === 'GET') {
                response = await handlePermitStats(env);
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
    const { email, successUrl, cancelUrl } = body;

    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    const priceId = env.STRIPE_PRO_PRICE_ID;

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
        'metadata[tier]': 'pro',
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

            // Check if this is a credit purchase or subscription
            if (session.metadata?.type === 'credit_purchase') {
                // Handle credit purchase
                const credits = parseInt(session.metadata.credits || '0', 10);
                const pack = session.metadata.pack;
                const email = (session.metadata.email || customerEmail).toLowerCase();

                if (email && credits > 0) {
                    console.log(`Credit purchase: ${credits} credits for ${email}, pack: ${pack}`);

                    try {
                        // Add credits to user account
                        await env.DB.prepare(`
                            UPDATE user_preferences
                            SET enhancement_credits = COALESCE(enhancement_credits, 0) + ?,
                                updated_at = datetime('now')
                            WHERE email = ?
                        `).bind(credits, email).run();

                        // Log the transaction
                        await env.DB.prepare(`
                            INSERT INTO enhancement_credits (email, type, amount, stripe_payment_id, created_at)
                            VALUES (?, 'purchase', ?, ?, datetime('now'))
                        `).bind(email, credits, session.payment_intent || session.id).run();

                        console.log(`Added ${credits} credits to ${email}`);
                    } catch (dbError) {
                        console.error(`Failed to add credits: ${dbError.message}`);
                    }
                }
            } else {
                // Handle subscription checkout
                if (customerEmail) {
                    console.log(`Subscription activated for: ${customerEmail}`);

                    // Generate unique preferences token
                    const preferencesToken = generateToken();

                    // Create or update user_preferences record
                    try {
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, 'pro', ?, '[]', datetime('now'))
                            ON CONFLICT(email) DO UPDATE SET
                                stripe_customer_id = excluded.stripe_customer_id,
                                is_pro = 1,
                                tier = 'pro',
                                preferences_token = COALESCE(user_preferences.preferences_token, excluded.preferences_token),
                                updated_at = datetime('now')
                        `).bind(customerEmail.toLowerCase(), customerId, preferencesToken).run();

                        console.log(`User preferences record created/updated for: ${customerEmail}`);

                        // Sync to Loops - mark as Pro with no categories selected yet
                        await syncToLoops(customerEmail, [], true, true, env);

                    } catch (dbError) {
                        console.error(`Failed to create user_preferences record: ${dbError.message}`);
                    }
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
                    SET is_pro = 0, tier = NULL, categories = '[]', updated_at = datetime('now')
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
        'SELECT is_pro, stripe_customer_id, tier FROM user_preferences WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (dbUser && dbUser.is_pro === 1) {
        return {
            success: true,
            status: 'pro',
            email,
            customerId: dbUser.stripe_customer_id || null,
            tier: dbUser.tier || null,
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
        const subscription = subsData.data[0];

        return {
            success: true,
            status: 'pro',
            email,
            customerId: customer.id,
            subscriptionId: subscription.id,
            tier: 'pro'
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

// handleUpgradeSubscription removed - only one Pro tier now

// ==========================================
// CREDIT PURCHASE HANDLERS
// ==========================================

const CREDIT_PACKS = {
    'pack_10': { credits: 10, price: 2000, name: '10 Credits' },  // $20.00
    'pack_25': { credits: 25, price: 4000, name: '25 Credits' }   // $40.00
};

async function handleCreditCheckout(request, env) {
    const body = await request.json();
    const { email, pack, successUrl, cancelUrl } = body;

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    if (!pack || !CREDIT_PACKS[pack]) {
        return { success: false, error: 'Invalid credit pack. Use pack_10 or pack_25' };
    }

    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
        return { success: false, error: 'Stripe not configured' };
    }

    const creditPack = CREDIT_PACKS[pack];

    // Create one-time payment checkout session
    const checkoutData = {
        'mode': 'payment',
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': creditPack.price.toString(),
        'line_items[0][price_data][product_data][name]': `BevAlc Intelligence - ${creditPack.name}`,
        'line_items[0][price_data][product_data][description]': `${creditPack.credits} Company Intelligence credits`,
        'line_items[0][quantity]': '1',
        'success_url': successUrl || 'https://bevalcintel.com/account.html?credits=success',
        'cancel_url': cancelUrl || 'https://bevalcintel.com/account.html#credits',
        'customer_email': email,
        'metadata[type]': 'credit_purchase',
        'metadata[pack]': pack,
        'metadata[credits]': creditPack.credits.toString(),
        'metadata[email]': email.toLowerCase()
    };

    try {
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: Object.entries(checkoutData).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
        });

        const session = await response.json();

        if (session.error) {
            return { success: false, error: session.error.message };
        }

        return {
            success: true,
            sessionId: session.id,
            url: session.url
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
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
        query = 'SELECT * FROM user_preferences WHERE LOWER(email) = ?';
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
                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, 'pro', ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, newToken).run();

                        user = {
                            email: email.toLowerCase(),
                            is_pro: 1,
                            tier: 'pro',
                            preferences_token: newToken,
                            categories: '[]',
                            receive_free_report: 1
                        };
                        console.log(`Created missing user_preferences record for Pro user: ${email}`);
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

        return {
            success: true,
            email: user.email,
            is_pro: user.is_pro === 1,
            tier: user.tier || 'pro',
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

    const { token, categories, receive_free_report } = body;

    if (!token) {
        return { success: false, error: 'Token required' };
    }

    try {
        // Get user
        const user = await env.DB.prepare(
            'SELECT email, is_pro FROM user_preferences WHERE preferences_token = ?'
        ).bind(token).first();

        if (!user) {
            return { success: false, error: 'Invalid token' };
        }

        if (user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required to select categories' };
        }

        const receiveFreeReport = receive_free_report !== false;

        // Pro users can select multiple categories for their reports
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

    // Check for Pro access
    const email = params.get('email');
    let isPro = false;

    if (email) {
        try {
            const user = await env.DB.prepare(
                'SELECT is_pro FROM user_preferences WHERE email = ?'
            ).bind(email.toLowerCase()).first();

            if (user?.is_pro === 1) {
                isPro = true;
            }
        } catch (e) {
            console.error('Error checking user tier:', e);
        }
    }

    const query = params.get('q')?.trim();
    const origin = params.get('origin');
    const classType = params.get('class_type');
    let category = params.get('category');  // No longer forced for Category Pro
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
            const [year, month, day] = parts;
            // Compare year > OR (year = AND month >) OR (year = AND month = AND day >=)
            whereClause += ' AND (year > ? OR (year = ? AND month > ?) OR (year = ? AND month = ? AND day >= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month), parseInt(year), parseInt(month), parseInt(day));
        }
    }

    if (dateTo) {
        const parts = dateTo.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            // Compare year < OR (year = AND month <) OR (year = AND month = AND day <=)
            whereClause += ' AND (year < ? OR (year = ? AND month < ?) OR (year = ? AND month = ? AND day <= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month), parseInt(year), parseInt(month), parseInt(day));
        }
    }

    // Free users: 2-month delay on data (can only see data older than 2 months)
    if (!isPro) {
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        const maxYear = twoMonthsAgo.getFullYear();
        const maxMonth = twoMonthsAgo.getMonth() + 1;  // JS months are 0-indexed
        const maxDay = twoMonthsAgo.getDate();
        // Restrict to data older than 2 months
        whereClause += ' AND (year < ? OR (year = ? AND month < ?) OR (year = ? AND month = ? AND day <= ?))';
        queryParams.push(maxYear, maxYear, maxMonth, maxYear, maxMonth, maxDay);
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
        // Then by signal priority: NEW_COMPANY > NEW_BRAND > NEW_SKU > REFILE
        orderByClause = `ORDER BY COALESCE(year, 9999) ${sortOrder}, COALESCE(month, 99) ${sortOrder}, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ${sortOrder}, CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 ELSE 5 END, ttb_id ${sortOrder}`;
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

    const response = {
        success: true,
        data: dataResult.results || [],
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };

    // Indicate data lag for free users
    if (!isPro) {
        response.dataLagMonths = 2;
    }

    return response;
}

async function handleExport(url, env) {
    const params = url.searchParams;

    // Verify Pro status
    const email = params.get('email');
    const token = params.get('token');
    if (!email) {
        return { success: false, error: 'Email required for export' };
    }

    try {
        let user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
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
                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, tier, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, 'pro', ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, newToken).run();

                        user = { is_pro: 1 };
                        console.log(`Created missing user_preferences record for Pro user: ${email}`);
                    }
                }
            }
        }

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required for export' };
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
    const category = params.get('category');
    const subcategory = params.get('subcategory');
    const status = params.get('status');
    const dateFrom = params.get('date_from');
    const dateTo = params.get('date_to');
    const signal = params.get('signal');

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

    // Signal filter: NEW_BRAND, NEW_SKU, NEW_COMPANY, REFILE
    if (signal) {
        const validSignals = ['NEW_BRAND', 'NEW_SKU', 'NEW_COMPANY', 'REFILE'];
        const signals = signal.split(',').map(s => s.trim().toUpperCase()).filter(s => validSignals.includes(s));
        if (signals.length > 0) {
            const placeholders = signals.map(() => '?').join(',');
            whereClause += ` AND signal IN (${placeholders})`;
            signals.forEach(s => queryParams.push(s));
        }
    }

    if (dateFrom) {
        const parts = dateFrom.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            whereClause += ' AND (year > ? OR (year = ? AND month > ?) OR (year = ? AND month = ? AND day >= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month), parseInt(year), parseInt(month), parseInt(day));
        }
    }

    if (dateTo) {
        const parts = dateTo.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            whereClause += ' AND (year < ? OR (year = ? AND month < ?) OR (year = ? AND month = ? AND day <= ?))';
            queryParams.push(parseInt(year), parseInt(year), parseInt(month), parseInt(year), parseInt(month), parseInt(day));
        }
    }

    // Get total count for info
    const countQuery = `SELECT COUNT(*) as total FROM colas WHERE ${whereClause}`;
    const countResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
    const total = countResult?.total || 0;

    let orderByClause;
    if (safeSortColumn === 'approval_date') {
        // Use year/month/day for proper chronological sorting (approval_date is MM/DD/YYYY string)
        // Then by signal priority: NEW_COMPANY > NEW_BRAND > NEW_SKU > REFILE
        orderByClause = `ORDER BY COALESCE(year, 9999) ${sortOrder}, COALESCE(month, 99) ${sortOrder}, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) ${sortOrder}, CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 ELSE 5 END, ttb_id ${sortOrder}`;
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

    // Get permits for this company
    let permits = [];
    if (result.company_name) {
        const permitsResult = await env.DB.prepare(`
            SELECT p.permit_number, p.industry_type, p.city, p.state, p.is_new
            FROM permits p
            JOIN company_aliases ca ON p.company_id = ca.company_id
            WHERE ca.raw_name = ?
            ORDER BY p.industry_type
        `).bind(result.company_name).all();
        permits = permitsResult.results || [];
    }

    return {
        success: true,
        data: {
            ...result,
            website_url: websiteUrl,
            permits: permits
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
// PERMIT LEADS HANDLERS
// ==========================================

async function handlePermitLeads(url, env) {
    const params = url.searchParams;
    const page = Math.max(1, parseInt(params.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || 50));
    const offset = (page - 1) * limit;

    // Filter options
    const permitType = params.get('permit_type'); // Importer, Distillery, Winery
    const state = params.get('state');

    // Check Pro access
    const email = params.get('email');
    let isPro = false;
    if (email) {
        try {
            const user = await env.DB.prepare(
                'SELECT is_pro FROM user_preferences WHERE email = ?'
            ).bind(email.toLowerCase()).first();
            if (user?.is_pro === 1) isPro = true;
        } catch (e) {}
    }

    if (!isPro) {
        return { success: false, error: 'Pro subscription required for leads access' };
    }

    // Build WHERE clause for permits without COLA companies
    let whereClause = 'company_id IS NULL';
    const queryParams = [];

    // Exclude wholesalers by default (they don't file COLAs)
    whereClause += " AND industry_type != 'Wholesaler (Alcohol)'";

    if (permitType) {
        const typeMap = {
            'Importer': 'Importer (Alcohol)',
            'Distillery': 'Distilled Spirits Plant',
            'Winery': 'Wine Producer'
        };
        const dbType = typeMap[permitType] || permitType;
        whereClause += ' AND industry_type = ?';
        queryParams.push(dbType);
    }

    if (state) {
        whereClause += ' AND state = ?';
        queryParams.push(state.toUpperCase());
    }

    // Count total
    const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM permits WHERE ${whereClause}`
    ).bind(...queryParams).first();
    const total = countResult?.total || 0;

    // Get leads
    const dataResult = await env.DB.prepare(`
        SELECT permit_number, owner_name, operating_name, city, state, industry_type, is_new
        FROM permits
        WHERE ${whereClause}
        ORDER BY is_new DESC, owner_name ASC
        LIMIT ? OFFSET ?
    `).bind(...queryParams, limit, offset).all();

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

async function handlePermitStats(env) {
    // Get overall permit stats
    const totalResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM permits
    `).first();

    const matchedResult = await env.DB.prepare(`
        SELECT COUNT(*) as matched FROM permits WHERE company_id IS NOT NULL
    `).first();

    const unmatchedResult = await env.DB.prepare(`
        SELECT COUNT(*) as unmatched FROM permits WHERE company_id IS NULL
    `).first();

    // By type (excluding wholesalers for leads count)
    const byTypeResult = await env.DB.prepare(`
        SELECT industry_type, COUNT(*) as count,
               SUM(CASE WHEN company_id IS NULL THEN 1 ELSE 0 END) as leads
        FROM permits
        GROUP BY industry_type
        ORDER BY count DESC
    `).all();

    // New permits this week
    const newResult = await env.DB.prepare(`
        SELECT COUNT(*) as new_count FROM permits WHERE is_new = 1
    `).first();

    // Top states for leads
    const statesResult = await env.DB.prepare(`
        SELECT state, COUNT(*) as count
        FROM permits
        WHERE company_id IS NULL AND industry_type != 'Wholesaler (Alcohol)'
        GROUP BY state
        ORDER BY count DESC
        LIMIT 10
    `).all();

    return {
        success: true,
        stats: {
            total: totalResult?.total || 0,
            matched: matchedResult?.matched || 0,
            unmatched: unmatchedResult?.unmatched || 0,
            newThisWeek: newResult?.new_count || 0,
            byType: byTypeResult.results || [],
            topStatesForLeads: statesResult.results || []
        }
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

function getCategorySlug(category) {
    if (!category) return 'other';
    const slugMap = {
        'RTD/Cocktails': 'cocktails',
        'Cocktails': 'cocktails',
        'Whiskey': 'whiskey',
        'Vodka': 'vodka',
        'Tequila': 'tequila',
        'Rum': 'rum',
        'Gin': 'gin',
        'Brandy': 'brandy',
        'Wine': 'wine',
        'Beer': 'beer',
        'Liqueur': 'liqueur',
        'Other': 'other'
    };
    return slugMap[category] || makeSlug(category);
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
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
    <style>
        /* Navigation styles */
        .nav { background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(0,0,0,0.06); position: fixed; top: 0; left: 0; right: 0; z-index: 100; }
        .nav-container { max-width: 1200px; margin: 0 auto; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
        .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--color-text); text-decoration: none; }
        .nav-links { display: flex; gap: 24px; }
        .nav-links a { color: var(--color-text-secondary); text-decoration: none; font-size: 0.9rem; }
        .nav-links a:hover { color: var(--color-primary); }
        .nav-home { color: #0d9488 !important; font-weight: 600; }

        .seo-page { padding-top: 80px; max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; padding-bottom: 64px; }

        /* Modern hero header */
        .seo-header {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            margin: 0 -24px 48px -24px;
            padding: 56px 24px 48px;
            position: relative;
            overflow: hidden;
        }
        .seo-header::before {
            content: '';
            position: absolute;
            top: 0; right: 0; bottom: 0; left: 0;
            background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            opacity: 0.5;
            pointer-events: none;
        }
        .seo-header::after {
            content: '';
            position: absolute;
            top: -50%; right: -20%;
            width: 500px; height: 500px;
            background: radial-gradient(circle, rgba(13,148,136,0.15) 0%, transparent 70%);
            pointer-events: none;
        }
        .seo-header-inner { max-width: 1200px; margin: 0 auto; position: relative; z-index: 1; }
        .seo-header h1 {
            font-family: var(--font-display);
            font-size: 2.5rem;
            margin-bottom: 20px;
            color: #ffffff;
            line-height: 1.15;
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .seo-header .meta {
            color: rgba(255,255,255,0.7);
            font-size: 1rem;
            display: flex;
            flex-wrap: wrap;
            gap: 12px 20px;
            align-items: center;
        }
        .seo-header .meta a { color: #5eead4; font-weight: 500; text-decoration: none; }
        .seo-header .meta a:hover { color: #99f6e4; text-decoration: underline; }
        .seo-header .meta strong { color: #fff; }
        .category-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255,255,255,0.15);
            padding: 8px 16px;
            border-radius: 24px;
            font-size: 0.875rem;
            font-weight: 500;
            color: #fff;
        }
        .category-badge::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #2dd4bf; box-shadow: 0 0 8px rgba(45,212,191,0.5); }
        .meta-stats { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
        .meta-line { margin: 0; color: rgba(255,255,255,0.6); font-size: 0.9rem; display: flex; align-items: center; gap: 10px; }
        .meta-line strong { color: #fff; font-weight: 600; }
        .meta-icon { font-size: 1rem; opacity: 0.8; }

        /* Sleek stat cards */
        .seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; margin-bottom: 40px; }
        .seo-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 28px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02);
            transition: all 0.25s ease;
            position: relative;
        }
        .seo-card:hover {
            box-shadow: 0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
            transform: translateY(-2px);
            border-color: #cbd5e1;
        }
        .seo-card h2 {
            font-size: 0.7rem;
            color: #0d9488;
            margin-bottom: 16px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .seo-card h2::before {
            content: '';
            width: 3px;
            height: 14px;
            background: linear-gradient(180deg, #0d9488, #14b8a6);
            border-radius: 2px;
        }
        .stat-value {
            font-size: 2.75rem;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.1;
            letter-spacing: -0.03em;
            background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .stat-label { font-size: 0.875rem; color: #64748b; margin-top: 8px; }
        .stat-label a { color: #0d9488; font-weight: 600; text-decoration: none; }
        .stat-label a:hover { text-decoration: underline; }

        /* Modern brand chips */
        .brand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .brand-chip {
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
            text-decoration: none;
        }
        .brand-chip:hover {
            border-color: #0d9488;
            background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(13,148,136,0.15);
        }
        .brand-chip a { color: #1e293b; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; text-decoration: none; font-size: 0.9rem; }
        .brand-chip .count {
            color: #0d9488;
            font-size: 0.75rem;
            flex-shrink: 0;
            margin-left: 12px;
            font-weight: 700;
            background: #f0fdfa;
            padding: 4px 10px;
            border-radius: 12px;
        }

        /* Clean tables */
        .filings-table { width: 100%; border-collapse: separate; border-spacing: 0; }
        .filings-table th {
            background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
            font-weight: 700;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #475569;
            padding: 16px 18px;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
        }
        .filings-table th:first-child { border-radius: 8px 0 0 0; }
        .filings-table th:last-child { border-radius: 0 8px 0 0; }
        .filings-table td {
            padding: 16px 18px;
            border-bottom: 1px solid #f1f5f9;
            color: #334155;
            font-size: 0.9rem;
        }
        .filings-table tbody tr { transition: all 0.15s ease; }
        .filings-table tbody tr:hover { background: #f0fdfa; }
        .filings-table a { color: #0d9488; font-weight: 600; text-decoration: none; }
        .filings-table a:hover { text-decoration: underline; }

        /* Signal badges */
        .signal-badge { display: inline-block; padding: 5px 12px; border-radius: 8px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.03em; }
        .signal-new-company { background: linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%); color: #7c3aed; }
        .signal-new-brand { background: linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%); color: #059669; }
        .signal-new-sku { background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%); color: #4f46e5; }
        .signal-refile { background: #f1f5f9; color: #64748b; }

        /* Modern bar charts */
        .bar-chart { margin: 12px 0; }
        .bar-row { display: flex; align-items: center; margin-bottom: 12px; }
        .bar-label { width: 70px; font-size: 0.8rem; color: #64748b; font-weight: 600; }
        .bar-container { flex: 1; height: 32px; background: linear-gradient(90deg, #f1f5f9, #f8fafc); border-radius: 8px; overflow: hidden; margin: 0 14px; position: relative; }
        .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%);
            border-radius: 8px;
            min-width: 8px;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(13,148,136,0.3);
        }
        .bar-value { width: 50px; text-align: right; font-size: 0.85rem; font-weight: 700; color: #0f172a; }

        /* Related links */
        .related-links { margin-top: 56px; padding-top: 40px; border-top: 2px solid #f1f5f9; }
        .related-links h3 { margin-bottom: 20px; font-size: 1.1rem; color: #1e293b; font-weight: 700; }
        .related-links a {
            display: inline-block;
            margin-right: 10px;
            margin-bottom: 10px;
            color: #0d9488;
            background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }
        .related-links a:hover { background: #ccfbf1; border-color: #5eead4; text-decoration: none; transform: translateY(-1px); }

        /* Breadcrumb */
        .breadcrumb { margin-bottom: 12px; font-size: 0.8rem; color: rgba(255,255,255,0.5); }
        .breadcrumb a { color: rgba(255,255,255,0.6); text-decoration: none; transition: color 0.15s; }
        .breadcrumb a:hover { color: #5eead4; }

        /* Email gate blur styles */
        .gated-table { position: relative; min-height: 280px; }
        .gated-table tbody tr:nth-child(n+4) { filter: blur(4px); user-select: none; pointer-events: none; }
        .gated-table tbody tr:nth-child(n+6) { filter: blur(6px); }
        .gated-table tbody tr:nth-child(n+8) { filter: blur(8px); }
        .gated-table tbody tr a { pointer-events: auto; }
        .gated-table tbody tr:nth-child(n+4) a { pointer-events: none; }
        .gate-overlay {
            position: absolute;
            top: 80px; left: 0; right: 0; bottom: 0;
            background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.98) 40%, white 100%);
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 32px;
        }
        .gate-content {
            text-align: center;
            padding: 32px 48px;
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.04);
        }
        .gate-content h3 { margin: 0 0 10px 0; font-size: 1.2rem; color: #0f172a; font-weight: 700; }
        .gate-content p { margin: 0 0 20px 0; color: #64748b; font-size: 0.95rem; }
        .gate-content .btn {
            background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
            color: white;
            padding: 14px 32px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 700;
            display: inline-block;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(13,148,136,0.3);
        }
        .gate-content .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(13,148,136,0.4); }

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
            padding: 12px 20px;
        }
        .mobile-menu.active { display: flex; }
        .mobile-menu-link {
            padding: 10px 0;
            color: var(--color-text);
            text-decoration: none;
            border-bottom: 1px solid var(--color-border);
            font-size: 0.95rem;
        }
        .mobile-menu-link:last-child { border-bottom: none; }
        .mobile-menu-link:hover { color: var(--color-primary); }
        .mobile-menu-section { padding: 10px 0 8px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
        .mobile-menu-divider { height: 1px; background: var(--color-border); margin: 6px 0; }
        .mobile-menu-categories { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
        .mobile-menu-categories a { padding: 8px 0; color: var(--color-text); text-decoration: none; font-size: 0.9rem; }
        .mobile-menu-categories a:hover { color: var(--color-primary); }

        /* Nav Dropdown */
        .nav-dropdown { position: relative; }
        .nav-dropdown-toggle { display: flex; align-items: center; gap: 0.375rem; font-size: 0.9rem; color: var(--color-text-secondary); background: none; border: none; cursor: pointer; padding: 0; }
        .nav-dropdown-toggle:hover { color: var(--color-primary); }
        .nav-dropdown-toggle svg { width: 14px; height: 14px; transition: transform 0.2s ease; }
        .nav-dropdown.open .nav-dropdown-toggle svg { transform: rotate(180deg); }
        .nav-dropdown-menu { position: absolute; top: calc(100% + 0.75rem); left: 50%; transform: translateX(-50%); min-width: 180px; background: rgba(255, 255, 255, 0.98); backdrop-filter: blur(12px); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12); padding: 0.5rem 0; opacity: 0; visibility: hidden; transition: opacity 0.15s ease, visibility 0.15s ease; z-index: 1000; }
        .nav-dropdown.open .nav-dropdown-menu { opacity: 1; visibility: visible; }
        .nav-dropdown-menu a { display: block; padding: 0.625rem 1rem; color: var(--color-text-secondary); text-decoration: none; font-size: 0.9rem; transition: background 0.15s ease, color 0.15s ease; }
        .nav-dropdown-menu a:hover { background: #f8fafc; color: var(--color-text); }
        .nav-dropdown-more { position: relative; }
        .nav-dropdown-more > a { display: flex; align-items: center; justify-content: space-between; }
        .nav-dropdown-more > a svg { width: 12px; height: 12px; }
        .nav-dropdown-submenu { position: absolute; left: 100%; top: 0; min-width: 160px; background: rgba(255, 255, 255, 0.98); backdrop-filter: blur(12px); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12); padding: 0.5rem 0; opacity: 0; visibility: hidden; transition: opacity 0.15s ease, visibility 0.15s ease; }
        .nav-dropdown-more:hover .nav-dropdown-submenu { opacity: 1; visibility: visible; }

        /* Footer */
        .site-footer { padding: 48px 24px; border-top: 1px solid var(--color-border); background: #fff; }
        .site-footer .footer-container { max-width: 1200px; margin: 0 auto; }
        .site-footer .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 32px; }
        .site-footer .footer-brand { }
        .site-footer .footer-brand-name { font-weight: 700; font-size: 1.125rem; color: var(--color-text); margin-bottom: 8px; }
        .site-footer .footer-tagline { font-size: 0.875rem; color: var(--color-text-secondary); line-height: 1.5; }
        .site-footer .footer-column h4 { font-size: 0.75rem; font-weight: 600; color: var(--color-text); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
        .site-footer .footer-column ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .site-footer .footer-column a { font-size: 0.875rem; color: var(--color-text-secondary); text-decoration: none; }
        .site-footer .footer-column a:hover { color: var(--color-primary); }
        .site-footer .footer-bottom { padding-top: 24px; border-top: 1px solid var(--color-border); text-align: center; }
        .site-footer .footer-bottom p { font-size: 0.75rem; color: var(--color-text-tertiary); margin: 0; }

        @media (max-width: 768px) {
            .seo-page { padding-left: 16px; padding-right: 16px; padding-bottom: 48px; }
            .seo-header { margin: 0 -16px 36px -16px; padding: 40px 16px 32px; }
            .seo-header h1 { font-size: 1.75rem; }
            .seo-header .meta { font-size: 0.9rem; gap: 10px 14px; }
            .category-badge { padding: 6px 14px; font-size: 0.8rem; }
            .seo-grid { grid-template-columns: 1fr; gap: 16px; }
            .seo-card { padding: 22px; overflow: hidden; border-radius: 14px; }
            .stat-value { font-size: 2.25rem; }
            .brand-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
            .brand-chip { padding: 12px 14px; border-radius: 8px; }
            .filings-table { min-width: 550px; }
            .filings-table th, .filings-table td { padding: 12px 14px; font-size: 0.85rem; }
            .bar-label { width: 55px; font-size: 0.75rem; }
            .bar-container { height: 28px; margin: 0 10px; }
            .bar-value { width: 45px; font-size: 0.8rem; }
            .related-links { margin-top: 40px; padding-top: 28px; }
            .related-links a { padding: 7px 14px; font-size: 0.8rem; margin-right: 8px; }
            .nav-links { display: none; }
            .mobile-menu-btn { display: flex; }
            .gate-content { padding: 24px 28px; margin: 0 16px; }
            .gate-content h3 { font-size: 1.1rem; }
            .gate-content .btn { padding: 12px 24px; font-size: 0.9rem; }
            .site-footer .footer-grid { grid-template-columns: 1fr 1fr; gap: 32px; }
            .site-footer .footer-brand { grid-column: 1 / -1; text-align: center; }
        }
        @media (max-width: 480px) {
            .seo-header h1 { font-size: 1.5rem; }
            .seo-header .meta { gap: 8px 12px; }
            .brand-grid { grid-template-columns: 1fr; }
            .brand-chip { padding: 12px 14px; }
            .brand-chip .count { padding: 3px 8px; }
            .meta-stats { gap: 6px; }
            .meta-line { font-size: 0.85rem; }
            .seo-card h2 { font-size: 0.65rem; }
            .stat-value { font-size: 2rem; }
        }
    </style>
</head>
<body>
    <nav class="nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">BevAlc Intelligence</a>
            <div class="nav-links">
                <a href="/" class="nav-home">Home</a>
                <a href="/database.html">Database</a>
                <div class="nav-dropdown" id="browse-dropdown">
                    <button class="nav-dropdown-toggle" onclick="toggleDropdown('browse-dropdown')">
                        Browse
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="nav-dropdown-menu">
                        <a href="/whiskey/">Whiskey</a>
                        <a href="/tequila/">Tequila</a>
                        <a href="/vodka/">Vodka</a>
                        <a href="/gin/">Gin</a>
                        <a href="/rum/">Rum</a>
                        <a href="/wine/">Wine</a>
                        <a href="/beer/">Beer</a>
                        <div class="nav-dropdown-more">
                            <a href="#">More <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></a>
                            <div class="nav-dropdown-submenu">
                                <a href="/brandy/">Brandy</a>
                                <a href="/liqueur/">Liqueur</a>
                                <a href="/cocktails/">Cocktails</a>
                                <a href="/other/">Other</a>
                            </div>
                        </div>
                    </div>
                </div>
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
            <div class="mobile-menu-divider"></div>
            <span class="mobile-menu-section">Browse Categories</span>
            <div class="mobile-menu-categories">
                <a href="/whiskey/">Whiskey</a>
                <a href="/wine/">Wine</a>
                <a href="/tequila/">Tequila</a>
                <a href="/beer/">Beer</a>
                <a href="/vodka/">Vodka</a>
                <a href="/rum/">Rum</a>
                <a href="/gin/">Gin</a>
                <a href="/brandy/">Brandy</a>
                <a href="/liqueur/">Liqueur</a>
                <a href="/cocktails/">Cocktails</a>
            </div>
        </div>
    </nav>
    <main class="seo-page">
        ${content}
    </main>
    <footer class="site-footer">
        <div class="footer-container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <div class="footer-brand-name">BevAlc Intelligence</div>
                    <p class="footer-tagline">Track every TTB label approval. The industry's most comprehensive COLA database.</p>
                </div>
                <div class="footer-column">
                    <h4>Categories</h4>
                    <ul>
                        <li><a href="/whiskey/">Whiskey</a></li>
                        <li><a href="/tequila/">Tequila</a></li>
                        <li><a href="/vodka/">Vodka</a></li>
                        <li><a href="/gin/">Gin</a></li>
                        <li><a href="/rum/">Rum</a></li>
                        <li><a href="/wine/">Wine</a></li>
                        <li><a href="/beer/">Beer</a></li>
                        <li><a href="/brandy/">Brandy</a></li>
                        <li><a href="/liqueur/">Liqueur</a></li>
                        <li><a href="/cocktails/">Cocktails</a></li>
                        <li><a href="/other/">Other</a></li>
                    </ul>
                </div>
                <div class="footer-column">
                    <h4>Resources</h4>
                    <ul>
                        <li><a href="/database.html">Search Database</a></li>
                        <li><a href="/glossary.html">Glossary</a></li>
                        <li><a href="/#pricing">Pricing</a></li>
                    </ul>
                </div>
                <div class="footer-column">
                    <h4>Legal</h4>
                    <ul>
                        <li><a href="/legal.html#terms">Terms of Service</a></li>
                        <li><a href="/legal.html#privacy">Privacy Policy</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; ${new Date().getFullYear()} BevAlc Intelligence. All rights reserved.</p>
            </div>
        </div>
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

        // Dropdown toggle
        function toggleDropdown(id) {
            const dropdown = document.getElementById(id);
            const isOpen = dropdown.classList.contains('open');
            document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
            if (!isOpen) dropdown.classList.add('open');
        }
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.nav-dropdown')) {
                document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
            }
        });

        // Check Pro status and unlock content
        (function() {
            function unlockContent() {
                document.querySelectorAll('.seo-blur').forEach(el => el.classList.remove('seo-blur'));
                document.querySelectorAll('.pro-overlay').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.pro-locked').forEach(el => el.classList.remove('pro-locked'));
                document.querySelectorAll('.page-paywall').forEach(el => el.classList.remove('page-paywall'));
                // Remove email gate on company/brand pages for Pro users
                document.querySelectorAll('.gate-overlay').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.gated-table').forEach(el => el.classList.remove('gated-table'));
                // Replace "Upgrade" badges with actual signal values for Pro users
                document.querySelectorAll('td[data-signal] .signal-upgrade').forEach(el => {
                    const signal = el.closest('td').dataset.signal;
                    if (signal) {
                        const signalClasses = {
                            'NEW_COMPANY': 'signal-new-company',
                            'NEW_BRAND': 'signal-new-brand',
                            'NEW_SKU': 'signal-new-sku',
                            'REFILE': 'signal-refile'
                        };
                        const signalLabels = {
                            'NEW_COMPANY': 'New Company',
                            'NEW_BRAND': 'New Brand',
                            'NEW_SKU': 'New SKU',
                            'REFILE': 'Refile'
                        };
                        const span = document.createElement('span');
                        span.className = 'signal-badge ' + (signalClasses[signal] || 'signal-refile');
                        span.textContent = signalLabels[signal] || signal;
                        el.replaceWith(span);
                    }
                });
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

    try {
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
        // Run queries in parallel for better performance
        const [brandsResult, categoriesResult, recentResult, dbaResult] = await Promise.all([
            env.DB.prepare(`
                SELECT brand_name, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                WHERE ca.company_id = ?
                GROUP BY brand_name
                ORDER BY cnt DESC
                LIMIT 20
            `).bind(company.id).all(),

            env.DB.prepare(`
                SELECT class_type_code, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                WHERE ca.company_id = ?
                GROUP BY class_type_code
                ORDER BY cnt DESC
                LIMIT 10
            `).bind(company.id).all(),

            env.DB.prepare(`
                SELECT ttb_id, brand_name, fanciful_name, class_type_code, approval_date, signal, state, co.company_name as filing_entity
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                WHERE ca.company_id = ?
                ORDER BY COALESCE(co.year, 9999) DESC, COALESCE(co.month, 99) DESC, COALESCE(co.day, 99) DESC, CASE co.signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 ELSE 5 END, co.ttb_id DESC
                LIMIT 10
            `).bind(company.id).all(),

            env.DB.prepare(`
                SELECT dba_name FROM (
                    SELECT TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1)) as dba_name,
                           ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(SUBSTR(raw_name, 1, INSTR(raw_name, ',') - 1))) ORDER BY raw_name) as rn
                    FROM company_aliases
                    WHERE company_id = ? AND raw_name LIKE '%,%'
                ) WHERE rn = 1
                ORDER BY dba_name
                LIMIT 10
            `).bind(company.id).all()
        ]);

        brands = brandsResult.results || [];
        categories = categoriesResult.results || [];
        recentFilings = recentResult.results || [];
        dbaNames = (dbaResult.results || []).map(r => r.dba_name).filter(n => n && n.length > 0);
    } else {
        // Virtual company - search directly by company_name pattern
        // Run queries in parallel for better performance
        const companyName = company.canonical_name;

        const [brandsResult, categoriesResult, recentResult] = await Promise.all([
            env.DB.prepare(`
                SELECT brand_name, COUNT(*) as cnt
                FROM colas
                WHERE company_name = ?
                GROUP BY brand_name
                ORDER BY cnt DESC
                LIMIT 20
            `).bind(companyName).all(),

            env.DB.prepare(`
                SELECT class_type_code, COUNT(*) as cnt
                FROM colas
                WHERE company_name = ?
                GROUP BY class_type_code
                ORDER BY cnt DESC
                LIMIT 10
            `).bind(companyName).all(),

            env.DB.prepare(`
                SELECT ttb_id, brand_name, fanciful_name, class_type_code, approval_date, signal, state, company_name as filing_entity
                FROM colas
                WHERE company_name = ?
                ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, COALESCE(day, 99) DESC, CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 ELSE 5 END, ttb_id DESC
                LIMIT 10
            `).bind(companyName).all()
        ]);

        brands = brandsResult.results || [];
        categories = categoriesResult.results || [];
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

    // Get earliest filing year for this company
    let earliestYear = null;
    if (hasCompanyId) {
        const yearResult = await env.DB.prepare(`
            SELECT MIN(year) as earliest_year
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ? AND year IS NOT NULL
        `).bind(company.id).first();
        earliestYear = yearResult?.earliest_year || null;
    } else {
        const yearResult = await env.DB.prepare(`
            SELECT MIN(year) as earliest_year
            FROM colas
            WHERE company_name = ? AND year IS NOT NULL
        `).bind(company.canonical_name).first();
        earliestYear = yearResult?.earliest_year || null;
    }
    company.first_filing = earliestYear;

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

    // Get TTB permits for this company
    let permits = [];
    if (hasCompanyId) {
        const permitsResult = await env.DB.prepare(`
            SELECT permit_number, industry_type, city, state, is_new
            FROM permits
            WHERE company_id = ?
            ORDER BY industry_type
        `).bind(company.id).all();
        permits = permitsResult.results || [];
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
        .map(c => ({ ...c, pct: totalCatFilings > 0 ? Math.round((c.count / totalCatFilings) * 100) : 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    // Build brand-focused HTML
    const topBrandNames = brands.slice(0, 5).map(b => b.brand_name);
    const brandListText = topBrandNames.length > 0
        ? topBrandNames.slice(0, -1).join(', ') + (topBrandNames.length > 1 ? ' and ' : '') + topBrandNames[topBrandNames.length - 1]
        : '';

    const title = `${company.display_name} Brands & Portfolio`;

    // SEO-optimized meta description (max 155 chars)
    // Template: "[Company Name]: [X] product filings since [earliest year], [Y] brands, based in [City, State]. See their full portfolio and latest launches."
    let metaDesc = `${company.display_name}: ${formatNumber(company.total_filings)} product filings`;
    if (earliestYear) metaDesc += ` since ${earliestYear}`;
    metaDesc += `, ${formatNumber(brands.length)}+ brands`;
    if (primaryLocation) metaDesc += `, based in ${primaryLocation}`;
    metaDesc += `. See their full portfolio and latest launches.`;
    // Truncate intelligently if over 155 chars
    if (metaDesc.length > 155) {
        metaDesc = `${company.display_name}: ${formatNumber(company.total_filings)} filings, ${formatNumber(brands.length)}+ brands. See their full portfolio.`;
    }
    const description = metaDesc;

    // Schema markup with address if available
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": company.canonical_name,
        "url": `${BASE_URL}/company/${slug}`,
        "description": `Beverage alcohol company with ${formatNumber(company.total_filings)} product filings and ${formatNumber(brands.length)}+ brands`,
        ...(primaryLocation && {
            "address": {
                "@type": "PostalAddress",
                "addressRegion": primaryLocation
            }
        }),
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
                <p style="margin-top: 16px;"><a href="/glossary.html#signals" style="color: #5eead4; font-weight: 500; text-decoration: none; font-size: 0.9rem;">Learn how to use our data →</a></p>
            </div>
        </header>

        <div>
            <div>
                <section class="seo-card" style="margin-bottom: 32px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
                    <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                        ${escapeHtml(company.display_name)} is a beverage alcohol company with <strong>${formatNumber(company.total_filings)}</strong> TTB COLA filings.
                        ${brands.length > 0 ? `Their portfolio includes brands such as <strong>${brands.slice(0, 3).map(b => escapeHtml(b.brand_name)).join('</strong>, <strong>')}</strong>${brands.length > 3 ? `, <strong>${escapeHtml(brands[3].brand_name)}</strong>` : ''}${brands.length > 4 ? `, and more` : ''}.` : ''}
                        ${categoryBars.length > 0 ? `The company primarily operates in the <strong>${categoryBars.slice(0, 2).map(c => c.name.toLowerCase()).join('</strong> and <strong>')}</strong> ${categoryBars.length > 1 ? 'categories' : 'category'}.` : ''}
                    </p>
                    ${permits.length > 0 ? (() => {
                        // Group permits by type and count
                        const permitCounts = {};
                        let hasNew = false;
                        for (const p of permits) {
                            if (!permitCounts[p.industry_type]) {
                                permitCounts[p.industry_type] = { count: 0, hasNew: false };
                            }
                            permitCounts[p.industry_type].count++;
                            if (p.is_new) {
                                permitCounts[p.industry_type].hasNew = true;
                                hasNew = true;
                            }
                        }
                        const permitTypes = Object.entries(permitCounts).map(([type, data]) => ({
                            type,
                            count: data.count,
                            hasNew: data.hasNew,
                            label: type === 'Distilled Spirits Plant' ? 'Distillery' : type === 'Wine Producer' ? 'Winery' : type === 'Importer (Alcohol)' ? 'Importer' : type === 'Wholesaler (Alcohol)' ? 'Wholesaler' : type,
                            bg: type === 'Distilled Spirits Plant' ? '#fef3c7' : type === 'Wine Producer' ? '#fce7f3' : type === 'Importer (Alcohol)' ? '#dbeafe' : '#e2e8f0',
                            color: type === 'Distilled Spirits Plant' ? '#92400e' : type === 'Wine Producer' ? '#9d174d' : type === 'Importer (Alcohol)' ? '#1e40af' : '#475569'
                        }));
                        return `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 0.85rem; color: #64748b; font-weight: 500;">Federal Permits:</span>
                            ${permitTypes.map(p => `
                                <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: ${p.bg}; color: ${p.color}; border-radius: 4px; font-size: 0.8rem; font-weight: 500;">
                                    ${p.label}${p.count > 1 ? ` (${p.count})` : ''}
                                    ${p.hasNew ? '<span style="margin-left: 4px; padding: 1px 4px; background: #22c55e; color: white; border-radius: 2px; font-size: 0.65rem;">NEW</span>' : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                    `;
                    })() : ''}

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
                    <div class="gated-table">
                        <div class="table-wrapper">
                            <table class="filings-table">
                                <thead>
                                    <tr>
                                        <th>Brand</th>
                                        <th>Product</th>
                                        <th>Filing Entity</th>
                                        <th>Approved</th>
                                        <th>Signal</th>
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
                                            <td data-signal="${f.signal || ''}"><a href="/#pricing" class="signal-badge signal-upgrade" style="background: #0d9488; color: white; text-decoration: none;">Upgrade</a></td>
                                        </tr>
                                    `}).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="gate-overlay">
                            <div class="gate-content">
                                <h3>Sign Up to View All Filings</h3>
                                <p>Get free access to ${escapeHtml(company.display_name)}'s complete filing history</p>
                                <a href="/#signup" class="btn">Get Free Access</a>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="related-links">
                    <h3>Related Companies</h3>
                    ${relatedCompanies.map(c => `<a href="/company/${c.slug}">${escapeHtml(c.canonical_name)}</a>`).join('')}
                </div>
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
    } catch (error) {
        console.error(`Company page error for ${slug}:`, error.message);
        return new Response(`Error loading company page: ${error.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain', ...headers }
        });
    }
}

// Brand Page Handler
async function handleBrandPage(path, env, headers) {
    const slug = path.replace('/brand/', '').replace(/\/$/, '');

    if (!slug) {
        return new Response('Not Found', { status: 404 });
    }

    try {
    // Fast lookup via brand_slugs table with fallback for slug variations
    let brandResult = await env.DB.prepare(`
        SELECT brand_name, filing_count as cnt FROM brand_slugs WHERE slug = ?
    `).bind(slug).first();

    // Fallback: try alternate slug formats for "&" brands
    // New format uses "and" (oak-and-eden), old format used hyphen (oak-eden)
    if (!brandResult && slug.includes('-and-')) {
        const altSlug = slug.replace(/-and-/g, '-');
        brandResult = await env.DB.prepare(`
            SELECT brand_name, filing_count as cnt FROM brand_slugs WHERE slug = ?
        `).bind(altSlug).first();
    }

    if (!brandResult) {
        return new Response('Brand not found', { status: 404 });
    }

    // Find ALL brand_name variations that normalize to the same slug
    // This handles cases like "BURIAL BEER CO" vs "BURIAL BEER CO." vs "BURIAL BEER CO., LLC"
    const baseName = brandResult.brand_name.replace(/[.,]+$/, ''); // Remove trailing . or ,
    const brandVariantsResult = await env.DB.prepare(`
        SELECT DISTINCT brand_name FROM colas
        WHERE brand_name = ?
           OR brand_name LIKE ? || '.%'
           OR brand_name LIKE ? || ',%'
           OR brand_name = ? || '.'
           OR brand_name = ? || ','
        LIMIT 50
    `).bind(baseName, baseName, baseName, baseName, baseName).all();

    const brandVariants = brandVariantsResult.results?.map(r => r.brand_name) || [brandResult.brand_name];
    const placeholders = brandVariants.map(() => '?').join(',');

    // Get actual filing count from colas for ALL variants
    const actualCount = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas WHERE brand_name IN (${placeholders})
    `).bind(...brandVariants).first();

    const brand = {
        brand_name: brandResult.brand_name,
        cnt: actualCount?.cnt || brandResult.cnt
    };

    // Get ALL companies for this brand (brand names can be used by multiple companies)
    const companiesResult = await env.DB.prepare(`
        SELECT co.company_name, c.canonical_name, c.slug, COUNT(*) as filing_count
        FROM colas co
        LEFT JOIN company_aliases ca ON co.company_name = ca.raw_name
        LEFT JOIN companies c ON ca.company_id = c.id
        WHERE co.brand_name IN (${placeholders})
        GROUP BY COALESCE(c.id, co.company_name)
        ORDER BY COUNT(*) DESC
        LIMIT 10
    `).bind(...brandVariants).all();
    const companies = companiesResult.results || [];
    const companyResult = companies.length > 0 ? companies[0] : null;

    // Get category for this brand
    const categoryResult = await env.DB.prepare(`
        SELECT class_type_code, COUNT(*) as cnt
        FROM colas WHERE brand_name IN (${placeholders})
        GROUP BY class_type_code
        ORDER BY cnt DESC
        LIMIT 1
    `).bind(...brandVariants).first();
    const primaryCategory = categoryResult ? getCategory(categoryResult.class_type_code) : 'Other';

    // Get filing timeline by year
    const timelineResult = await env.DB.prepare(`
        SELECT year, COUNT(*) as cnt,
               SUM(CASE WHEN signal = 'NEW_SKU' THEN 1 ELSE 0 END) as new_skus
        FROM colas WHERE brand_name IN (${placeholders})
        GROUP BY year
        ORDER BY year DESC
        LIMIT 5
    `).bind(...brandVariants).all();
    const timeline = timelineResult.results || [];

    // Get recent products
    // Use year/month/day for proper chronological sorting (newest first)
    const productsResult = await env.DB.prepare(`
        SELECT ttb_id, fanciful_name, class_type_code, approval_date, signal
        FROM colas WHERE brand_name IN (${placeholders})
        ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) DESC, CASE signal WHEN 'NEW_COMPANY' THEN 1 WHEN 'NEW_BRAND' THEN 2 WHEN 'NEW_SKU' THEN 3 WHEN 'REFILE' THEN 4 ELSE 5 END, ttb_id DESC
        LIMIT 15
    `).bind(...brandVariants).all();
    const products = productsResult.results || [];

    // Skip related brands query for performance - would require precomputed table
    const relatedBrands = [];

    const maxTimeline = Math.max(...timeline.map(t => t.cnt), 1);
    const earliestYear = timeline.length > 0 ? Math.min(...timeline.map(t => t.year).filter(y => y)) : null;

    const title = `${brand.brand_name} Brand Filings & Portfolio`;

    // SEO-optimized meta description (max 155 chars)
    // Template: "[Brand]: X product filings since [year], [category]. By [company]. See product timeline and latest launches."
    let metaDesc = `${brand.brand_name}: ${formatNumber(brand.cnt)} product ${brand.cnt === 1 ? 'filing' : 'filings'}`;
    if (earliestYear) metaDesc += ` since ${earliestYear}`;
    metaDesc += `, ${primaryCategory}`;
    if (companyResult?.canonical_name) metaDesc += `. By ${companyResult.canonical_name}`;
    metaDesc += `. See product timeline and latest launches.`;
    if (metaDesc.length > 155) {
        metaDesc = `${brand.brand_name}: ${formatNumber(brand.cnt)} ${primaryCategory} ${brand.cnt === 1 ? 'filing' : 'filings'}. See product timeline.`;
    }
    const description = metaDesc;

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
                ${companies.length > 1 ? `
                <div class="multi-company-notice" style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
                    <strong>Note:</strong> This brand name is used by ${companies.length} different companies:
                    <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px;">
                        ${companies.map(c => c.slug ? `<a href="/company/${c.slug}" style="background: #fff; padding: 4px 12px; border-radius: 4px; text-decoration: none; border: 1px solid #e5e7eb;">${escapeHtml(c.canonical_name || c.company_name)} (${c.filing_count})</a>` : `<span style="background: #fff; padding: 4px 12px; border-radius: 4px; border: 1px solid #e5e7eb;">${escapeHtml(c.company_name)} (${c.filing_count})</span>`).join('')}
                    </div>
                </div>
                ` : ''}
                <div class="meta">
                    ${companyResult?.canonical_name ? `<span>by <a href="/company/${companyResult.slug}">${escapeHtml(companyResult.canonical_name)}</a></span>` : (companyResult?.company_name ? `<span>by ${escapeHtml(companyResult.company_name)}</span>` : '')}
                    <span class="category-badge">${escapeHtml(primaryCategory)}</span>
                    <span><strong>${formatNumber(brand.cnt)}</strong> Filings</span>
                </div>
                <p style="margin-top: 16px;"><a href="/glossary.html#signals" style="color: #5eead4; font-weight: 500; text-decoration: none; font-size: 0.9rem;">Learn how to use our data →</a></p>
            </div>
        </header>

        <div>
            <div>
                <div class="seo-grid">
                    <div class="seo-card">
                        <h2>Total Filings</h2>
                        <div class="stat-value">${formatNumber(brand.cnt)}</div>
                        <div class="stat-label">TTB COLA applications</div>
                    </div>
                    <div class="seo-card">
                        <h2>Primary Category</h2>
                        <div class="stat-value" style="font-size: 1.75rem;">${escapeHtml(primaryCategory)}</div>
                        <div class="stat-label"><a href="/${getCategorySlug(primaryCategory)}/">View ${primaryCategory.toLowerCase()} trends →</a></div>
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
                    <div class="gated-table">
                        <div class="table-wrapper">
                            <table class="filings-table">
                                <thead>
                                    <tr>
                                        <th>Brand Name</th>
                                        <th>Fanciful Name</th>
                                        <th>Type</th>
                                        <th>Approved</th>
                                        <th>Signal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${products.map(p => `
                                        <tr>
                                            <td><strong>${escapeHtml(brand.brand_name)}</strong></td>
                                            <td>${escapeHtml(p.fanciful_name || '-')}</td>
                                            <td>${escapeHtml(getCategory(p.class_type_code))}</td>
                                            <td>${escapeHtml(p.approval_date)}</td>
                                            <td data-signal="${p.signal || ''}"><a href="/#pricing" class="signal-badge signal-upgrade" style="background: #0d9488; color: white; text-decoration: none;">Upgrade</a></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="gate-overlay">
                            <div class="gate-content">
                                <h3>Sign Up to View All Products</h3>
                                <p>Get free access to ${escapeHtml(brand.brand_name)}'s complete product history</p>
                                <a href="/#signup" class="btn">Get Free Access</a>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="related-links">
                    <h3>More ${primaryCategory} Brands</h3>
                    ${relatedBrands.map(b => `<a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>`).join('')}
                </div>
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
    } catch (error) {
        console.error(`Brand page error for ${slug}:`, error.message);
        return new Response(`Error loading brand page: ${error.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain', ...headers }
        });
    }
}

// Hub Page Handler - Main category landing pages for SEO
async function handleHubPage(categorySlug, env, headers) {
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

    // Check Pro status from cookie
    const cookieHeader = headers.get('cookie') || '';
    const isPro = cookieHeader.includes('bevalc_pro=1');

    // Category-specific intro copy with internal links
    const introCopy = {
        'Whiskey': 'Track American whiskey, <a href="/database?category=Whiskey&subcategory=Bourbon" class="intro-link">bourbon</a>, <a href="/database?category=Whiskey&subcategory=Rye" class="intro-link">rye</a>, and <a href="/database?category=Whiskey&subcategory=Scotch" class="intro-link">scotch</a> labels filed with the TTB. We index every COLA filing weekly. Find new distilleries before your competitors, monitor brand launches, and track the fastest-growing producers in the category.',
        'Tequila': 'Monitor <a href="/database?category=Tequila" class="intro-link">tequila</a> and <a href="/database?category=Tequila&subcategory=Mezcal" class="intro-link">mezcal</a> labels from the TTB database. New agave brands are launching faster than ever. See who\'s filing, what they\'re releasing, and which producers are scaling up.',
        'Vodka': 'Search <a href="/database?category=Vodka" class="intro-link">vodka</a> label approvals including <a href="/database?category=Vodka&subcategory=Flavored%20Vodka" class="intro-link">flavored</a> varieties. Track new distilleries entering the market, monitor competitor releases, and discover emerging premium brands.',
        'Gin': 'Browse <a href="/database?category=Gin" class="intro-link">gin</a> label filings including <a href="/database?category=Gin&subcategory=Flavored%20Gin" class="intro-link">flavored</a> styles. The craft gin boom continues. Find new producers, track botanical innovations, and monitor market entrants.',
        'Rum': 'Track <a href="/database?category=Rum" class="intro-link">rum</a> labels including <a href="/database?category=Rum&subcategory=Flavored%20Rum" class="intro-link">flavored</a> varieties. Monitor Caribbean imports, discover domestic craft distilleries, and follow the growing premium rum segment.',
        'Brandy': 'Search brandy filings including <a href="/database?category=Brandy&subcategory=Cognac" class="intro-link">cognac</a>, <a href="/database?category=Brandy&subcategory=Armagnac" class="intro-link">armagnac</a>, and <a href="/database?category=Brandy&subcategory=Grappa%20%26%20Pisco" class="intro-link">pisco</a>. Track luxury imports, find American craft producers, and monitor the expanding brandy market.',
        'Wine': 'Search <a href="/database?category=Wine" class="intro-link">wine</a> label approvals spanning domestic and imported wines, <a href="/database?category=Wine&subcategory=Sparkling%20Wine" class="intro-link">sparkling</a>, and <a href="/database?category=Wine&subcategory=Fortified%20Wine" class="intro-link">vermouth</a>. Track new wineries entering the US market and monitor competitor releases.',
        'Beer': 'Browse <a href="/database?category=Beer" class="intro-link">beer</a> label filings from craft breweries to major producers. Track new brewery launches, monitor seasonal releases, and discover emerging brands.',
        'Liqueur': 'Track <a href="/database?category=Liqueur" class="intro-link">liqueur</a> and cordial label filings. Monitor new product launches and discover trending flavor profiles.',
        'Cocktails': 'Monitor <a href="/database?category=Cocktails" class="intro-link">ready-to-drink cocktail</a> and RTD filings, the fastest-growing spirits category. Track new brands, monitor major producer launches, and discover emerging players.',
        'Other': 'Browse specialty spirit filings including neutral spirits, grain spirits, and unique products that don\'t fit standard categories. Find niche producers and specialty products.'
    };

    // Subcategory links - use exact subcategory names from ttb-categories.json
    const subcategories = {
        'Whiskey': [
            { name: 'Bourbon', subcategory: 'Bourbon' },
            { name: 'Rye', subcategory: 'Rye' },
            { name: 'Scotch', subcategory: 'Scotch' },
            { name: 'Irish', subcategory: 'Irish Whiskey' },
            { name: 'Canadian', subcategory: 'Canadian Whisky' },
            { name: 'Blended', subcategory: 'Blended Whiskey' },
            { name: 'Flavored', subcategory: 'Flavored Whiskey' }
        ],
        'Tequila': [
            { name: 'Mezcal', subcategory: 'Mezcal' }
        ],
        'Vodka': [
            { name: 'Flavored', subcategory: 'Flavored Vodka' },
            { name: 'Unflavored', subcategory: 'Unflavored Vodka' }
        ],
        'Gin': [
            { name: 'London Dry', subcategory: 'London Dry Gin' },
            { name: 'Flavored', subcategory: 'Flavored Gin' }
        ],
        'Rum': [
            { name: 'White', subcategory: 'White Rum' },
            { name: 'Gold/Aged', subcategory: 'Gold/Aged Rum' },
            { name: 'Flavored', subcategory: 'Flavored Rum' }
        ],
        'Brandy': [
            { name: 'Cognac', subcategory: 'Cognac' },
            { name: 'Armagnac', subcategory: 'Armagnac' },
            { name: 'American', subcategory: 'American Brandy' },
            { name: 'Fruit', subcategory: 'Fruit Brandy' }
        ],
        'Wine': [
            { name: 'Sparkling', subcategory: 'Sparkling Wine' },
            { name: 'Fortified', subcategory: 'Fortified Wine' },
            { name: 'Sake', subcategory: 'Sake' },
            { name: 'Fruit', subcategory: 'Fruit Wine' }
        ],
        'Beer': [
            { name: 'Ale', subcategory: 'Ale' },
            { name: 'Lager', subcategory: 'Lager/Beer' },
            { name: 'Stout', subcategory: 'Stout' },
            { name: 'Malt Liquor', subcategory: 'Malt Liquor' }
        ],
        'Liqueur': [
            { name: 'Cream', subcategory: 'Cream Liqueurs' },
            { name: 'Herbal', subcategory: 'Herbal Liqueurs' },
            { name: 'Coffee', subcategory: 'Coffee Liqueurs' },
            { name: 'Schnapps', subcategory: 'Schnapps' }
        ],
        'Cocktails': [],
        'Other': []
    };

    // Use indexed category column for fast queries + cached stats for slow aggregations

    try {
        // Calculate date ranges
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // First, check for cached stats (precomputed daily for heavy categories like Wine/Beer)
        const cachedStats = await env.DB.prepare(
            `SELECT total_filings, week_filings, month_new_companies, top_companies, top_brands, updated_at
             FROM category_stats WHERE category = ?`
        ).bind(category).first();

        let totalFilings, newThisWeek, newCompaniesMonth, topCompanies, topBrands;

        if (cachedStats) {
            // Use cached stats for the slow aggregations
            totalFilings = cachedStats.total_filings || 0;
            newThisWeek = cachedStats.week_filings || 0;
            newCompaniesMonth = cachedStats.month_new_companies || 0;
            topCompanies = JSON.parse(cachedStats.top_companies || '[]');
            topBrands = JSON.parse(cachedStats.top_brands || '[]');
        } else {
            // No cache - run live queries (slower for large categories)
            const [totalResult, weekResult, newCompaniesResult, topCompaniesResult, topBrandsResult] = await Promise.all([
                env.DB.prepare(`SELECT COUNT(*) as cnt FROM colas WHERE category = ?`).bind(category).first(),
                env.DB.prepare(`
                    SELECT COUNT(*) as cnt FROM colas
                    WHERE category = ?
                    AND (year > ? OR (year = ? AND month > ?) OR (year = ? AND month = ? AND day >= ?))
                `).bind(category, weekAgo.getFullYear(), weekAgo.getFullYear(), weekAgo.getMonth() + 1, weekAgo.getFullYear(), weekAgo.getMonth() + 1, weekAgo.getDate()).first(),
                env.DB.prepare(`
                    SELECT COUNT(DISTINCT company_name) as cnt FROM colas
                    WHERE signal = 'NEW_COMPANY' AND category = ?
                    AND (year > ? OR (year = ? AND month >= ?))
                `).bind(category, monthAgo.getFullYear(), monthAgo.getFullYear(), monthAgo.getMonth() + 1).first(),
                env.DB.prepare(`
                    SELECT c.canonical_name, c.slug, COUNT(*) as cnt,
                           MAX(co.year * 10000 + co.month * 100 + co.day) as last_filing
                    FROM colas co
                    JOIN company_aliases ca ON co.company_name = ca.raw_name
                    JOIN companies c ON ca.company_id = c.id
                    WHERE co.category = ?
                    GROUP BY c.id
                    ORDER BY cnt DESC
                    LIMIT 20
                `).bind(category).all(),
                env.DB.prepare(`
                    SELECT brand_name, COUNT(*) as cnt
                    FROM colas
                    WHERE category = ?
                    GROUP BY brand_name
                    ORDER BY cnt DESC
                    LIMIT 20
                `).bind(category).all()
            ]);
            totalFilings = totalResult?.cnt || 0;
            newThisWeek = weekResult?.cnt || 0;
            newCompaniesMonth = newCompaniesResult?.cnt || 0;
            topCompanies = topCompaniesResult?.results || [];
            topBrands = topBrandsResult?.results || [];
        }

        // Recent filings - Pro users see real-time, free users see 60+ day old data
        let recentFilings;
        if (isPro) {
            // Pro users: real-time data
            recentFilings = await env.DB.prepare(`
                SELECT co.ttb_id, co.brand_name, co.fanciful_name, co.company_name, co.signal, co.approval_date,
                       c.slug as company_slug, c.canonical_name
                FROM colas co
                LEFT JOIN company_aliases ca ON co.company_name = ca.raw_name
                LEFT JOIN companies c ON ca.company_id = c.id
                WHERE co.category = ?
                ORDER BY co.year DESC, co.month DESC, co.day DESC
                LIMIT 25
            `).bind(category).all();
        } else {
            // Free users: 60-day delayed data
            const delayDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
            const delayYear = delayDate.getFullYear();
            const delayMonth = delayDate.getMonth() + 1;
            const delayDay = delayDate.getDate();
            recentFilings = await env.DB.prepare(`
                SELECT co.ttb_id, co.brand_name, co.fanciful_name, co.company_name, co.signal, co.approval_date,
                       c.slug as company_slug, c.canonical_name
                FROM colas co
                LEFT JOIN company_aliases ca ON co.company_name = ca.raw_name
                LEFT JOIN companies c ON ca.company_id = c.id
                WHERE co.category = ?
                AND (co.year < ? OR (co.year = ? AND co.month < ?) OR (co.year = ? AND co.month = ? AND co.day <= ?))
                ORDER BY co.year DESC, co.month DESC, co.day DESC
                LIMIT 25
            `).bind(category, delayYear, delayYear, delayMonth, delayYear, delayMonth, delayDay).all();
        }

        const filings = recentFilings?.results || [];

        // Signal badge helper - renders both states, JS will show correct one
        const getSignalBadge = (signal) => {
            const badges = {
                'NEW_COMPANY': { class: 'signal-new-company', label: 'New Company' },
                'NEW_BRAND': { class: 'signal-new-brand', label: 'New Brand' },
                'NEW_SKU': { class: 'signal-new-sku', label: 'New SKU' },
                'REFILE': { class: 'signal-refile', label: 'Refile' }
            };
            const badge = badges[signal];
            if (!badge) return '<span class="signal-badge">-</span>';
            // Render both locked (free) and unlocked (pro) states
            return `<span class="signal-badge-wrapper" data-signal="${signal}">
                <span class="signal-badge ${badge.class} signal-unlocked" style="display:none;">${badge.label}</span>
                <span class="signal-badge signal-locked" onclick="showUpgradeModal()">PRO</span>
            </span>`;
        };

        // Format last filing date from numeric
        const formatLastFiling = (num) => {
            if (!num) return '-';
            const year = Math.floor(num / 10000);
            const month = Math.floor((num % 10000) / 100);
            const day = num % 100;
            return `${month}/${day}/${year}`;
        };

        const title = `${category} Brands & Companies`;
        const description = `Search ${formatNumber(totalFilings)}+ ${category.toLowerCase()} labels in the TTB database. ${newThisWeek} new filings this week. Track new ${category.toLowerCase()} brands, companies, and product launches.`;
        const canonicalUrl = `${BASE_URL}/${categorySlug}/`;

        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": `${category} Brands & Companies | TTB Label Database`,
            "description": description,
            "url": canonicalUrl,
            "numberOfItems": totalFilings,
            "provider": {
                "@type": "Organization",
                "name": "BevAlc Intelligence",
                "url": BASE_URL
            }
        };

        const content = `
            <div class="hub-page">
                <header class="hub-header">
                    <div class="hub-header-inner">
                        <nav class="hub-breadcrumb">
                            <a href="/">Home</a>
                            <span class="breadcrumb-sep">/</span>
                            <span>${category}</span>
                        </nav>
                        <h1>${category} Brands & Companies</h1>
                        <p class="hub-intro">${introCopy[category]}</p>
                        ${subcategories[category]?.length ? `
                            <div class="hub-subcategories">
                                <span class="subcategory-label">Browse by type:</span>
                                ${subcategories[category].map(sub =>
                                    `<a href="/database?category=${encodeURIComponent(category)}&subcategory=${encodeURIComponent(sub.subcategory)}">${sub.name}</a>`
                                ).join(' <span class="subcategory-sep">|</span> ')}
                            </div>
                        ` : ''}
                    </div>
                </header>

                <div class="hub-stats">
                    <a href="/database?category=${encodeURIComponent(category)}" class="hub-stat hub-stat-link">
                        <div class="hub-stat-value">${formatNumber(totalFilings)}</div>
                        <div class="hub-stat-label">Total Filings</div>
                    </a>
                    <a href="/database?category=${encodeURIComponent(category)}&period=7d" class="hub-stat hub-stat-link">
                        <div class="hub-stat-value">${formatNumber(newThisWeek)}</div>
                        <div class="hub-stat-label">New This Week</div>
                    </a>
                    <a href="/database?category=${encodeURIComponent(category)}&signal=NEW_COMPANY" class="hub-stat hub-stat-link">
                        <div class="hub-stat-value">${formatNumber(newCompaniesMonth)}</div>
                        <div class="hub-stat-label">New Companies (30d)</div>
                    </a>
                </div>
                <div class="hub-data-updated">Data updated: ${(cachedStats?.updated_at ? new Date(cachedStats.updated_at) : now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</div>

                <div class="hub-upgrade-banner" id="upgrade-banner">
                    <span class="upgrade-icon">🔔</span>
                    <span>Get alerts when new ${category.toLowerCase()} brands file.</span>
                    <a href="/#pricing" class="upgrade-link">Upgrade to Pro →</a>
                </div>

                <section class="hub-section">
                    <h2>Recent ${category} Filings${isPro ? '' : ' <span class="delay-badge">60-day delay</span>'}</h2>
                    <div class="hub-table-wrapper">
                        <table class="hub-table">
                            <thead>
                                <tr>
                                    <th>Brand</th>
                                    <th>Product</th>
                                    <th>Company</th>
                                    <th>Signal</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filings.map(f => `
                                    <tr>
                                        <td><a href="/brand/${makeSlug(f.brand_name)}"><strong>${escapeHtml(f.brand_name)}</strong></a></td>
                                        <td>${escapeHtml(f.fanciful_name || '-')}</td>
                                        <td>${f.company_slug
                                            ? `<a href="/company/${f.company_slug}">${escapeHtml(f.canonical_name || f.company_name)}</a>`
                                            : escapeHtml(f.company_name)
                                        }</td>
                                        <td>${getSignalBadge(f.signal)}</td>
                                        <td>${escapeHtml(f.approval_date || '-')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="hub-export-row">
                        <button class="btn-export locked" id="export-csv-btn" onclick="handleExportClick()">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                            </svg>
                            Export CSV<span class="pro-tag" id="export-pro-tag">PRO</span>
                        </button>
                    </div>
                    <div class="hub-table-cta">
                        <a href="/database?category=${encodeURIComponent(category)}" class="btn-secondary">View All ${category} Filings →</a>
                    </div>
                </section>

                <div class="hub-grid">
                    <section class="hub-section">
                        <h2>Top ${category} Companies</h2>
                        <table class="hub-table hub-table-compact">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Company</th>
                                    <th>Filings</th>
                                    <th>Last Filing</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${topCompanies.map((c, i) => `
                                    <tr>
                                        <td>${i + 1}</td>
                                        <td><a href="/company/${c.slug}">${escapeHtml(c.canonical_name)}</a></td>
                                        <td>${formatNumber(c.cnt)}</td>
                                        <td>${formatLastFiling(c.last_filing)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </section>

                    <section class="hub-section">
                        <h2>Top ${category} Brands</h2>
                        <table class="hub-table hub-table-compact">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Brand</th>
                                    <th>Filings</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${topBrands.map((b, i) => `
                                    <tr>
                                        <td>${i + 1}</td>
                                        <td><a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a></td>
                                        <td>${formatNumber(b.cnt)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </section>
                </div>

                <section class="hub-cta">
                    <h2>Track New ${category} Brands Weekly</h2>
                    <p>Get notified when new distilleries and brands file with the TTB. Free weekly report delivered every Sunday.</p>
                    <a href="/#hero-email" class="btn-primary">Get Free Weekly Report</a>
                </section>

                <nav class="hub-category-nav">
                    <h3>Browse All Categories</h3>
                    <div class="hub-category-links">
                        ${Object.entries(categoryMap).map(([slug, name]) =>
                            slug === categorySlug
                                ? `<span class="current">${name}</span>`
                                : `<a href="/${slug}/">${name}</a>`
                        ).join('')}
                    </div>
                </nav>
            </div>

            <!-- Upgrade Modal -->
            <div class="upgrade-modal-overlay" id="upgrade-modal">
                <div class="upgrade-modal">
                    <h3>Unlock Pro Features</h3>
                    <p>Get full access to signal data, CSV exports, watchlist alerts, and more. See which brands are NEW vs refiles at a glance.</p>
                    <a href="/#pricing" class="btn-primary">View Pro Plans</a>
                    <button class="btn-close" onclick="closeUpgradeModal()">Maybe later</button>
                </div>
            </div>

            <script>
                // Unlock Pro content
                function unlockProContent() {
                    // Show real signals, hide locked badges
                    document.querySelectorAll('.signal-unlocked').forEach(el => el.style.display = 'inline-block');
                    document.querySelectorAll('.signal-locked').forEach(el => el.style.display = 'none');

                    // Update export button
                    const exportBtn = document.getElementById('export-csv-btn');
                    if (exportBtn) {
                        exportBtn.classList.remove('locked');
                        const proTag = document.getElementById('export-pro-tag');
                        if (proTag) proTag.style.display = 'none';
                    }

                    // Hide upgrade banner
                    const banner = document.getElementById('upgrade-banner');
                    if (banner) banner.classList.add('hidden');
                }

                // Check Pro status and update UI
                (function() {
                    // Check cookie first (fastest)
                    if (document.cookie.includes('bevalc_pro=1')) {
                        unlockProContent();
                        return;
                    }

                    // Check localStorage for user data
                    try {
                        const user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');
                        if (user.isPro || user.is_pro) {
                            // Set cookie and reload to get real-time data
                            document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
                            window.location.reload();
                            return;
                        }

                        // If we have an email, verify Pro status via API
                        if (user.email) {
                            fetch('https://bevalc-api.mac-rowan.workers.dev/api/stripe/customer-status?email=' + encodeURIComponent(user.email))
                                .then(r => r.json())
                                .then(data => {
                                    if (data.is_pro) {
                                        // Update localStorage
                                        user.isPro = true;
                                        user.is_pro = true;
                                        localStorage.setItem('bevalc_user', JSON.stringify(user));
                                        // Set cookie and reload to get real-time data
                                        document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
                                        window.location.reload();
                                    }
                                })
                                .catch(() => {});
                        }
                    } catch (e) {}
                })();

                function showUpgradeModal() {
                    document.getElementById('upgrade-modal').classList.add('active');
                }

                function closeUpgradeModal() {
                    document.getElementById('upgrade-modal').classList.remove('active');
                }

                function handleExportClick() {
                    const isPro = document.cookie.includes('bevalc_pro=1');
                    if (isPro) {
                        // Redirect to database with export params
                        window.location.href = '/database?category=${encodeURIComponent(category)}&export=csv';
                    } else {
                        showUpgradeModal();
                    }
                }

                // Close modal on overlay click
                document.getElementById('upgrade-modal').addEventListener('click', function(e) {
                    if (e.target === this) closeUpgradeModal();
                });
            </script>
        `;

        // Custom styles for hub pages
        const hubStyles = `
            .hub-page { padding-bottom: 48px; }

            .hub-breadcrumb {
                margin-bottom: 16px;
                font-size: 0.875rem;
                color: rgba(255,255,255,0.6);
            }
            .hub-breadcrumb a {
                color: rgba(255,255,255,0.7);
                text-decoration: none;
                transition: color 0.15s ease;
            }
            .hub-breadcrumb a:hover {
                color: #5eead4;
            }
            .hub-breadcrumb .breadcrumb-sep {
                margin: 0 8px;
                color: rgba(255,255,255,0.4);
            }

            .hub-header {
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                margin: 0 -24px 0 -24px;
                padding: 48px 24px 40px;
                position: relative;
            }
            .hub-header::before {
                content: '';
                position: absolute;
                top: 0; right: 0; bottom: 0; left: 0;
                background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
                opacity: 0.5;
            }
            .hub-header-inner { max-width: 900px; margin: 0 auto; position: relative; z-index: 1; text-align: center; }
            .hub-header h1 {
                font-family: var(--font-display);
                font-size: 2.5rem;
                color: #fff;
                margin-bottom: 16px;
                font-weight: 700;
            }
            .hub-intro {
                color: rgba(255,255,255,0.8);
                font-size: 1.1rem;
                line-height: 1.6;
                max-width: 700px;
                margin: 0 auto 20px;
            }
            .hub-subcategories {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                align-items: center;
                gap: 8px;
                margin-top: 16px;
            }
            .subcategory-label { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-right: 8px; }
            .hub-subcategories a {
                color: #5eead4;
                text-decoration: none;
                font-size: 0.9rem;
                font-weight: 500;
            }
            .hub-subcategories a:hover { color: #99f6e4; text-decoration: underline; }
            .subcategory-sep { color: rgba(255,255,255,0.3); }

            .hub-stats {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 24px;
                max-width: 800px;
                margin: -24px auto 40px;
                padding: 0 24px;
                position: relative;
                z-index: 2;
            }
            .hub-stat {
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 24px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            }
            .hub-stat-value {
                font-size: 2rem;
                font-weight: 700;
                color: #0f172a;
                line-height: 1;
            }
            .hub-stat-label {
                font-size: 0.85rem;
                color: #64748b;
                margin-top: 8px;
            }

            .hub-section { margin-bottom: 40px; }
            .hub-section h2 {
                font-size: 1.25rem;
                font-weight: 600;
                color: #0f172a;
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 2px solid #e2e8f0;
            }
            .delay-badge {
                display: inline-block;
                font-size: 0.7rem;
                font-weight: 500;
                color: #d97706;
                background: #fef3c7;
                padding: 2px 8px;
                border-radius: 4px;
                margin-left: 8px;
                vertical-align: middle;
            }

            .hub-table-wrapper { overflow-x: auto; }
            .hub-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.9rem;
            }
            .hub-table th {
                text-align: left;
                padding: 12px 16px;
                background: #f8fafc;
                color: #64748b;
                font-weight: 600;
                font-size: 0.8rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                border-bottom: 1px solid #e2e8f0;
            }
            .hub-table td {
                padding: 12px 16px;
                border-bottom: 1px solid #f1f5f9;
                color: #334155;
            }
            .hub-table tr:hover td { background: #f8fafc; }
            .hub-table a { color: #0d9488; text-decoration: none; }
            .hub-table a:hover { text-decoration: underline; }
            .hub-table strong { color: #0f172a; }

            .hub-table-compact { font-size: 0.85rem; }
            .hub-table-compact th, .hub-table-compact td { padding: 10px 12px; }

            .hub-table-cta {
                margin-top: 16px;
                text-align: center;
            }
            .btn-secondary {
                display: inline-block;
                padding: 10px 20px;
                background: #f1f5f9;
                color: #0f172a;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 500;
                font-size: 0.9rem;
                transition: background 0.2s;
            }
            .btn-secondary:hover { background: #e2e8f0; }

            .signal-badge {
                display: inline-block;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.03em;
            }
            .signal-new-company { background: #dcfce7; color: #166534; }
            .signal-new-brand { background: #dbeafe; color: #1e40af; }
            .signal-new-sku { background: #fef9c3; color: #854d0e; }
            .signal-refile { background: #f1f5f9; color: #64748b; }

            .hub-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 32px;
                margin-bottom: 40px;
            }

            .hub-cta {
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                margin: 48px -24px;
                padding: 48px 24px;
                text-align: center;
                border-radius: 0;
            }
            .hub-cta h2 { color: #fff; font-size: 1.5rem; margin-bottom: 12px; border: none; padding: 0; }
            .hub-cta p { color: rgba(255,255,255,0.7); margin-bottom: 20px; }
            .btn-primary {
                display: inline-block;
                padding: 14px 28px;
                background: #0d9488;
                color: #fff;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 1rem;
                transition: background 0.2s;
            }
            .btn-primary:hover { background: #0f766e; }

            .hub-category-nav {
                padding-top: 32px;
                border-top: 1px solid #e2e8f0;
            }
            .hub-category-nav h3 {
                font-size: 0.9rem;
                color: #64748b;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 16px;
            }
            .hub-category-links {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
            }
            .hub-category-links a, .hub-category-links .current {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 0.9rem;
                text-decoration: none;
            }
            .hub-category-links a {
                background: #f1f5f9;
                color: #334155;
            }
            .hub-category-links a:hover { background: #e2e8f0; }
            .hub-category-links .current {
                background: #0d9488;
                color: #fff;
                font-weight: 500;
            }

            /* Stat links */
            .hub-stat-link {
                text-decoration: none;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .hub-stat-link:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(0,0,0,0.12);
            }

            /* Data updated timestamp */
            .hub-data-updated {
                text-align: center;
                color: #64748b;
                font-size: 0.85rem;
                margin-bottom: 24px;
            }

            /* Upgrade banner */
            .hub-upgrade-banner {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                background: linear-gradient(90deg, #fef3c7 0%, #fef9c3 100%);
                border: 1px solid #fbbf24;
                border-radius: 8px;
                padding: 16px 24px;
                margin-bottom: 32px;
                font-size: 0.95rem;
                color: #92400e;
            }
            .hub-upgrade-banner.hidden { display: none; }
            .upgrade-icon { font-size: 1.2rem; }
            .upgrade-link {
                color: #d97706;
                font-weight: 600;
                text-decoration: none;
                white-space: nowrap;
            }
            .upgrade-link:hover { text-decoration: underline; }

            /* Intro links */
            .intro-link {
                color: #5eead4;
                text-decoration: none;
                font-weight: 500;
            }
            .intro-link:hover { color: #99f6e4; text-decoration: underline; }

            /* Signal badge locked state */
            .signal-locked {
                background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
                color: #fff;
                cursor: pointer;
                transition: transform 0.15s, box-shadow 0.15s;
            }
            .signal-locked:hover {
                transform: scale(1.05);
                box-shadow: 0 2px 8px rgba(13, 148, 136, 0.4);
            }

            /* Export CSV button */
            .hub-export-row {
                display: flex;
                justify-content: flex-end;
                margin-top: 16px;
                gap: 12px;
            }
            .btn-export {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 16px;
                background: #0d9488;
                color: #fff;
                text-decoration: none;
                border-radius: 6px;
                font-weight: 500;
                font-size: 0.85rem;
                cursor: pointer;
                border: none;
                transition: background 0.2s;
            }
            .btn-export:hover { background: #0f766e; }
            .btn-export.locked {
                background: #64748b;
            }
            .btn-export.locked:hover { background: #475569; }
            .pro-tag {
                background: #fbbf24;
                color: #78350f;
                font-size: 0.65rem;
                padding: 2px 5px;
                border-radius: 3px;
                font-weight: 700;
                margin-left: 4px;
            }

            /* Upgrade modal */
            .upgrade-modal-overlay {
                display: none;
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6);
                z-index: 1000;
                align-items: center;
                justify-content: center;
            }
            .upgrade-modal-overlay.active { display: flex; }
            .upgrade-modal {
                background: #fff;
                border-radius: 12px;
                padding: 32px;
                max-width: 420px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }
            .upgrade-modal h3 {
                font-size: 1.5rem;
                color: #0f172a;
                margin-bottom: 12px;
            }
            .upgrade-modal p {
                color: #64748b;
                margin-bottom: 24px;
                line-height: 1.5;
            }
            .upgrade-modal .btn-primary {
                width: 100%;
                margin-bottom: 12px;
            }
            .upgrade-modal .btn-close {
                background: transparent;
                border: none;
                color: #64748b;
                cursor: pointer;
                font-size: 0.9rem;
            }
            .upgrade-modal .btn-close:hover { color: #0f172a; }

            @media (max-width: 768px) {
                .hub-header h1 { font-size: 1.75rem; }
                .hub-intro { font-size: 1rem; }
                .hub-stats { grid-template-columns: 1fr; gap: 16px; margin-top: -16px; }
                .hub-stat { padding: 20px; }
                .hub-stat-value { font-size: 1.5rem; }
                .hub-grid { grid-template-columns: 1fr; }
                .hub-table { font-size: 0.8rem; }
                .hub-table th, .hub-table td { padding: 10px 12px; }
                .signal-badge { padding: 3px 8px; font-size: 0.7rem; }
                .hub-upgrade-banner {
                    flex-direction: column;
                    text-align: center;
                    gap: 8px;
                }
                .hub-export-row { justify-content: center; }
            }
        `;

        const fullContent = `<style>${hubStyles}</style>${content}`;

        return new Response(getPageLayout(title, description, fullContent, jsonLd, canonicalUrl), {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=300',  // 5 min cache - stats update after precompute
                'Vary': 'Cookie'
            }
        });
    } catch (error) {
        console.error(`Hub page error for ${categorySlug}:`, error.message);
        return new Response(`Error loading hub page: ${error.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
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

    try {
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
                            <div class="bar-label">${monthNames[(m.month || 1) - 1] || 'Unknown'}</div>
                            <div class="bar-container"><div class="bar-fill" style="width: ${maxMonthly > 0 ? Math.round((m.cnt / maxMonthly) * 100) : 0}%"></div></div>
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
    } catch (error) {
        console.error(`Category page error for ${categorySlug}/${year}:`, error.message);
        return new Response(`Error loading category page: ${error.message}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain', ...headers }
        });
    }
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

// ==========================================
// ENHANCEMENT HANDLERS
// ==========================================

// Enhancements are always paid - Pro users get discounted credit packs
// Free: $10 for 5 credits ($2.00 each) or $25 for 15 credits ($1.67 each)
// Pro:  $10 for 8 credits ($1.25 each) or $25 for 20 credits ($1.25 each)

async function handleEnhance(request, env) {
    const body = await request.json();
    const { company_id, company_name, brand_name, email } = body;

    if (!company_id || !company_name) {
        return { success: false, error: 'Missing company_id or company_name' };
    }

    if (!email) {
        return { success: false, error: 'Authentication required' };
    }

    // Check if already enhanced (cache hit)
    const existing = await env.DB.prepare(
        'SELECT * FROM company_enhancements WHERE company_id = ?'
    ).bind(company_id).first();

    if (existing && existing.enhanced_at) {
        // Check if expired (90 days)
        const enhancedDate = new Date(existing.enhanced_at);
        const now = new Date();
        const daysSince = (now - enhancedDate) / (1000 * 60 * 60 * 24);

        if (daysSince < 90) {
            const tearsheet = parseEnhancement(existing);
            // Add fresh recent filings for PDF report
            tearsheet.recent_filings = await fetchRecentFilings(company_id, env);
            return {
                success: true,
                cached: true,
                tearsheet
            };
        }
    }

    // Check user credits (all users need purchased credits now)
    const creditCheck = await checkUserCredits(email, env);
    if (!creditCheck.canEnhance) {
        return {
            success: false,
            error: 'payment_required',
            credits: creditCheck.credits,
            is_pro: creditCheck.is_pro
        };
    }

    // Run enhancement (synchronous for Phase 1)
    try {
        const tearsheet = await runEnhancement(company_id, company_name, brand_name, env);

        // Only cache and charge if we got useful information
        const hasUsefulInfo = tearsheet.summary || tearsheet.website?.url;

        if (hasUsefulInfo) {
            // Save to cache
            await saveEnhancement(company_id, company_name, tearsheet, email, env);

            // Deduct credit
            await deductCredit(email, company_id, env);
        }

        return {
            success: true,
            cached: false,
            tearsheet,
            charged: hasUsefulInfo
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleEnhanceStatus(url, env) {
    // For Phase 1, enhancements are synchronous, so this just checks cache
    const companyId = url.searchParams.get('company_id');
    if (!companyId) {
        return { success: false, error: 'Missing company_id' };
    }

    const existing = await env.DB.prepare(
        'SELECT * FROM company_enhancements WHERE company_id = ?'
    ).bind(companyId).first();

    if (existing) {
        const tearsheet = parseEnhancement(existing);
        // Add fresh recent filings for PDF report
        tearsheet.recent_filings = await fetchRecentFilings(companyId, env);
        return {
            success: true,
            status: 'complete',
            tearsheet
        };
    }

    return { success: true, status: 'not_found' };
}

async function handleGetCredits(url, env) {
    const email = url.searchParams.get('email')?.toLowerCase();
    if (!email) {
        return { success: false, error: 'Missing email' };
    }

    const user = await env.DB.prepare(
        'SELECT is_pro, enhancement_credits FROM user_preferences WHERE LOWER(email) = ?'
    ).bind(email).first();

    if (!user) {
        return {
            success: true,
            credits: 0,
            is_pro: false
        };
    }

    return {
        success: true,
        credits: user.enhancement_credits || 0,
        is_pro: user.is_pro === 1
    };
}

async function handleCompanyLookup(url, env) {
    const companyName = url.searchParams.get('name');
    if (!companyName) {
        return { success: false, error: 'Missing company name' };
    }

    const result = await env.DB.prepare(
        'SELECT company_id FROM company_aliases WHERE raw_name = ?'
    ).bind(companyName).first();

    if (!result) {
        return { success: false, error: 'Company not found' };
    }

    return { success: true, company_id: result.company_id };
}

async function checkUserCredits(email, env) {
    const user = await env.DB.prepare(
        'SELECT is_pro, enhancement_credits FROM user_preferences WHERE email = ?'
    ).bind(email).first();

    if (!user) {
        return { canEnhance: false, credits: 0, is_pro: false };
    }

    // All users need purchased credits (Pro just gets better pricing on packs)
    const credits = user.enhancement_credits || 0;
    return {
        canEnhance: credits > 0,
        credits,
        is_pro: user.is_pro === 1
    };
}

async function deductCredit(email, companyId, env) {
    // Deduct purchased credit
    await env.DB.prepare(
        'UPDATE user_preferences SET enhancement_credits = enhancement_credits - 1 WHERE email = ?'
    ).bind(email).run();

    // Log the transaction
    await env.DB.prepare(`
        INSERT INTO enhancement_credits (email, type, amount, company_id, created_at)
        VALUES (?, 'used', -1, ?, datetime('now'))
    `).bind(email, companyId).run();
}

async function runEnhancement(companyId, companyName, clickedBrandName, env) {
    // Get current date parts for comparison
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Run D1 queries in parallel for speed - use JOINs instead of subqueries for performance
    const [stats, states, categories, brands, recentFilings, existingWebsite] = await Promise.all([
        // Filing statistics - use indexed year/month/day columns
        env.DB.prepare(`
            SELECT
                COUNT(*) as total_filings,
                MIN(co.year * 10000 + co.month * 100 + COALESCE(co.day, 1)) as first_filing_sort,
                MAX(co.year * 10000 + co.month * 100 + COALESCE(co.day, 1)) as last_filing_sort,
                COUNT(CASE WHEN co.year > ? OR (co.year = ? AND co.month >= ?) THEN 1 END) as last_12_months,
                COUNT(CASE WHEN co.year > ? OR (co.year = ? AND co.month >= ?) THEN 1 END) as last_month
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
        `).bind(
            oneYearAgo.getFullYear(), oneYearAgo.getFullYear(), oneYearAgo.getMonth() + 1,
            oneMonthAgo.getFullYear(), oneMonthAgo.getFullYear(), oneMonthAgo.getMonth() + 1,
            companyId
        ).first(),

        // State distribution - only get 2-letter state codes
        env.DB.prepare(`
            SELECT DISTINCT UPPER(TRIM(co.state)) as state
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            AND co.state IS NOT NULL
            AND LENGTH(TRIM(co.state)) = 2
            ORDER BY state
        `).bind(companyId).all(),

        // Category breakdown
        env.DB.prepare(`
            SELECT co.class_type_code, COUNT(*) as count
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            GROUP BY co.class_type_code
            ORDER BY count DESC
            LIMIT 5
        `).bind(companyId).all(),

        // Brand portfolio
        env.DB.prepare(`
            SELECT co.brand_name, COUNT(*) as filings
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            GROUP BY co.brand_name
            ORDER BY filings DESC
            LIMIT 10
        `).bind(companyId).all(),

        // Recent filings for PDF report - use indexed columns
        env.DB.prepare(`
            SELECT co.brand_name, co.fanciful_name, co.approval_date, co.status, co.signal
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ?
            ORDER BY co.year DESC, co.month DESC, COALESCE(co.day, 1) DESC
            LIMIT 10
        `).bind(companyId).all(),

        // Check for existing website
        env.DB.prepare(`
            SELECT website_url FROM company_websites WHERE company_id = ?
        `).bind(companyId).first()
    ]);

    // Calculate trend - handle dormant companies
    let trend = 'stable';
    if (stats) {
        if (stats.last_12_months === 0) {
            trend = 'dormant';
        } else if (stats.last_12_months > 0) {
            const avgMonthly = stats.last_12_months / 12;
            if (stats.last_month > avgMonthly * 1.5) {
                trend = 'growing';
            } else if (stats.last_month < avgMonthly * 0.5) {
                trend = 'declining';
            }
        }
    }

    // Convert sorted dates back to readable format (YYYYMMDD number -> MM/DD/YYYY)
    const formatDate = (sortDate) => {
        if (!sortDate) return null;
        const str = String(sortDate);
        if (str.length < 8) return null;
        const y = str.substring(0, 4);
        const m = str.substring(4, 6);
        const d = str.substring(6, 8);
        return `${parseInt(m)}/${parseInt(d)}/${y}`;
    };

    // Prepare data for enhancement
    // Use clicked brand name first, then fall back to top brand by filing count
    const topBrandFromDb = brands?.results?.[0]?.brand_name || '';
    const primaryBrand = clickedBrandName || topBrandFromDb || 'Unknown';
    const brandList = brands?.results?.map(b => b.brand_name).slice(0, 5).join(', ') || 'Unknown';
    const categoryList = categories?.results?.map(c => c.class_type_code).join(', ') || 'Unknown';
    const stateList = states?.results?.map(s => s.state).join(', ') || 'Unknown';

    // Get industry hint for better search results
    const industryHint = getIndustryHint(categoryList);

    // NEW FLOW: Google CSE + Deep Crawl + Claude Summarization
    let websiteUrl = existingWebsite?.website_url || null;
    let summary = null;
    let news = [];
    let social = null;

    try {
        // Step 1: Discover URLs using Google Custom Search
        console.log(`[Enhancement] Discovering URLs for: ${companyName}`);
        const discoveredUrls = await discoverCompanyUrls(companyName, primaryBrand, industryHint, env);

        // Use discovered website or existing one
        if (discoveredUrls.website && !websiteUrl) {
            websiteUrl = discoveredUrls.website;
        }
        console.log(`[Enhancement] Website found: ${websiteUrl || 'none'}`);

        // Step 2: Transform scraped pages into format expected by summary generator
        let websiteContent = null;
        if (discoveredUrls.scrapedPages && discoveredUrls.scrapedPages.length > 0) {
            const pages = discoveredUrls.scrapedPages;
            websiteContent = {
                homepage: null,
                aboutPage: null,
                contactPage: null,
                otherPages: []
            };

            for (const page of pages) {
                const urlLower = page.url.toLowerCase();
                if (urlLower === websiteUrl?.toLowerCase() || urlLower.endsWith('/') && urlLower.slice(0, -1) === websiteUrl?.toLowerCase()) {
                    websiteContent.homepage = page.content;
                } else if (urlLower.includes('/about') || urlLower.includes('/our-story') || urlLower.includes('/history')) {
                    websiteContent.aboutPage = page.content;
                } else if (urlLower.includes('/contact')) {
                    websiteContent.contactPage = page.content;
                } else {
                    websiteContent.otherPages.push(page.content);
                }
            }
            console.log(`[Enhancement] Website content: homepage=${!!websiteContent.homepage}, about=${!!websiteContent.aboutPage}, contact=${!!websiteContent.contactPage}, other=${websiteContent.otherPages.length}`);
        }

        // Step 3: Generate summary using Claude (no web_search - just text analysis)
        if (env.ANTHROPIC_API_KEY) {
            console.log(`[Enhancement] Generating summary with Claude...`);
            const claudeResult = await callClaudeForSummary(companyName, {
                totalFilings: stats?.total_filings || 0,
                firstFiling: formatDate(stats?.first_filing_sort),
                lastFiling: formatDate(stats?.last_filing_sort),
                last12Months: stats?.last_12_months || 0,
                trend,
                primaryBrand,
                brands: brandList,
                categories: categoryList,
                states: stateList
            }, discoveredUrls, websiteContent, env);

            summary = claudeResult.summary;
            console.log(`[Enhancement] Summary generated, confidence: ${claudeResult.confidence}`);
        } else {
            console.error('ANTHROPIC_API_KEY not set');
        }

        // Use discovered news and social directly
        news = discoveredUrls.news || [];
        social = discoveredUrls.social || null;

    } catch (e) {
        console.error('[Enhancement] Error in new flow:', e);
        // Continue with partial results
    }

    return {
        company_id: companyId,
        company_name: companyName,
        website: websiteUrl ? { url: websiteUrl, confidence: 'high' } : null,
        filing_stats: {
            total_filings: stats?.total_filings || 0,
            first_filing: formatDate(stats?.first_filing_sort),
            last_filing: formatDate(stats?.last_filing_sort),
            last_12_months: stats?.last_12_months || 0,
            last_month: stats?.last_month || 0,
            trend
        },
        distribution: {
            states: states?.results?.map(s => s.state).filter(s => s && s.length === 2) || []
        },
        brands: brands?.results?.map(b => ({ name: b.brand_name, filings: b.filings })) || [],
        categories: categories?.results?.reduce((acc, c) => {
            acc[c.class_type_code] = c.count;
            return acc;
        }, {}) || {},
        contacts: [],
        news,
        social: social || null,
        summary,
        recent_filings: recentFilings?.results?.map(f => ({
            brand: f.brand_name,
            product: f.fanciful_name,
            date: f.approval_date,
            status: f.status,
            signal: f.signal
        })) || []
    };
}

// ============================================================================
// NEW ENHANCEMENT FUNCTIONS (Google CSE + Deep Crawl)
// ============================================================================

// Rate limiting helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Single Google Custom Search query with rate limiting and retry
async function googleSearch(query, env, retryCount = 0) {
    if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID) {
        console.error('Google CSE credentials not configured');
        return [];
    }

    const maxRetries = 2;
    const baseDelay = 1500; // 1.5s between requests

    try {
        // Rate limit: wait before making request (longer delay on retries)
        const waitTime = baseDelay * (retryCount + 1);
        await delay(waitTime);

        console.log(`[Google] Searching: "${query}"${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', env.GOOGLE_CSE_API_KEY);
        url.searchParams.set('cx', env.GOOGLE_CSE_ID);
        url.searchParams.set('q', query);
        url.searchParams.set('num', '5');

        const response = await fetch(url.toString());

        // Retry on rate limit
        if (response.status === 429 && retryCount < maxRetries) {
            console.log(`[Google] Rate limited, retrying in ${(retryCount + 2) * 2}s...`);
            await delay((retryCount + 2) * 2000);
            return googleSearch(query, env, retryCount + 1);
        }

        if (!response.ok) {
            console.error('Google CSE error:', response.status);
            return [];
        }

        const data = await response.json();
        console.log(`[Google] Found ${data.items?.length || 0} results`);
        return data.items || [];
    } catch (e) {
        console.error('Google search failed:', e);
        return [];
    }
}

// ============================================================================
// WEBSITE DISCOVERY - Fetch actual page content for Claude to evaluate
// ============================================================================

// Fetch a webpage and extract text content (with retry for timeouts)
async function fetchPageContent(url, timeout = 10000, retryCount = 0) {
    const maxRetries = 1; // One retry for timeouts
    try {
        // Rate limit
        await delay(500);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        console.log(`[Fetch] Fetching: ${url}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            },
            redirect: 'follow'
        });
        clearTimeout(timeoutId);

        // Handle common errors
        if (response.status === 403 || response.status === 404 || response.status === 503) {
            console.log(`[Fetch] ${url} returned ${response.status}, skipping`);
            return null;
        }
        if (!response.ok) {
            console.log(`[Fetch] ${url} returned ${response.status}`);
            return null;
        }

        const html = await response.text();

        // Extract text content (strip HTML tags, scripts, styles)
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        console.log(`[Fetch] Got ${text.length} chars from ${url}`);
        return text.substring(0, 4000);
    } catch (e) {
        // Retry on timeout (aborted)
        if (e.name === 'AbortError' && retryCount < maxRetries) {
            console.log(`[Fetch] Timeout on ${url}, retrying with longer timeout...`);
            await delay(1000);
            return fetchPageContent(url, timeout + 5000, retryCount + 1);
        }
        console.log(`[Fetch] Failed ${url}: ${e.message}`);
        return null;
    }
}

// Scrape multiple pages from a confirmed website
async function scrapeWebsitePages(baseUrl, maxPages = 5) {
    try {
        const baseDomain = new URL(baseUrl).hostname;
        const results = [];

        // Fetch homepage first
        const homeContent = await fetchPageContent(baseUrl);
        if (homeContent) {
            results.push({ url: baseUrl, content: homeContent });
        }

        // Priority pages to try
        const priorityPaths = [
            '/about', '/about-us', '/about-us/', '/our-story',
            '/contact', '/contact-us',
            '/products', '/our-products', '/brands', '/our-brands',
            '/team', '/leadership', '/history'
        ];

        for (const path of priorityPaths) {
            if (results.length >= maxPages) break;

            try {
                const pageUrl = new URL(path, baseUrl).toString();
                const content = await fetchPageContent(pageUrl, 3000);
                if (content && content.length > 200) {
                    results.push({ url: pageUrl, content });
                }
            } catch (e) {
                continue;
            }
        }

        console.log(`[Scrape] Got ${results.length} pages from ${baseDomain}`);
        return results;
    } catch (e) {
        console.error(`[Scrape] Error: ${e.message}`);
        return [];
    }
}

// Have Claude parse company info from website content
async function parseCompanyInfo(companyName, websiteUrl, pageContents, env) {
    if (!env.ANTHROPIC_API_KEY || pageContents.length === 0) return null;

    const combinedContent = pageContents
        .map(p => `=== PAGE: ${p.url} ===\n${p.content}`)
        .join('\n\n')
        .substring(0, 12000);

    const prompt = `Extract company information from this website content for "${companyName}".

WEBSITE: ${websiteUrl}

CONTENT:
${combinedContent}

Extract the following (use null if not found, do not guess):
- Official company name
- Founded year
- Location/address
- Key people (founders, CEO, etc.)
- Product types/brands mentioned
- Company description (2-3 sentences)
- Contact email
- Phone number

Return JSON only:
{
  "company_name": "...",
  "founded": "...",
  "location": "...",
  "key_people": ["..."],
  "products": ["..."],
  "description": "...",
  "email": "...",
  "phone": "..."
}`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 500,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) return null;

        const result = await response.json();
        const text = result.content?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error('[Parse] Error:', e);
    }
    return null;
}

// ============================================================================
// SIMPLE ENHANCEMENT FLOW
// 1. Google search company names → collect all results
// 2. Claude picks website from Google results (just URL/title/snippet)
// 3. Scrape the selected website
// 4. Claude summarizes from scraped content
// ============================================================================

async function discoverCompanyUrls(companyName, brandName, industryHint, env) {
    // STEP 1: Parse company name into search terms
    // "Northland Spirits LLC, Pearlhead Distilling LLC" → ["Northland Spirits", "Pearlhead Distilling"]
    const nameParts = companyName
        .split(/\s*,\s*|\s+DBA\s+|\s+D\/B\/A\s+/i)
        .map(p => p
            .replace(/\b(LLC|Inc|Corp|Corporation|Company|Co|Ltd|Limited|L\.?L\.?C\.?|INC\.?|CORP\.?|LP|LLP|PLLC|PLC)\b\.?/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(p => p.length >= 3);

    const searchTerms = [...new Set(nameParts)]; // dedupe
    console.log(`[Enhancement] Company: "${companyName}"`);
    console.log(`[Enhancement] Search terms: ${searchTerms.map(t => `"${t}"`).join(', ')}`);
    console.log(`[Enhancement] Brand: "${brandName}", Industry: "${industryHint}"`);

    // STEP 2: Google search each term, collect all results
    const allResults = [];
    const seenUrls = new Set();

    for (const term of searchTerms.slice(0, 2)) { // Max 2 searches
        const results = await googleSearch(term, env);
        for (const r of results) {
            if (!seenUrls.has(r.link)) {
                seenUrls.add(r.link);
                allResults.push(r);
            }
        }
    }

    console.log(`[Enhancement] Google returned ${allResults.length} unique results`);

    // STEP 3: Extract social media URLs from results (no extra API call)
    let facebookUrl = null, instagramUrl = null, youtubeUrl = null;
    for (const r of allResults) {
        const url = r.link;
        if (url.includes('facebook.com/') && !facebookUrl && !url.includes('/posts/')) facebookUrl = url;
        if (url.includes('instagram.com/') && !instagramUrl && !url.includes('/p/')) instagramUrl = url;
        if (url.includes('youtube.com/') && !youtubeUrl && !url.includes('/watch?')) youtubeUrl = url;
    }

    // STEP 4: Format results for Claude (just URL, title, snippet - NO content fetching yet)
    const candidateList = allResults
        .filter(r => {
            const url = r.link.toLowerCase();
            // Skip obvious non-company sites
            if (url.includes('facebook.com') || url.includes('instagram.com') || url.includes('linkedin.com')) return false;
            if (url.includes('yelp.com') || url.includes('tripadvisor.com') || url.includes('yellowpages.com')) return false;
            if (url.includes('amazon.com') || url.includes('walmart.com') || url.includes('totalwine.com')) return false;
            if (url.includes('untappd.com') || url.includes('ratebeer.com') || url.includes('vivino.com')) return false;
            return true;
        })
        .slice(0, 10)
        .map((r, i) => `${i + 1}. ${r.link}\n   Title: ${r.title || 'No title'}\n   Snippet: ${r.snippet || 'No description'}`)
        .join('\n\n');

    if (!candidateList) {
        console.log('[Enhancement] No candidates after filtering');
        return { website: null, social: { facebook: facebookUrl, instagram: instagramUrl, youtube: youtubeUrl }, news: [], scrapedPages: [] };
    }

    // STEP 5: Claude picks the website (just from Google metadata, NO fetching)
    let websiteUrl = null;
    if (env.ANTHROPIC_API_KEY) {
        const prompt = `You are identifying the official website for a beverage alcohol company.

COMPANY: ${companyName}
BRAND: ${brandName}
INDUSTRY: ${industryHint}

Here are Google search results. Which one is most likely the company's OFFICIAL website?

${candidateList}

INSTRUCTIONS:
- Pick the URL that looks like the company's own website (not a retailer, directory, or news site)
- The domain often contains the company name or brand name
- Distilleries, wineries, breweries usually have their own .com site
- Importers/distributors may have less obvious domains but still have company sites
- If none look like an official company website, say "none"

Reply with ONLY the URL (e.g., "https://example.com") or "none". Nothing else.`;

        try {
            console.log('[Enhancement] Asking Claude to pick website...');
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 100,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            if (response.ok) {
                const result = await response.json();
                const text = (result.content?.[0]?.text || '').trim();
                if (text && text !== 'none' && text.startsWith('http')) {
                    websiteUrl = text;
                    console.log(`[Enhancement] Claude picked: ${websiteUrl}`);
                } else {
                    console.log(`[Enhancement] Claude said: ${text}`);
                }
            }
        } catch (e) {
            console.error('[Enhancement] Claude website selection failed:', e.message);
        }
    }

    // STEP 6: Scrape the selected website (NOW we fetch content)
    let scrapedPages = [];
    if (websiteUrl) {
        console.log(`[Enhancement] Scraping website: ${websiteUrl}`);
        scrapedPages = await scrapeWebsitePages(websiteUrl, 4);
        console.log(`[Enhancement] Scraped ${scrapedPages.length} pages`);
    }

    // STEP 7: News - just grab any news-looking results from Google (Claude will filter in summary)
    const newsArticles = allResults
        .filter(r => {
            const url = r.link.toLowerCase();
            const domain = new URL(r.link).hostname.toLowerCase();
            // Include news sites
            if (domain.includes('news') || url.includes('/news/') || url.includes('/article/')) return true;
            if (domain.includes('patch.com') || domain.includes('bizjournals')) return true;
            return false;
        })
        .slice(0, 3)
        .map(r => ({
            title: r.title,
            url: r.link,
            source: new URL(r.link).hostname.replace('www.', ''),
            snippet: r.snippet,
            date: null
        }));

    return {
        website: websiteUrl,
        social: { facebook: facebookUrl, instagram: instagramUrl, youtube: youtubeUrl },
        news: newsArticles,
        scrapedPages: scrapedPages
    };
}

// Claude evaluates candidates by reading actual page content
async function claudeSelectWebsite(companyName, brandName, candidates, env) {
    if (!candidates || candidates.length === 0) return null;
    if (!env.ANTHROPIC_API_KEY) return null;

    // Format candidates with actual page content
    const candidateList = candidates.map((c, i) =>
        `CANDIDATE ${i + 1}:
URL: ${c.url}
Domain: ${c.domain}
Page Title: ${c.title}
Page Content Preview:
${c.content}
---`
    ).join('\n\n');

    const prompt = `You are identifying the OFFICIAL company website for "${companyName}"${brandName ? ` (brand: "${brandName}")` : ''}.

I have fetched the actual content from several candidate websites. Review each one and determine which (if any) is the company's official website.

${candidateList}

CRITICAL - COMPANY NAMING CONVENTION:
Company names often contain MULTIPLE names separated by commas. These are ALL valid names for the SAME company:
- "Blue Meranti, Helmsman Imports, LLC" means "Helmsman Imports" IS the company
- "XYZ Trading, ABC Distributors, Inc" means "ABC Distributors" IS the company
A website matching ANY part of the comma-separated name is a CORRECT MATCH.

EVALUATION CRITERIA:
1. Does the domain match ANY part of the company name? (helmsmanimports.com matches "Blue Meranti, Helmsman Imports, LLC")
2. Does the page content describe a wine/spirits/beer business?
3. Does it look like a company homepage with products, about info, or contact details?
4. Is it NOT a directory, review site, retailer, or news article?

RESPOND WITH JSON ONLY:
- If you find a likely match: {"url": "https://...", "confidence": "high", "evidence": "brief reason"}
- If you find a possible match: {"url": "https://...", "confidence": "medium", "evidence": "brief reason"}
- If none match: {"url": null, "confidence": "low", "evidence": "why none match"}`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 200,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            console.error('[Website Selection] Claude API error:', response.status);
            return null;
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log(`[Website Selection] Claude result: ${JSON.stringify(parsed)}`);

            // Return URL if confidence is high or medium
            if (parsed.url && (parsed.confidence === 'high' || parsed.confidence === 'medium')) {
                return parsed.url;
            }
        }
        console.log('[Website Selection] No website selected by Claude');
        return null;
    } catch (e) {
        console.error('[Website Selection] Error:', e);
        return null;
    }
}

// Fetch and clean article content for validation
async function fetchArticleContent(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BevAlcIntelBot/1.0; +https://bevalcintel.com)'
            },
            redirect: 'follow'
        });

        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) return null;

        const html = await response.text();

        // Clean HTML - remove scripts, styles, nav, footer
        let text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();

        // Return first 1500 chars (enough to validate relevance)
        return text.substring(0, 1500);
    } catch (e) {
        console.error(`Failed to fetch article ${url}:`, e.message);
        return null;
    }
}

// Validate news articles using Claude - fetches actual content for accurate validation
async function validateNewsArticles(companyName, brandName, candidateNews, env) {
    if (!candidateNews || candidateNews.length === 0) {
        return [];
    }

    if (!env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY not set for news validation');
        return [];
    }

    // Fetch actual article content in parallel
    console.log(`[News Validation] Fetching content for ${candidateNews.length} articles...`);
    const articleContents = await Promise.all(
        candidateNews.map(n => fetchArticleContent(n.url))
    );

    // Build detailed article list with actual content
    const newsListText = candidateNews.map((n, i) => {
        const content = articleContents[i];
        return `ARTICLE ${i + 1}:
Title: "${n.title}"
Source: ${n.source}
URL: ${n.url}
Content Preview: ${content || 'Could not fetch content'}
---`;
    }).join('\n\n');

    const prompt = `You are a strict news article validator. Your job is to REJECT articles that are NOT about the target company, and extract publication dates from valid articles.

TARGET COMPANY: "${companyName}"
TARGET BRAND: "${brandName}"

I have fetched the actual content of these articles. Review each one carefully:

${newsListText}

STRICT VALIDATION RULES:
1. The article must EXPLICITLY mention "${companyName}" or "${brandName}" in the content
2. REJECT if the article is about a DIFFERENT company (e.g., "Big Grove Brewery" is NOT "Binary Barrel Distillery")
3. REJECT if only generic industry terms match (distillery, brewery, spirits, etc.)
4. REJECT if the company name is similar but not exact
5. REJECT if content could not be fetched
6. When in doubt, REJECT - it's better to show no news than wrong news

For each VALID article, extract the publication date from the content if possible (look for dates like "January 5, 2026", "Jan 5, 2026", "2026-01-05", etc.).

Return JSON only with this format:
{"relevant": [{"index": 1, "date": "2026-01-05"}, {"index": 2, "date": "2025-12-15"}]}

Use format YYYY-MM-DD for dates. If date cannot be determined, use null for date. If no articles are relevant, return {"relevant": []}.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 100,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            console.error('News validation API error:', response.status);
            return []; // Return empty on error - don't show potentially wrong news
        }

        const result = await response.json();
        const textContent = result.content?.[0]?.text || '';

        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const relevantItems = parsed.relevant || [];

            // Handle both old format (array of numbers) and new format (array of objects with index and date)
            let validatedNews = [];

            if (relevantItems.length > 0) {
                if (typeof relevantItems[0] === 'number') {
                    // Old format: array of indices
                    validatedNews = candidateNews.filter((_, i) => relevantItems.includes(i + 1));
                } else {
                    // New format: array of {index, date} objects
                    validatedNews = relevantItems.map(item => {
                        const article = candidateNews[item.index - 1];
                        if (article) {
                            // Use Claude-extracted date if available, otherwise keep original
                            return {
                                ...article,
                                date: item.date || article.date || null
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }
            }

            // Sort by date, newest first (articles without dates go to the end)
            validatedNews.sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;  // No date goes to end
                if (!b.date) return -1;
                // Parse dates and compare (newer first)
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                return dateB - dateA;  // Descending order (newest first)
            });

            console.log(`[News Validation] ${candidateNews.length} candidates -> ${validatedNews.length} validated`);
            return validatedNews;
        }
    } catch (e) {
        console.error('News validation failed:', e);
    }

    return []; // Return empty on error - don't show potentially wrong news
}

// Generate summary using Claude (no web_search - just text analysis)
async function callClaudeForSummary(companyName, filingData, discoveredUrls, websiteContent, env) {
    // Build the content sections
    let contentSections = [];

    if (websiteContent?.homepage) {
        contentSections.push(`HOMEPAGE CONTENT:\n${websiteContent.homepage}`);
    }
    if (websiteContent?.aboutPage) {
        contentSections.push(`ABOUT PAGE CONTENT:\n${websiteContent.aboutPage}`);
    }
    if (websiteContent?.contactPage) {
        contentSections.push(`CONTACT PAGE CONTENT:\n${websiteContent.contactPage}`);
    }
    if (websiteContent?.otherPages?.length > 0) {
        contentSections.push(`OTHER PAGE CONTENT:\n${websiteContent.otherPages.join('\n\n')}`);
    }

    const websiteContentText = contentSections.length > 0
        ? contentSections.join('\n\n---\n\n')
        : 'No website content available.';

    const newsText = discoveredUrls.news?.length > 0
        ? discoveredUrls.news.map(n => `- ${n.title} (${n.source}): ${n.snippet || ''}`).join('\n')
        : 'No news articles found.';

    const prompt = `You are writing a company intelligence summary for a beverage alcohol business report.

COMPANY: ${companyName}
PRIMARY BRAND: ${filingData.primaryBrand || 'Unknown'}
INDUSTRY: ${filingData.categories || 'Beverage alcohol'}

TTB FILING DATA:
- Total filings: ${filingData.totalFilings}
- First filing: ${filingData.firstFiling || 'Unknown'}
- Last filing: ${filingData.lastFiling || 'Unknown'}
- Last 12 months: ${filingData.last12Months} filings
- Trend: ${filingData.trend}
- States: ${filingData.states || 'Unknown'}
- Top brands: ${filingData.brands || 'Unknown'}

${discoveredUrls.website ? `OFFICIAL WEBSITE: ${discoveredUrls.website}` : 'NO WEBSITE FOUND'}
${discoveredUrls.social?.facebook ? `FACEBOOK: ${discoveredUrls.social.facebook}` : ''}
${discoveredUrls.social?.instagram ? `INSTAGRAM: ${discoveredUrls.social.instagram}` : ''}

WEBSITE CONTENT:
${websiteContentText}

RECENT NEWS:
${newsText}

Write a JSON response:
{
    "summary": "3-5 sentences about this company. Be SPECIFIC - include location (city, state), founding year, founder names, flagship products, awards, or recent news if found. Do not be generic.",
    "confidence": "high" if website content was informative, "medium" if limited, "low" if minimal
}

RULES:
- Use ONLY facts from the content above - do not make anything up
- If website content mentions founders, location, or founding year, include those specifics
- If no website content, summarize based on TTB filing data (what categories they file in, how active they are)
- Keep it factual and professional`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                // NO tools - just text analysis
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Claude API error:', response.status, error);
            return { summary: null, confidence: 'low', relevant_news: [] };
        }

        const result = await response.json();
        const textContent = result.content?.find(b => b.type === 'text')?.text || '';

        try {
            const jsonMatch = textContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('Failed to parse Claude response:', e);
        }

        return { summary: null, confidence: 'low', relevant_news: [] };
    } catch (e) {
        console.error('Claude API call failed:', e);
        return { summary: null, confidence: 'low', relevant_news: [] };
    }
}

// Get industry hint from category codes
function getIndustryHint(categories) {
    const cats = categories || '';
    if (cats.includes('WHISKY') || cats.includes('BOURBON')) return 'distillery whiskey bourbon';
    if (cats.includes('WINE') || cats.includes('TABLE')) return 'winery wine';
    if (cats.includes('BEER') || cats.includes('ALE') || cats.includes('MALT')) return 'brewery craft beer';
    if (cats.includes('VODKA') || cats.includes('GIN')) return 'distillery spirits';
    if (cats.includes('TEQUILA') || cats.includes('MEZCAL')) return 'tequila mezcal distillery';
    if (cats.includes('RUM')) return 'rum distillery';
    if (cats.includes('BRANDY') || cats.includes('COGNAC')) return 'brandy cognac distillery';
    return 'beverage alcohol';
}

// ============================================================================
// OLD ENHANCEMENT FUNCTION (kept for rollback - now commented out)
// ============================================================================

/*
async function callClaudeWithSearch(companyName, data, env) {
    // Build context about what type of company this is
    const categories = data.categories || '';
    let industryHint = 'beverage alcohol';
    if (categories.includes('WHISKY') || categories.includes('BOURBON')) industryHint = 'distillery whiskey bourbon';
    else if (categories.includes('WINE') || categories.includes('TABLE')) industryHint = 'winery wine';
    else if (categories.includes('BEER') || categories.includes('ALE') || categories.includes('MALT')) industryHint = 'brewery craft beer';
    else if (categories.includes('VODKA') || categories.includes('GIN')) industryHint = 'distillery spirits';
    else if (categories.includes('TEQUILA') || categories.includes('MEZCAL')) industryHint = 'tequila mezcal';
    else if (categories.includes('RUM')) industryHint = 'rum distillery';

    // Use the primary brand (clicked brand) for searching
    const topBrand = data.primaryBrand || '';

    const prompt = `You are researching a beverage alcohol company for a business intelligence report. Your PRIMARY goal is to find their official website and write a factual summary.

Company: ${companyName}
Top brand: ${topBrand}
Industry: ${industryHint}
${data.existingWebsite ? `Known website: ${data.existingWebsite}` : ''}

REQUIRED: You MUST use web_search multiple times with different queries. Do NOT give up after one search.

Search strategy (try ALL of these):
1. "${companyName}" - direct company name search
2. "${topBrand} official website" - search by their main brand
3. "${companyName} ${industryHint}" - company + industry terms
4. "${topBrand} distillery" or "${topBrand} winery" - brand + facility type
5. If still not found, try variations: remove "LLC", "Inc", try just the first word of the company name
6. "${companyName} facebook" OR "${topBrand} facebook" - find their Facebook page for business updates, grand openings, events

IMPORTANT:
- The official website is almost always a .com domain matching the company or brand name
- IGNORE retailers: Drizly, Total Wine, Vivino, Wine-Searcher, ReserveBar, Caskers, wine.com
- IGNORE social media as the primary website (but DO search Facebook/Instagram for business news like grand openings, events, new releases)
- Most legitimate beverage companies HAVE a website - keep searching if you don't find it immediately

After thorough searching, provide this JSON:
{
  "website": "https://example.com" or null ONLY if truly not found after multiple searches,
  "summary": "2-3 sentences about the company's background, founding story, location, and what makes them notable. Include recent business updates from Facebook/Instagram like grand openings, events, new releases if found. Be specific with facts you found.",
  "social": {
    "facebook": "https://facebook.com/companypage" or null,
    "instagram": "https://instagram.com/companypage" or null
  },
  "news": [
    {"title": "Actual article headline", "date": "2024-01", "source": "Publication Name", "url": "https://actual-article-url.com/full/path"}
  ]
}

CRITICAL for news:
- Only include articles that are PRIMARILY ABOUT this company or brand - not articles that merely mention them in passing
- The "url" field MUST be the actual clickable URL to the article from your search results
- Do NOT make up URLs or use placeholder text
- If you cannot find real news articles specifically about this company, return an empty array: "news": []

DO NOT say "limited information" unless you've tried at least 4 different search queries. Most companies are findable.`;

    // Retry logic for rate limits
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            // Wait before retry: 10s, 30s, 60s (generous delays for rate limit recovery)
            const waitMs = Math.min(10000 * Math.pow(2, attempt), 60000);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                tools: [{
                    type: 'web_search_20250305',
                    name: 'web_search',
                    max_uses: 5
                }],
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (response.ok) {
            // Success - continue with processing below
            var result = await response.json();
            break;
        }

        if (response.status === 429) {
            // Rate limited - retry after delay
            lastError = `Rate limited (attempt ${attempt + 1}/${maxRetries})`;
            console.log(lastError);
            if (attempt === maxRetries - 1) {
                throw new Error('Claude API rate limit exceeded. Please try again in a minute.');
            }
            continue;
        }

        // Other error - don't retry
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    // Extract text from response
    let textContent = '';
    for (const block of result.content || []) {
        if (block.type === 'text') {
            textContent += block.text;
        }
    }

    // Parse JSON from response
    try {
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // Strip citation tags from summary
            let summary = parsed.summary || null;
            if (summary) {
                summary = summary.replace(/<cite[^>]*>|<\/cite>/g, '');
            }
            return {
                website: parsed.website || null,
                summary,
                news: parsed.news || []
            };
        }
    } catch (e) {
        console.error('Failed to parse Claude response:', e);
    }

    return { website: null, summary: null, news: [] };
}
*/

async function saveEnhancement(companyId, companyName, tearsheet, email, env) {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(`
        INSERT OR REPLACE INTO company_enhancements
        (company_id, company_name, website_url, website_confidence, filing_stats,
         distribution_states, brand_portfolio, category_breakdown, summary, news, social_links, enhanced_at, enhanced_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        companyId,
        companyName,
        tearsheet.website?.url || null,
        tearsheet.website?.confidence || null,
        JSON.stringify(tearsheet.filing_stats),
        JSON.stringify(tearsheet.distribution.states),
        JSON.stringify(tearsheet.brands),
        JSON.stringify(tearsheet.categories),
        tearsheet.summary || null,
        JSON.stringify(tearsheet.news || []),
        JSON.stringify(tearsheet.social || null),
        now,
        email,
        expiresAt
    ).run();
}

function parseEnhancement(row) {
    return {
        company_id: row.company_id,
        company_name: row.company_name,
        website: row.website_url ? { url: row.website_url, confidence: row.website_confidence } : null,
        filing_stats: row.filing_stats ? JSON.parse(row.filing_stats) : null,
        distribution: { states: row.distribution_states ? JSON.parse(row.distribution_states) : [] },
        brands: row.brand_portfolio ? JSON.parse(row.brand_portfolio) : [],
        categories: row.category_breakdown ? JSON.parse(row.category_breakdown) : {},
        contacts: row.contacts ? JSON.parse(row.contacts) : [],
        news: row.news ? JSON.parse(row.news) : [],
        social: row.social_links ? JSON.parse(row.social_links) : null,
        summary: row.summary || null,
        enhanced_at: row.enhanced_at
    };
}

async function fetchRecentFilings(companyId, env) {
    const result = await env.DB.prepare(`
        SELECT brand_name, fanciful_name, approval_date, status, signal
        FROM colas
        WHERE company_name IN (
            SELECT raw_name FROM company_aliases WHERE company_id = ?
        )
        ORDER BY substr(approval_date, 7, 4) || substr(approval_date, 1, 2) || substr(approval_date, 4, 2) DESC
        LIMIT 10
    `).bind(companyId).all();

    return result?.results?.map(f => ({
        brand: f.brand_name,
        product: f.fanciful_name,
        date: f.approval_date,
        status: f.status,
        signal: f.signal
    })) || [];
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
