/**
 * BevAlc Intelligence API Worker
 * Cloudflare Worker for D1 database queries + Stripe integration
 */

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

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Rate limiting check (skip for Stripe webhooks)
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
                        ...corsHeaders
                    }
                });
            }
        }

        try {
            // SEO Pages (HTML responses)
            if (path.startsWith('/company/')) {
                return await handleCompanyPage(path, env, corsHeaders);
            } else if (path.startsWith('/brand/')) {
                return await handleBrandPage(path, env, corsHeaders);
            } else if (path.startsWith('/category/')) {
                return await handleCategoryPage(path, env, corsHeaders);
            } else if (path === '/sitemap.xml' || path.startsWith('/sitemap-')) {
                return await handleSitemap(path, env);
            }

            let response;

            // Stripe endpoints
            if (path === '/api/stripe/create-checkout' && request.method === 'POST') {
                response = await handleCreateCheckout(request, env);
            } else if (path === '/api/stripe/webhook' && request.method === 'POST') {
                return await handleStripeWebhook(request, env, corsHeaders);
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
                    ...corsHeaders
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
                    ...corsHeaders
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
    const priceId = env.STRIPE_PRICE_ID;
    
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
        'metadata[plan]': 'pro',
        'metadata[product]': 'category_pack'
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

async function handleStripeWebhook(request, env, corsHeaders) {
    const body = await request.text();
    
    let event;
    try {
        event = JSON.parse(body);
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
    
    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const customerEmail = session.customer_email || session.customer_details?.email;
            const customerId = session.customer;
            
            if (customerEmail) {
                console.log(`Pro subscription activated for: ${customerEmail}`);
                
                // Generate unique preferences token
                const preferencesToken = generateToken();
                
                // Create or update user_preferences record
                try {
                    await env.DB.prepare(`
                        INSERT INTO user_preferences (email, stripe_customer_id, is_pro, preferences_token, categories, updated_at)
                        VALUES (?, ?, 1, ?, '[]', datetime('now'))
                        ON CONFLICT(email) DO UPDATE SET
                            stripe_customer_id = excluded.stripe_customer_id,
                            is_pro = 1,
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
                    SET is_pro = 0, categories = '[]', updated_at = datetime('now')
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
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
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
    ).bind(email).first();

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
    'Brandy', 'Wine', 'Beer', 'Liqueur', 'RTD'
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
                        // User is Pro in Stripe but missing D1 record - create it
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, stripe_customer_id, is_pro, preferences_token, categories, updated_at)
                            VALUES (?, ?, 1, ?, '[]', datetime('now'))
                        `).bind(email.toLowerCase(), customerId, newToken).run();
                        
                        user = { 
                            email: email.toLowerCase(), 
                            is_pro: 1, 
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
    
    // Validate categories
    if (!Array.isArray(categories)) {
        return { success: false, error: 'Categories must be an array' };
    }
    
    const validCategories = categories.filter(c => AVAILABLE_CATEGORIES.includes(c));
    
    try {
        // First check if user exists and is Pro
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
        
        // Update preferences in D1
        await env.DB.prepare(`
            UPDATE user_preferences 
            SET categories = ?, receive_free_report = ?, updated_at = datetime('now')
            WHERE preferences_token = ?
        `).bind(
            JSON.stringify(validCategories),
            receiveFreeReport ? 1 : 0,
            token
        ).run();
        
        // Sync to Loops (non-blocking - don't fail if Loops fails)
        const loopsResult = await syncToLoops(
            user.email, 
            validCategories, 
            true, // isPro
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

        return { success: true, message: 'User created', existing: false };
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

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    try {
        // Verify user is Pro
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
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

    const { email, type, value } = body;

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    // Only allow brand and company types for now
    if (!['brand', 'company'].includes(type)) {
        return { success: false, error: 'Invalid type. Must be brand or company.' };
    }

    try {
        // Verify user is Pro
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
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

    const { email, type, value } = body;

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    try {
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

const TTB_CODE_CATEGORIES = {
    'STRAIGHT WHISKY': 'Whiskey', 'STRAIGHT BOURBON WHISKY': 'Whiskey', 'STRAIGHT RYE WHISKY': 'Whiskey',
    'STRAIGHT CORN WHISKY': 'Whiskey', 'WHISKY': 'Whiskey', 'BOURBON WHISKY': 'Whiskey', 'RYE WHISKY': 'Whiskey',
    'CORN WHISKY': 'Whiskey', 'SCOTCH WHISKY': 'Whiskey', 'CANADIAN WHISKY': 'Whiskey', 'IRISH WHISKY': 'Whiskey',
    'BLENDED WHISKY': 'Whiskey', 'MALT WHISKY': 'Whiskey', 'LIGHT WHISKY': 'Whiskey', 'SPIRIT WHISKY': 'Whiskey',
    'TENNESSEE WHISKY': 'Whiskey', 'AMERICAN SINGLE MALT WHISKEY': 'Whiskey', 'WHISKY SPECIALTIES': 'Whiskey',
    'LIQUEURS (WHISKY)': 'Whiskey', 'SINGLE MALT SCOTCH WHISKY': 'Whiskey',
    'GIN': 'Gin', 'DISTILLED GIN': 'Gin', 'LONDON DRY GIN': 'Gin', 'GIN - FLAVORED': 'Gin',
    'GIN SPECIALTIES': 'Gin', 'LIQUEURS (GIN)': 'Gin', 'SLOE GIN': 'Gin',
    'VODKA': 'Vodka', 'VODKA 80-89 PROOF': 'Vodka', 'VODKA - FLAVORED': 'Vodka', 'VODKA SPECIALTIES': 'Vodka',
    'LIQUEURS (VODKA)': 'Vodka',
    'RUM': 'Rum', 'PUERTO RICAN RUM': 'Rum', 'JAMAICAN RUM': 'Rum', 'RUM SPECIALTIES': 'Rum',
    'LIQUEURS (RUM)': 'Rum', 'CACHACA': 'Rum',
    'BRANDY': 'Brandy', 'COGNAC (BRANDY) FB': 'Brandy', 'COGNAC (BRANDY) USB': 'Brandy',
    'ARMAGNAC (BRANDY) FB': 'Brandy', 'APPLE BRANDY': 'Brandy', 'GRAPPA BRANDY': 'Brandy', 'PISCO': 'Brandy',
    'BLACKBERRY FLAVORED BRANDY': 'Brandy', 'LIQUEUR & BRANDY': 'Brandy',
    'CURACAO': 'Liqueur', 'TRIPLE SEC': 'Liqueur', 'AMARETTO': 'Liqueur', 'SAMBUCA': 'Liqueur',
    'COFFEE (CAFE) LIQUEUR': 'Liqueur', 'CREME DE MENTHE': 'Liqueur', 'DAIRY CREAM LIQUEUR/CORDIAL': 'Liqueur',
    'COCKTAILS 48 PROOF UP': 'Cocktails', 'COCKTAILS UNDER 48 PROOF': 'Cocktails', 'BLOODY MARY': 'Cocktails',
    'SCREW DRIVER': 'Cocktails', 'DAIQUIRI': 'Cocktails', 'MARGARITA': 'Cocktails',
    'TABLE RED WINE': 'Wine', 'TABLE WHITE WINE': 'Wine', 'TABLE FLAVORED WINE': 'Wine', 'DESSERT FLAVORED WINE': 'Wine',
    'SPARKLING WINE/CHAMPAGNE': 'Wine', 'CARBONATED WINE': 'Wine', 'VERMOUTH': 'Wine', 'PORT': 'Wine',
    'SHERRY': 'Wine', 'SAKE': 'Wine', 'WINE': 'Wine',
    'BEER': 'Beer', 'ALE': 'Beer', 'MALT LIQUOR': 'Beer', 'STOUT': 'Beer', 'PORTER': 'Beer',
    'MALT BEVERAGES': 'Beer',
    'TEQUILA': 'Tequila', 'TEQUILA FB': 'Tequila', 'TEQUILA USB': 'Tequila', 'MEZCAL': 'Tequila',
    'AGAVE SPIRITS': 'Tequila',
    'BITTERS - BEVERAGE': 'Other Spirits', 'NEUTRAL SPIRITS - GRAIN': 'Other Spirits'
};

function getCategory(classTypeCode) {
    if (!classTypeCode) return 'Other';
    if (TTB_CODE_CATEGORIES[classTypeCode]) return TTB_CODE_CATEGORIES[classTypeCode];
    const upper = classTypeCode.toUpperCase();
    if (upper.includes('WHISK') || upper.includes('BOURBON') || upper.includes('SCOTCH')) return 'Whiskey';
    if (upper.includes('VODKA')) return 'Vodka';
    if (upper.includes('TEQUILA') || upper.includes('MEZCAL') || upper.includes('AGAVE')) return 'Tequila';
    if (upper.includes('RUM') || upper.includes('CACHACA')) return 'Rum';
    if (upper.includes('GIN')) return 'Gin';
    if (upper.includes('BRANDY') || upper.includes('COGNAC') || upper.includes('ARMAGNAC') || upper.includes('GRAPPA') || upper.includes('PISCO')) return 'Brandy';
    if (upper.includes('WINE') || upper.includes('CHAMPAGNE') || upper.includes('PORT') || upper.includes('SHERRY') || upper.includes('VERMOUTH') || upper.includes('SAKE') || upper.includes('CIDER') || upper.includes('MEAD')) return 'Wine';
    if (upper.includes('BEER') || upper.includes('ALE') || upper.includes('MALT') || upper.includes('STOUT') || upper.includes('PORTER')) return 'Beer';
    if (upper.includes('LIQUEUR') || upper.includes('CORDIAL') || upper.includes('SCHNAPPS') || upper.includes('AMARETTO') || upper.includes('CREME DE')) return 'Liqueur';
    if (upper.includes('COCKTAIL') || upper.includes('MARTINI') || upper.includes('DAIQUIRI') || upper.includes('MARGARITA') || upper.includes('COLADA')) return 'Cocktails';
    return 'Other';
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
        const categoryPatterns = {
            'Whiskey': ['%WHISK%', '%BOURBON%', '%SCOTCH%', '%RYE%'],
            'Vodka': ['%VODKA%'],
            'Tequila': ['%TEQUILA%', '%MEZCAL%', '%AGAVE%'],
            'Rum': ['%RUM%', '%CACHACA%'],
            'Gin': ['%GIN%'],
            'Brandy': ['%BRANDY%', '%COGNAC%', '%ARMAGNAC%', '%GRAPPA%', '%PISCO%'],
            'Wine': ['%WINE%', '%CHAMPAGNE%', '%/PORT/%', '%SHERRY%', '%VERMOUTH%', '%SAKE%', '%CIDER%', '%MEAD%'],
            'Beer': ['%BEER%', '%ALE%', '%MALT%', '%STOUT%', 'PORTER'],
            'Liqueur': ['%LIQUEUR%', '%CORDIAL%', '%SCHNAPPS%', '%AMARETTO%', '%CREME DE%', '%CURACAO%', '%TRIPLE SEC%', '%SAMBUCA%'],
            'Cocktails': ['%COCKTAIL%', '%MARTINI%', '%DAIQUIRI%', '%MARGARITA%', '%COLADA%', '%BLOODY MARY%', '%SCREW DRIVER%'],
            'Other Spirits': ['%BITTERS%', '%NEUTRAL SPIRIT%']
        };
        const patterns = categoryPatterns[category];
        if (patterns && patterns.length > 0) {
            const categoryConditions = patterns.map(() => 'class_type_code LIKE ?').join(' OR ');
            whereClause += ` AND (${categoryConditions})`;
            patterns.forEach(p => queryParams.push(p));
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
    if (!email) {
        return { success: false, error: 'Email required for export' };
    }
    
    // Check if user is Pro
    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (stripeSecretKey) {
        try {
            const searchResponse = await fetch(
                `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(email.toLowerCase())}'`,
                { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
            );
            const searchData = await searchResponse.json();
            
            if (!searchData.data || searchData.data.length === 0) {
                return { success: false, error: 'Pro subscription required for export' };
            }
            
            const customerId = searchData.data[0].id;
            
            const subsResponse = await fetch(
                `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=1`,
                { headers: { 'Authorization': `Bearer ${stripeSecretKey}` } }
            );
            const subsData = await subsResponse.json();
            
            if (!subsData.data || subsData.data.length === 0) {
                return { success: false, error: 'Pro subscription required for export' };
            }
        } catch (e) {
            return { success: false, error: 'Could not verify Pro status' };
        }
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
    const subcategory = params.get('subcategory');  // Subcategory name (e.g., "Bourbon", "Irish Whiskey")
    const status = params.get('status');
    const dateFrom = params.get('date_from');
    const dateTo = params.get('date_to');

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
        const categoryPatterns = {
            'Whiskey': ['%WHISK%', '%BOURBON%', '%SCOTCH%', '%RYE%'],
            'Vodka': ['%VODKA%'],
            'Tequila': ['%TEQUILA%', '%MEZCAL%', '%AGAVE%'],
            'Rum': ['%RUM%', '%CACHACA%'],
            'Gin': ['%GIN%'],
            'Brandy': ['%BRANDY%', '%COGNAC%', '%ARMAGNAC%', '%GRAPPA%', '%PISCO%'],
            'Wine': ['%WINE%', '%CHAMPAGNE%', '%/PORT/%', '%SHERRY%', '%VERMOUTH%', '%SAKE%', '%CIDER%', '%MEAD%'],
            'Beer': ['%BEER%', '%ALE%', '%MALT%', '%STOUT%', 'PORTER'],
            'Liqueur': ['%LIQUEUR%', '%CORDIAL%', '%SCHNAPPS%', '%AMARETTO%', '%CREME DE%', '%CURACAO%', '%TRIPLE SEC%', '%SAMBUCA%'],
            'Cocktails': ['%COCKTAIL%', '%MARTINI%', '%DAIQUIRI%', '%MARGARITA%', '%COLADA%', '%BLOODY MARY%', '%SCREW DRIVER%'],
            'Other Spirits': ['%BITTERS%', '%NEUTRAL SPIRIT%']
        };
        const patterns = categoryPatterns[category];
        if (patterns && patterns.length > 0) {
            const categoryConditions = patterns.map(() => 'class_type_code LIKE ?').join(' OR ');
            whereClause += ` AND (${categoryConditions})`;
            patterns.forEach(p => queryParams.push(p));
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

    return {
        success: true,
        data: result
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

        .seo-page { padding-top: 100px; max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
        .seo-header { margin-bottom: 32px; }
        .seo-header h1 { font-family: var(--font-display); font-size: 2.5rem; margin-bottom: 8px; }
        .seo-header .meta { color: var(--color-text-secondary); font-size: 1.1rem; }
        .meta-stats { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
        .meta-line { margin: 0; color: var(--color-text-secondary); font-size: 1rem; }
        .meta-line strong { color: var(--color-text); }
        .seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-bottom: 32px; }
        .seo-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 24px; }
        .seo-card h2 { font-size: 1rem; color: var(--color-text-secondary); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
        .stat-value { font-size: 2rem; font-weight: 700; color: var(--color-text); }
        .stat-label { font-size: 0.875rem; color: var(--color-text-secondary); }
        .brand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .brand-chip { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; transition: border-color var(--transition-fast); overflow: hidden; }
        .brand-chip:hover { border-color: var(--color-primary); }
        .brand-chip a { color: var(--color-text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .brand-chip .count { color: var(--color-text-tertiary); font-size: 0.875rem; flex-shrink: 0; margin-left: 8px; }
        .filings-table { width: 100%; border-collapse: collapse; }
        .filings-table th, .filings-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--color-border); }
        .filings-table th { background: var(--color-bg-secondary); font-weight: 600; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .filings-table tr:hover { background: var(--color-bg-secondary); }
        .signal-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .signal-new-company { background: #f3e8ff; color: #7c3aed; }
        .signal-new-brand { background: #dcfce7; color: #166534; }
        .signal-new-sku { background: #dbeafe; color: #1e40af; }
        .signal-refile { background: #f3f4f6; color: #6b7280; }
        .bar-chart { margin: 8px 0; }
        .bar-row { display: flex; align-items: center; margin-bottom: 8px; }
        .bar-label { width: 120px; font-size: 0.875rem; color: var(--color-text-secondary); }
        .bar-container { flex: 1; height: 24px; background: var(--color-bg-tertiary); border-radius: 4px; overflow: hidden; }
        .bar-fill { height: 100%; background: var(--color-primary); border-radius: 4px; }
        .bar-value { width: 60px; text-align: right; font-size: 0.875rem; font-weight: 500; }
        .related-links { margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--color-border); }
        .related-links h3 { margin-bottom: 16px; }
        .related-links a { display: inline-block; margin-right: 16px; margin-bottom: 8px; color: var(--color-primary); }
        .breadcrumb { margin-bottom: 16px; font-size: 0.875rem; color: var(--color-text-secondary); }
        .breadcrumb a { color: var(--color-text-secondary); }
        .breadcrumb a:hover { color: var(--color-primary); }

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
            .seo-header h1 { font-size: 1.75rem; }
            .seo-grid { grid-template-columns: 1fr; }
            .seo-card { overflow: hidden; }
            .brand-grid { grid-template-columns: 1fr 1fr; }
            .filings-table { min-width: 600px; }
            .filings-table th, .filings-table td { padding: 8px 6px; font-size: 0.8rem; }
            .bar-label { width: 80px; font-size: 0.75rem; }
            .bar-value { width: 45px; font-size: 0.75rem; }
            .nav-links { display: none; }
            .mobile-menu-btn { display: flex; }
        }
        @media (max-width: 400px) {
            .brand-grid { grid-template-columns: 1fr; }
            .brand-chip { padding: 10px 12px; }
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
async function handleCompanyPage(path, env, corsHeaders) {
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
        // Search for raw_name containing these terms
        if (searchTerms.length >= 2) {
            const pattern = `%${searchTerms.slice(0, 3).join('%')}%`;
            const aliasResult = await env.DB.prepare(`
                SELECT c.* FROM companies c
                JOIN company_aliases ca ON c.id = ca.company_id
                WHERE UPPER(ca.raw_name) LIKE UPPER(?)
                AND c.total_filings >= 1
                LIMIT 1
            `).bind(pattern).first();
            company = aliasResult;
        }
    }

    // Last resort: search directly in colas table for company_name matching the slug pattern
    if (!company) {
        const searchTerms = slug.split('-').filter(t => t.length > 2);
        if (searchTerms.length >= 2) {
            // Try multiple patterns to handle possessives (e.g., "kvasirs" from "Kvasir's")
            // Strip trailing 's' from terms as a fallback
            const termsToUse = searchTerms.slice(0, 4);
            const strippedTerms = termsToUse.map(t => t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

            // Try original pattern first, then stripped pattern
            const patterns = [
                `%${termsToUse.join('%')}%`,
                `%${strippedTerms.join('%')}%`
            ];

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
            SELECT c.canonical_name, c.slug, c.total_filings
            FROM companies c
            WHERE c.id != ? AND c.total_filings >= 10
            ORDER BY c.total_filings DESC
            LIMIT 5
        `).bind(company.id).all();
        relatedCompanies = relatedResult.results || [];
    }

    // Calculate category percentages
    const totalCatFilings = categories.reduce((sum, c) => sum + c.cnt, 0);
    const categoryBars = categories.slice(0, 6).map(c => ({
        name: getCategory(c.class_type_code),
        count: c.cnt,
        pct: Math.round((c.cnt / totalCatFilings) * 100)
    }));

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
        <div class="breadcrumb">
            <a href="/">Home</a> / <a href="/database.html">Database</a> / Company
        </div>
        <header class="seo-header">
            <h1>${escapeHtml(company.display_name)} Brands & Portfolio</h1>
            <div class="meta-stats">
                <p class="meta-line"><strong>${formatNumber(brands.length)}+</strong> Brands</p>
                <p class="meta-line"><strong>${formatNumber(company.total_filings)}</strong> Total Filings</p>
                <p class="meta-line">Since <strong>${escapeHtml(company.first_filing || 'N/A')}</strong></p>
                ${primaryLocation ? `<p class="meta-line">📍 ${escapeHtml(primaryLocation)}</p>` : ''}
            </div>
            ${dbaNames.length > 0 ? `<p class="meta" style="margin-top: 8px; font-size: 0.9rem;">Also operates as: ${dbaNames.map(n => escapeHtml(n)).join(', ')}</p>` : ''}
        </header>

        <div class="page-paywall pro-locked">
            <div class="seo-blur">
                <section class="seo-card" style="margin-bottom: 32px;">
                    <p style="font-size: 1.1rem; line-height: 1.7; color: var(--color-text-secondary);">
                        ${escapeHtml(company.display_name)} is a beverage alcohol company with ${formatNumber(company.total_filings)} TTB COLA filings.
                        ${brands.length > 0 ? `Their portfolio includes popular brands such as <strong>${brands.slice(0, 3).map(b => escapeHtml(b.brand_name)).join('</strong>, <strong>')}</strong>${brands.length > 3 ? `, <strong>${escapeHtml(brands[3].brand_name)}</strong>` : ''}${brands.length > 4 ? `, and <strong>${escapeHtml(brands[4].brand_name)}</strong>` : ''}.` : ''}
                        ${categoryBars.length > 0 ? `The company primarily operates in the ${categoryBars.slice(0, 2).map(c => c.name.toLowerCase()).join(' and ')} ${categoryBars.length > 1 ? 'categories' : 'category'}.` : ''}
                    </p>
                </section>

                <div class="seo-grid">
                    <div class="seo-card">
                        <h2>Filing Stats</h2>
                        <div class="stat-value">${formatNumber(company.total_filings)}</div>
                        <div class="stat-label">Total COLA Filings</div>
                    </div>
                    <div class="seo-card">
                        <h2>Brands</h2>
                        <div class="stat-value">${formatNumber(brands.length)}${brands.length === 20 ? '+' : ''}</div>
                        <div class="stat-label">Distinct Brands Filed</div>
                    </div>
                    <div class="seo-card">
                        <h2>Categories</h2>
                        <div class="bar-chart">
                            ${categoryBars.map(c => `
                                <div class="bar-row">
                                    <div class="bar-label">${escapeHtml(c.name)}</div>
                                    <div class="bar-container"><div class="bar-fill" style="width: ${c.pct}%"></div></div>
                                    <div class="bar-value">${c.pct}%</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="seo-card" style="margin-bottom: 32px;">
                    <h2>Brands (${brands.length}${brands.length === 20 ? '+' : ''})</h2>
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
                    <h2>Recent Filings</h2>
                    <div class="table-wrapper">
                        <table class="filings-table">
                            <thead>
                                <tr>
                                    <th>Brand</th>
                                    <th>Product</th>
                                    <th>Filing Entity</th>
                                    <th>Date</th>
                                    <th>Signal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recentFilings.map(f => {
                                    // Show the actual filing entity (company_name on the record)
                                    const filingEntity = f.filing_entity ? f.filing_entity.split(',')[0].trim() : '-';
                                    return `
                                    <tr>
                                        <td><a href="/brand/${makeSlug(f.brand_name)}">${escapeHtml(f.brand_name)}</a></td>
                                        <td>${escapeHtml(f.fanciful_name || '-')}</td>
                                        <td style="font-size: 0.85rem; color: var(--color-text-secondary);">${escapeHtml(filingEntity)}</td>
                                        <td>${escapeHtml(f.approval_date)}</td>
                                        <td>${f.signal ? `<span class="signal-badge signal-${f.signal.toLowerCase().replace(/_/g, '-')}">${f.signal.replace('_', ' ')}</span>` : ''}</td>
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
                <p style="margin-top: 12px; font-size: 0.85rem; color: var(--color-text-secondary);">Starting at $29/month</p>
            </div>
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/company/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            ...corsHeaders
        }
    });
}

// Brand Page Handler
async function handleBrandPage(path, env, corsHeaders) {
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

    const brand = brandResult;

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
        <div class="breadcrumb">
            <a href="/">Home</a> / <a href="/database.html">Database</a> / Brand
        </div>
        <header class="seo-header">
            <h1>${escapeHtml(brand.brand_name)}</h1>
            <p class="meta">
                ${companyResult?.canonical_name ? `by <a href="/company/${companyResult.slug}">${escapeHtml(companyResult.canonical_name)}</a> · ` : ''}
                ${escapeHtml(primaryCategory)} · ${formatNumber(brand.cnt)} Filings
            </p>
        </header>

        <div class="page-paywall pro-locked">
            <div class="seo-blur">
                <div class="seo-grid">
                    <div class="seo-card">
                        <h2>Total Filings</h2>
                        <div class="stat-value">${formatNumber(brand.cnt)}</div>
                        <div class="stat-label">COLA Applications</div>
                    </div>
                    <div class="seo-card">
                        <h2>Category</h2>
                        <div class="stat-value" style="font-size: 1.5rem;">${escapeHtml(primaryCategory)}</div>
                        <div class="stat-label"><a href="/category/${makeSlug(primaryCategory)}/${new Date().getFullYear()}">View category trends →</a></div>
                    </div>
                    <div class="seo-card">
                        <h2>Filing Timeline</h2>
                        <div class="bar-chart">
                            ${timeline.map(t => `
                                <div class="bar-row">
                                    <div class="bar-label">${t.year}</div>
                                    <div class="bar-container"><div class="bar-fill" style="width: ${Math.round((t.cnt / maxTimeline) * 100)}%"></div></div>
                                    <div class="bar-value">${t.cnt}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="seo-card">
                    <h2>Products (${products.length}${products.length === 15 ? '+' : ''})</h2>
                    <div class="table-wrapper">
                        <table class="filings-table">
                            <thead>
                                <tr>
                                    <th>Product Name</th>
                                    <th>Type</th>
                                    <th>Date</th>
                                    <th>Signal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.map(p => `
                                    <tr>
                                        <td>${escapeHtml(p.fanciful_name || brand.brand_name)}</td>
                                        <td>${escapeHtml(getCategory(p.class_type_code))}</td>
                                        <td>${escapeHtml(p.approval_date)}</td>
                                        <td>${p.signal ? `<span class="signal-badge signal-${p.signal.toLowerCase().replace(/_/g, '-')}">${p.signal.replace('_', ' ')}</span>` : ''}</td>
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
                <p style="margin-top: 12px; font-size: 0.85rem; color: var(--color-text-secondary);">Starting at $29/month</p>
            </div>
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/brand/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            ...corsHeaders
        }
    });
}

// Category Page Handler
async function handleCategoryPage(path, env, corsHeaders) {
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
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            ...corsHeaders
        }
    });
}

// Sitemap Handler - serves pre-generated sitemaps from R2
const R2_SITEMAP_URL = 'https://pub-1c889ae594b041a3b752c6c891eb718e.r2.dev/sitemaps';

async function handleSitemap(path, env) {
    // Cache headers for all sitemaps (24h edge, 1h browser)
    const cacheHeaders = {
        'Content-Type': 'application/xml',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
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
