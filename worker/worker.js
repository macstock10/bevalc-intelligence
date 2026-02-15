/**
 * BevAlc Intelligence API Worker
 * Cloudflare Worker for D1 database queries + Stripe integration
 */

import {
    handleGenerateEmbeddings,
    handleSec8kEvent,
    handleSec8kEvents,
    handleSecCompanies,
    handleSecFiling,
    handleSecFilings,
    handleSecMdaCompare,
    handleSecMdaDiff,
    handleSecQuery
} from './sec_research.js';

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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// Canonical subcategory grouping used only for "Other X" exclusion filters.
// This does not alter raw TTB source data; it only corrects classification behavior.
function getCanonicalMappedCodesForCategory(parentCategory) {
    const categorySubcategories = {
        'Whiskey': ['Bourbon', 'Rye', 'American Single Malt', 'Scotch', 'Irish Whiskey', 'Canadian Whisky', 'Corn Whiskey', 'Malt Whisky', 'Blended Whiskey', 'Flavored Whiskey'],
        'Vodka': ['Unflavored Vodka', 'Flavored Vodka'],
        'Tequila': ['Tequila', 'Mezcal'],
        'Rum': ['White Rum', 'Gold/Aged Rum', 'Flavored Rum'],
        'Gin': ['London Dry Gin', 'Distilled Gin', 'Flavored Gin'],
        'Brandy': ['Cognac', 'Armagnac', 'American Brandy', 'Fruit Brandy', 'Grappa & Pisco', 'Flavored Brandy'],
        'Wine': ['Red Wine', 'White Wine', 'Rosé Wine', 'Sparkling Wine', 'Dessert Wine', 'Flavored Wine', 'Fruit Wine', 'Fortified Wine', 'Sake'],
        'Beer': ['Lager/Beer', 'Ale', 'Stout', 'Porter', 'Malt Liquor', 'Flavored Malt Beverages', 'Non-Alcoholic Beer'],
        'Liqueur': ['Fruit Liqueurs', 'Cream Liqueurs', 'Herbal Liqueurs', 'Coffee Liqueurs', 'Nut Liqueurs', 'Schnapps'],
        'Liqueurs': ['Fruit Liqueurs', 'Cream Liqueurs', 'Herbal Liqueurs', 'Coffee Liqueurs', 'Nut Liqueurs', 'Schnapps'],
        'Cocktails': ['Whiskey Cocktails', 'Vodka Cocktails', 'Gin Cocktails', 'Rum Cocktails', 'Tequila Cocktails', 'Brandy Cocktails']
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

            // Glossary pages
            if (path === '/glossary' || path === '/glossary/') {
                return await handleGlossaryIndex(env);
            } else if (path.startsWith('/glossary/')) {
                return await handleGlossaryTerm(path, env);
            }

            // Location pages
            if (path === '/locations' || path === '/locations/') {
                return await handleLocationsIndex(env);
            } else if (path.startsWith('/locations/')) {
                return await handleLocationPage(path, env);
            }

            // COLA detail pages
            if (path.startsWith('/cola/')) {
                return await handleColaPage(path, env);
            }

            // Comparison pages
            if (path.startsWith('/compare/')) {
                return await handleComparisonPage(path, env);
            }

            // Curation pages (/best/)
            if (path === '/best' || path === '/best/') {
                return await handleBestIndex(env);
            } else if (path.startsWith('/best/')) {
                return await handleBestPage(path, env);
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
                response = await handleGetPreferences(request, url, env);
            } else if (path === '/api/user/preferences' && request.method === 'POST') {
                response = await handleSavePreferences(request, env);
            } else if (path === '/api/user/send-preferences-link' && request.method === 'POST') {
                response = await handleSendPreferencesLink(request, env);
            } else if (path === '/api/user/list-by-category') {
                response = await handleListUsersByCategory(request, url, env);
            } else if (path === '/api/user/check' && request.method === 'GET') {
                response = await handleCheckUserExists(url, env);
            } else if (path === '/api/user/signup-free' && request.method === 'POST') {
                response = await handleSignupFree(request, env);
            } else if (path === '/api/auth/send-code' && request.method === 'POST') {
                response = await handleSendAuthCode(request, env);
            } else if (path === '/api/auth/verify-code' && request.method === 'POST') {
                response = await handleVerifyAuthCode(request, env);
            }
            // Watchlist endpoints
            else if (path === '/api/watchlist' && request.method === 'GET') {
                response = await handleGetWatchlist(request, url, env);
            } else if (path === '/api/watchlist/check' && request.method === 'GET') {
                response = await handleCheckWatchlist(request, url, env);
            } else if (path === '/api/watchlist/counts' && request.method === 'GET') {
                response = await handleWatchlistCounts(url, env);
            } else if (path === '/api/watchlist/add' && request.method === 'POST') {
                response = await handleAddToWatchlist(request, env);
            } else if (path === '/api/watchlist/remove' && request.method === 'POST') {
                response = await handleRemoveFromWatchlist(request, env);
            }
            // Saved searches endpoints
            else if (path === '/api/saved-searches' && request.method === 'GET') {
                response = await handleGetSavedSearches(request, url, env);
            } else if (path === '/api/saved-searches' && request.method === 'POST') {
                response = await handleSaveSavedSearch(request, env);
            } else if (path === '/api/saved-searches' && request.method === 'DELETE') {
                response = await handleDeleteSavedSearch(request, url, env);
            }
            // Database endpoints
            else if (path === '/api/search') {
                response = await handleSearch(request, url, env);
            } else if (path === '/api/export') {
                response = await handleExport(request, url, env);
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
                response = await handleGetCredits(request, url, env);
            } else if (path === '/api/credits/checkout' && request.method === 'POST') {
                response = await handleCreditCheckout(request, env);
            } else if (path === '/api/company-lookup' && request.method === 'GET') {
                response = await handleCompanyLookup(url, env);
            } else if (path === '/api/permits/leads' && request.method === 'GET') {
                response = await handlePermitLeads(request, url, env);
            } else if (path === '/api/permits/stats' && request.method === 'GET') {
                response = await handlePermitStats(env);
            } else if (path === '/api/permits/contacts' && request.method === 'POST') {
                response = await handlePermitsContacts(request, env);
            } else if (path === '/api/competitor-activity' && request.method === 'GET') {
                response = await handleCompetitorActivity(request, url, env);
            }
            // SEC Research endpoints
            else if (path === '/api/sec/companies') {
                response = await handleSecCompanies(env);
            } else if (path === '/api/sec/filings') {
                response = await handleSecFilings(url, env);
            } else if (path.startsWith('/api/sec/filing/')) {
                response = await handleSecFiling(path, env);
            } else if (path === '/api/sec/8k-events') {
                response = await handleSec8kEvents(url, env);
            } else if (path.startsWith('/api/sec/8k-event/')) {
                response = await handleSec8kEvent(path, url, env);
            } else if (path === '/api/sec/query' && request.method === 'POST') {
                response = await handleSecQuery(request, env);
            } else if (path.startsWith('/api/sec/mda-diff/')) {
                response = await handleSecMdaDiff(path, url, env);
            } else if (path === '/api/sec/mda-compare') {
                response = await handleSecMdaCompare(url, env);
            } else if (path === '/api/sec/generate-embeddings' && request.method === 'POST') {
                response = await handleGenerateEmbeddings(request, env);
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
                        const newToken = generateToken();
                        await env.DB.prepare(`
                            INSERT INTO user_preferences (email, is_pro, tier, preferences_token, categories, receive_free_report, enhancement_credits, updated_at)
                            VALUES (?, 0, NULL, ?, '[]', 1, ?, datetime('now'))
                            ON CONFLICT(email) DO UPDATE SET
                                enhancement_credits = COALESCE(user_preferences.enhancement_credits, 0) + excluded.enhancement_credits,
                                updated_at = datetime('now')
                        `).bind(email, newToken, credits).run();

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
    
    const { email, returnUrl, token: bodyToken } = body;
    const normalizedEmail = email?.toLowerCase()?.trim();

    if (!normalizedEmail) {
        return { success: false, error: 'Email required' };
    }

    const token = getRequestToken(request, null, bodyToken || '');
    if (!token) {
        return { success: false, error: 'Token required' };
    }
    if (!(await requireValidToken(normalizedEmail, token, env))) {
        return { success: false, error: 'Invalid token' };
    }
    
    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
        return { success: false, error: 'Stripe not configured' };
    }
    
    // Find customer by email
    const searchResponse = await fetch(
        `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(normalizedEmail)}'`,
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
    const { email, pack, successUrl, cancelUrl, token: bodyToken } = body;
    const normalizedEmail = email?.toLowerCase()?.trim();
    const token = getRequestToken(request, null, bodyToken || '');

    if (!normalizedEmail) {
        return { success: false, error: 'Email required' };
    }
    if (!token) {
        return { success: false, error: 'Token required' };
    }
    if (!(await requireValidToken(normalizedEmail, token, env))) {
        return { success: false, error: 'Invalid token' };
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
        'customer_email': normalizedEmail,
        'metadata[type]': 'credit_purchase',
        'metadata[pack]': pack,
        'metadata[credits]': creditPack.credits.toString(),
        'metadata[email]': normalizedEmail
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
            subscribedRTD: categories.includes('RTD/Cocktails') || categories.includes('RTD'),
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

function getBearerToken(request) {
    const authHeader = request.headers.get('authorization') || '';
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function getRequestToken(request, url, bodyToken = '') {
    return getBearerToken(request) || bodyToken || (url ? url.searchParams.get('token') : '') || '';
}

async function requireValidToken(email, token, env) {
    if (!email || !token) return false;
    return await verifyUserToken(email, token, env);
}

async function handleGetPreferences(request, url, env) {
    const token = getBearerToken(request) || url.searchParams.get('token');
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
        categories = [...new Set(categories.map(c => c === 'RTD' ? 'RTD/Cocktails' : c))];

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

        const normalizedCategories = categories.map(c => c === 'RTD' ? 'RTD/Cocktails' : c);
        const validCategories = [...new Set(normalizedCategories.filter(c => AVAILABLE_CATEGORIES.includes(c)))];

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
        
        const preferencesUrl = `https://bevalcintel.com/preferences.html#token=${user.preferences_token}`;

        const emailResult = await sendPreferencesLinkEmail(email, preferencesUrl, env);
        if (!emailResult.success) {
            return { success: false, error: emailResult.error || 'Failed to send email' };
        }

        const response = { success: true, message: 'Preferences link sent to your email' };
        // Only include debug URL when explicitly enabled
        if (env.DEBUG_PREFS_LINK === 'true') {
            response._debug_url = preferencesUrl;
        }
        return response;
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleListUsersByCategory(request, url, env) {
    const category = url.searchParams.get('category');
    const apiKey = url.searchParams.get('api_key');
    const authHeader = request.headers.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const providedKey = bearerToken || apiKey;
    
    // Simple API key check for your report scripts
    if (providedKey !== env.REPORT_API_KEY) {
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

// Send preferences link email via Resend API
async function sendPreferencesLinkEmail(toEmail, preferencesUrl, env) {
    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
        console.log('RESEND_API_KEY not configured, skipping preferences link email');
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
            <h2 style="color: #1e293b; font-size: 22px; margin: 0 0 12px 0;">Manage your report preferences</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                Use the secure link below to select the categories you want in your weekly report.
            </p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="${preferencesUrl}" style="display: inline-block; background: #0d9488; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">Open Preferences</a>
            </div>
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 24px 0 0 0;">
                If you didn’t request this email, you can safely ignore it.
            </p>
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
                from: env.FROM_EMAIL || 'BevAlc Intelligence <hello@bevalcintel.com>',
                to: toEmail,
                subject: 'Your BevAlc Preferences Link',
                html: html,
            }),
        });

        if (response.ok) {
            return { success: true };
        }

        const error = await response.text();
        console.error(`Failed to send preferences link email: ${error}`);
        return { success: false, error };
    } catch (e) {
        console.error('Preferences link email error:', e.message);
        return { success: false, error: e.message };
    }
}

function generateNumericCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += Math.floor(Math.random() * 10).toString();
    }
    return code;
}

async function hashVerificationCode(_email, code, _env) {
    const email = (_email || '').toLowerCase().trim();
    const pepper = _env?.VERIFICATION_CODE_PEPPER || '';
    const payload = `${pepper}:${email}:${code}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
    }
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    }
    return mismatch === 0;
}

async function sendVerificationCodeEmail(toEmail, code, env) {
    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey) {
        console.log('RESEND_API_KEY not configured, skipping verification code email');
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
        <div style="padding: 32px; text-align: center;">
            <h2 style="color: #1e293b; font-size: 22px; margin: 0 0 12px 0;">Your verification code</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                Enter this code to verify your email and activate your account.
            </p>
            <div style="background: #f0fdfa; border: 2px dashed #0d9488; border-radius: 8px; padding: 20px; margin: 0 0 24px 0;">
                <span style="font-size: 32px; letter-spacing: 8px; font-weight: 700; color: #0d9488; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${code}</span>
            </div>
            <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
                This code expires in 15 minutes.<br>If you didn't request this, you can safely ignore it.
            </p>
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
                from: env.FROM_EMAIL || 'BevAlc Intelligence <hello@bevalcintel.com>',
                to: toEmail,
                subject: 'Your BevAlc verification code',
                html: html,
            }),
        });

        if (response.ok) {
            return { success: true };
        }

        const error = await response.text();
        console.error(`Failed to send verification code email: ${error}`);
        return { success: false, error };
    } catch (e) {
        console.error('Verification code email error:', e.message);
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
// AUTH CODE HANDLERS
// ==========================================

async function handleSendAuthCode(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const email = body.email?.toLowerCase()?.trim();
    if (!email) {
        return { success: false, error: 'Email required' };
    }


    const now = new Date();
    const nowIso = now.toISOString();

    try {
        const existing = await env.DB.prepare(
            'SELECT send_count, send_window_start FROM email_verification_codes WHERE email = ?'
        ).bind(email).first();

        let sendCount = 0;
        let windowStart = now;

        if (existing?.send_window_start) {
            const windowStartDate = new Date(existing.send_window_start);
            const elapsedMs = now - windowStartDate;
            if (elapsedMs <= 60 * 60 * 1000) {
                sendCount = existing.send_count || 0;
                windowStart = windowStartDate;
            }
        }

        if (sendCount >= 3) {
            return { success: false, error: 'Too many requests. Try again later.' };
        }

        const code = generateNumericCode(6);
        const codeHash = await hashVerificationCode(email, code, env);

        const newCount = sendCount + 1;
        const windowStartIso = windowStart.toISOString();

        await env.DB.prepare(`
            INSERT INTO email_verification_codes (email, code_hash, expires_at, attempts, created_at, last_sent_at, send_count, send_window_start)
            VALUES (?, ?, datetime('now', '+15 minutes'), 0, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                code_hash = excluded.code_hash,
                expires_at = excluded.expires_at,
                attempts = 0,
                last_sent_at = excluded.last_sent_at,
                send_count = excluded.send_count,
                send_window_start = excluded.send_window_start
        `).bind(email, codeHash, nowIso, nowIso, newCount, windowStartIso).run();

        const emailResult = await sendVerificationCodeEmail(email, code, env);
        if (!emailResult.success) {
            return { success: false, error: emailResult.error || 'Failed to send email' };
        }

        return { success: true, message: 'Verification code sent' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleVerifyAuthCode(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const email = body.email?.toLowerCase()?.trim();
    const code = body.code?.trim();
    if (!email || !code) {
        return { success: false, error: 'Email and code required' };
    }


    try {
        const record = await env.DB.prepare(
            'SELECT code_hash, expires_at, attempts FROM email_verification_codes WHERE email = ?'
        ).bind(email).first();

        if (!record) {
            return { success: false, error: 'Code not found. Request a new one.' };
        }

        if (record.attempts >= 5) {
            return { success: false, error: 'Too many attempts. Request a new code.' };
        }

        if (record.expires_at) {
            const expiresAt = new Date(record.expires_at);
            if (Date.now() > expiresAt.getTime()) {
                return { success: false, error: 'Code expired. Request a new one.' };
            }
        }

        const codeHash = await hashVerificationCode(email, code, env);
        if (!codeHash || !timingSafeEqual(codeHash, record.code_hash)) {
            await env.DB.prepare(
                'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?'
            ).bind(email).run();
            return { success: false, error: 'Invalid code' };
        }

        // Ensure user exists
        const user = await env.DB.prepare(
            'SELECT preferences_token, is_pro FROM user_preferences WHERE email = ?'
        ).bind(email).first();

        let token = user?.preferences_token;
        if (!token) {
            token = generateToken();
            if (user) {
                await env.DB.prepare(
                    'UPDATE user_preferences SET preferences_token = ?, updated_at = datetime(\'now\') WHERE email = ?'
                ).bind(token, email).run();
            } else {
                await env.DB.prepare(`
                    INSERT INTO user_preferences (email, is_pro, preferences_token, categories, receive_free_report, updated_at)
                    VALUES (?, 0, ?, '[]', 1, datetime('now'))
                `).bind(email, token).run();
            }
        }

        await env.DB.prepare(
            'DELETE FROM email_verification_codes WHERE email = ?'
        ).bind(email).run();

        return { success: true, token };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ==========================================
// WATCHLIST HANDLERS
// ==========================================

async function handleGetWatchlist(request, url, env) {
    const email = url.searchParams.get('email');
    const token = getRequestToken(request, url);

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

        if (!token) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, token, env))) {
            console.warn(`Invalid token attempt for watchlist GET: ${email}`);
            return { success: false, error: 'Invalid token' };
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

async function handleCheckWatchlist(request, url, env) {
    const email = url.searchParams.get('email');
    const type = url.searchParams.get('type');
    const value = url.searchParams.get('value');
    const token = getRequestToken(request, url);

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    try {
        if (!token) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, token, env))) {
            return { success: false, error: 'Invalid token' };
        }
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
    const authToken = getRequestToken(request, null, token);

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

        if (!authToken) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, authToken, env))) {
            console.warn(`Invalid token attempt for watchlist ADD: ${email}`);
            return { success: false, error: 'Invalid token' };
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
    const authToken = getRequestToken(request, null, token);

    if (!email || !type || !value) {
        return { success: false, error: 'Email, type, and value required' };
    }

    try {
        // Verify user exists and optionally verify token
        const user = await env.DB.prepare(
            'SELECT preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!authToken) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, authToken, env))) {
            console.warn(`Invalid token attempt for watchlist REMOVE: ${email}`);
            return { success: false, error: 'Invalid token' };
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
// SAVED SEARCHES HANDLERS
// ==========================================

async function handleGetSavedSearches(request, url, env) {
    const email = url.searchParams.get('email');
    const token = getRequestToken(request, url);

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    try {
        // Verify user is Pro
        const user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }

        if (!token) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, token, env))) {
            return { success: false, error: 'Invalid token' };
        }

        // Get saved searches
        const result = await env.DB.prepare(`
            SELECT id, name, search_params, created_at
            FROM saved_searches
            WHERE email = ?
            ORDER BY created_at DESC
            LIMIT 50
        `).bind(email.toLowerCase()).all();

        return {
            success: true,
            searches: result.results || []
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleSaveSavedSearch(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return { success: false, error: 'Invalid JSON' };
    }

    const { email, name, search_params, token } = body;
    const authToken = getRequestToken(request, null, token);

    if (!email || !name || !search_params) {
        return { success: false, error: 'Email, name, and search_params required' };
    }

    if (name.length > 100) {
        return { success: false, error: 'Name must be 100 characters or less' };
    }

    try {
        // Verify user is Pro
        const user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }

        if (!authToken) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, authToken, env))) {
            return { success: false, error: 'Invalid token' };
        }

        // Check limit (max 20 saved searches per user)
        const countResult = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM saved_searches WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (countResult && countResult.count >= 20) {
            return { success: false, error: 'Maximum 20 saved searches allowed. Delete some to save more.' };
        }

        // Save the search
        const paramsJson = typeof search_params === 'string' ? search_params : JSON.stringify(search_params);

        await env.DB.prepare(`
            INSERT INTO saved_searches (email, name, search_params)
            VALUES (?, ?, ?)
        `).bind(email.toLowerCase(), name.trim(), paramsJson).run();

        return { success: true, message: 'Search saved' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function handleDeleteSavedSearch(request, url, env) {
    const email = url.searchParams.get('email');
    const id = url.searchParams.get('id');
    const token = getRequestToken(request, url);

    if (!email || !id) {
        return { success: false, error: 'Email and id required' };
    }

    try {
        // Verify user exists
        const user = await env.DB.prepare(
            'SELECT preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!token) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, token, env))) {
            return { success: false, error: 'Invalid token' };
        }

        // Delete the search (only if it belongs to this user)
        await env.DB.prepare(`
            DELETE FROM saved_searches WHERE id = ? AND email = ?
        `).bind(parseInt(id), email.toLowerCase()).run();

        return { success: true, message: 'Search deleted' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ==========================================
// COMPETITOR ACTIVITY HANDLER
// ==========================================

async function handleCompetitorActivity(request, url, env) {
    const email = url.searchParams.get('email');
    const token = getRequestToken(request, url);

    if (!email) {
        return { success: false, error: 'Email required' };
    }

    try {
        // Verify user is Pro
        const user = await env.DB.prepare(
            'SELECT is_pro, preferences_token FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

        if (!user || user.is_pro !== 1) {
            return { success: false, error: 'Pro subscription required' };
        }

        if (!token) {
            return { success: false, error: 'Token required' };
        }
        if (!(await requireValidToken(email, token, env))) {
            return { success: false, error: 'Invalid token' };
        }

        // Get user's watched companies from watchlist
        const watchlistResult = await env.DB.prepare(`
            SELECT value FROM watchlist
            WHERE email = ? AND type = 'company'
        `).bind(email.toLowerCase()).all();

        const watchedCompanies = (watchlistResult.results || []).map(r => r.value);

        if (watchedCompanies.length === 0) {
            return {
                success: true,
                companies: [],
                message: 'No companies in your watchlist'
            };
        }

        // Calculate date boundaries
        const now = new Date();
        const oneWeekAgo = new Date(now);
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const oneMonthAgo = new Date(now);
        oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

        // Format dates for SQL comparison
        const formatDateForSql = (date) => {
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const y = date.getFullYear();
            return `${m}/${d}/${y}`;
        };

        const weekDate = formatDateForSql(oneWeekAgo);
        const monthDate = formatDateForSql(oneMonthAgo);

        // Build activity data for each watched company
        const companyActivity = [];

        for (const companyName of watchedCompanies) {
            // Get company's total, 7-day, and 30-day filing counts
            const statsQuery = `
                SELECT
                    COUNT(*) as total_filings,
                    SUM(CASE WHEN
                        CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) > CAST(SUBSTR(?, 7, 4) AS INTEGER)
                        OR (CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) = CAST(SUBSTR(?, 7, 4) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 1, 2) AS INTEGER) > CAST(SUBSTR(?, 1, 2) AS INTEGER))
                        OR (CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) = CAST(SUBSTR(?, 7, 4) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 1, 2) AS INTEGER) = CAST(SUBSTR(?, 1, 2) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) >= CAST(SUBSTR(?, 4, 2) AS INTEGER))
                    THEN 1 ELSE 0 END) as week_filings,
                    SUM(CASE WHEN
                        CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) > CAST(SUBSTR(?, 7, 4) AS INTEGER)
                        OR (CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) = CAST(SUBSTR(?, 7, 4) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 1, 2) AS INTEGER) > CAST(SUBSTR(?, 1, 2) AS INTEGER))
                        OR (CAST(SUBSTR(approval_date, 7, 4) AS INTEGER) = CAST(SUBSTR(?, 7, 4) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 1, 2) AS INTEGER) = CAST(SUBSTR(?, 1, 2) AS INTEGER)
                            AND CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) >= CAST(SUBSTR(?, 4, 2) AS INTEGER))
                    THEN 1 ELSE 0 END) as month_filings
                FROM colas
                WHERE company_name = ?
            `;

            const statsResult = await env.DB.prepare(statsQuery)
                .bind(weekDate, weekDate, weekDate, weekDate, weekDate, weekDate,
                      monthDate, monthDate, monthDate, monthDate, monthDate, monthDate,
                      companyName).first();

            // Get recent new brands for this company
            const recentBrandsResult = await env.DB.prepare(`
                SELECT DISTINCT brand_name, approval_date, signal
                FROM colas
                WHERE company_name = ? AND signal IN ('NEW_BRAND', 'NEW_COMPANY')
                ORDER BY year DESC, month DESC, day DESC
                LIMIT 5
            `).bind(companyName).all();

            // Get category breakdown
            const categoryResult = await env.DB.prepare(`
                SELECT category, COUNT(*) as count
                FROM colas
                WHERE company_name = ?
                GROUP BY category
                ORDER BY count DESC
                LIMIT 5
            `).bind(companyName).all();

            companyActivity.push({
                company_name: companyName,
                total_filings: statsResult?.total_filings || 0,
                week_filings: statsResult?.week_filings || 0,
                month_filings: statsResult?.month_filings || 0,
                recent_brands: (recentBrandsResult.results || []).map(b => ({
                    name: b.brand_name,
                    date: b.approval_date,
                    signal: b.signal
                })),
                top_categories: (categoryResult.results || []).map(c => ({
                    category: c.category,
                    count: c.count
                }))
            });
        }

        // Sort by month_filings (most active first)
        companyActivity.sort((a, b) => b.month_filings - a.month_filings);

        return {
            success: true,
            companies: companyActivity,
            as_of: new Date().toISOString()
        };
    } catch (e) {
        console.error('Competitor activity error:', e);
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

async function handleSearch(request, url, env) {
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
    const email = params.get('email')?.toLowerCase();
    const token = getRequestToken(request, url);
    let isPro = false;

    if (email && token) {
        try {
            const tokenValid = await requireValidToken(email, token, env);
            if (!tokenValid) {
                console.warn(`Invalid token provided for search: ${email}`);
            }
            const user = await env.DB.prepare(
                'SELECT is_pro FROM user_preferences WHERE LOWER(email) = ?'
            ).bind(email).first();

            if (tokenValid && user?.is_pro === 1) {
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
            const allMappedCodes = getCanonicalMappedCodesForCategory(parentCategory);
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
        // Signal priority for database search: NEW_COMPANY > NEW_BRAND > NEW_SKU > REFILE (interesting signals first)
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

async function handleExport(request, url, env) {
    const params = url.searchParams;

    // Verify Pro status
    const email = params.get('email')?.toLowerCase();
    const token = getRequestToken(request, url);
    if (!email) {
        return { success: false, error: 'Email required for export' };
    }
    if (!token) {
        return { success: false, error: 'Token required' };
    }
    if (!(await requireValidToken(email, token, env))) {
        return { success: false, error: 'Invalid token' };
    }

    try {
        const user = await env.DB.prepare(
            'SELECT is_pro FROM user_preferences WHERE LOWER(email) = ?'
        ).bind(email).first();

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
            const allMappedCodes = getCanonicalMappedCodesForCategory(parentCategory);
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
        // Signal priority for exports: NEW_COMPANY > NEW_BRAND > NEW_SKU > REFILE (interesting signals first)
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

    // Run all supplementary queries in parallel for faster loading
    const [brandWebsite, companyWebsite, permitsResult] = await Promise.all([
        // Brand website lookup
        result.brand_name
            ? env.DB.prepare('SELECT website_url FROM brand_websites WHERE brand_name = ?').bind(result.brand_name).first()
            : Promise.resolve(null),
        // Company website lookup
        result.company_name
            ? env.DB.prepare(`
                SELECT cw.website_url
                FROM company_websites cw
                JOIN company_aliases ca ON ca.company_id = cw.company_id
                WHERE ca.raw_name = ?
            `).bind(result.company_name).first()
            : Promise.resolve(null),
        // Permits lookup
        result.company_name
            ? env.DB.prepare(`
                SELECT p.permit_number, p.industry_type, p.city, p.state, p.is_new
                FROM permits p
                JOIN company_aliases ca ON p.company_id = ca.company_id
                WHERE ca.raw_name = ?
                ORDER BY p.industry_type
            `).bind(result.company_name).all()
            : Promise.resolve({ results: [] })
    ]);

    // Determine website URL (brand first, company fallback)
    const websiteUrl = brandWebsite?.website_url || companyWebsite?.website_url || null;
    const permits = permitsResult.results || [];

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
    // Run queries in parallel
    const [stats, totalCompanies, activeCompanies] = await Promise.all([
        env.DB.prepare(`
            SELECT
                COUNT(*) as total,
                COUNT(DISTINCT origin_code) as origins,
                COUNT(DISTINCT class_type_code) as class_types,
                MIN(approval_date) as oldest,
                MAX(approval_date) as newest
            FROM colas
        `).first(),
        env.DB.prepare(`SELECT COUNT(*) as count FROM companies`).first(),
        env.DB.prepare(`
            SELECT COUNT(DISTINCT company_name) as count
            FROM colas
            WHERE year >= 2023
        `).first()
    ]);

    return {
        success: true,
        stats: {
            ...stats,
            total_companies: totalCompanies?.count || 0,
            active_companies_3yr: activeCompanies?.count || 0
        }
    };
}

// ==========================================
// PERMIT LEADS HANDLERS
// ==========================================

async function handlePermitLeads(request, url, env) {
    const params = url.searchParams;
    const page = Math.max(1, parseInt(params.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || 20));
    const offset = (page - 1) * limit;

    // Filter options
    const permitType = params.get('permit_type'); // Importer, Distillery, Winery, Wholesaler
    const state = params.get('state');
    const newOnly = params.get('new_only') === '1';
    const search = params.get('search')?.trim();
    const hasColaFilings = params.get('has_cola'); // '1' = matched, '0' = unmatched, '' = all

    // Check Pro access
    const email = params.get('email')?.toLowerCase();
    const token = getRequestToken(request, url);
    if (!email) {
        return { success: false, error: 'Email required' };
    }
    if (!token) {
        return { success: false, error: 'Token required' };
    }
    let isPro = false;
    if (email && token) {
        try {
            if (!(await requireValidToken(email, token, env))) {
                return { success: false, error: 'Invalid token' };
            }
            const user = await env.DB.prepare(
                'SELECT is_pro FROM user_preferences WHERE LOWER(email) = ?'
            ).bind(email).first();
            if (user?.is_pro === 1) isPro = true;
        } catch (e) {}
    }

    if (!isPro) {
        return { success: false, error: 'Pro subscription required for permits access' };
    }

    // Build WHERE clause - show ALL permits by default
    let whereClause = '1=1';
    const queryParams = [];

    // Exclude wholesalers by default unless explicitly requested
    if (permitType !== 'Wholesaler') {
        whereClause += " AND industry_type != 'Wholesaler (Alcohol)'";
    }

    if (permitType) {
        const typeMap = {
            'Importer': 'Importer (Alcohol)',
            'Distillery': 'Distilled Spirits Plant',
            'Winery': 'Wine Producer',
            'Wholesaler': 'Wholesaler (Alcohol)'
        };
        const dbType = typeMap[permitType] || permitType;
        whereClause += ' AND industry_type = ?';
        queryParams.push(dbType);
    }

    if (state) {
        whereClause += ' AND state = ?';
        queryParams.push(state.toUpperCase());
    }

    if (newOnly) {
        whereClause += ' AND is_new = 1';
    }

    if (search && search.length >= 2) {
        whereClause += ' AND (owner_name LIKE ? OR operating_name LIKE ? OR permit_number LIKE ?)';
        const searchPattern = `%${search}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    if (hasColaFilings === '1') {
        whereClause += ' AND company_id IS NOT NULL';
    } else if (hasColaFilings === '0') {
        whereClause += ' AND company_id IS NULL';
    }

    // Count total
    const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM permits WHERE ${whereClause}`
    ).bind(...queryParams).first();
    const total = countResult?.total || 0;

    // Get permits
    const dataResult = await env.DB.prepare(`
        SELECT permit_number, owner_name, operating_name, street, city, state, zip, county, industry_type, is_new, company_id, first_seen_at, updated_at
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

async function handlePermitsContacts(request, env) {
    // Get permit company contacts using PDL Person Search
    try {
        const body = await request.json();
        const { company_name, permit_number, email } = body;

        if (!company_name) {
            return { success: false, error: 'Company name required' };
        }

        // Check if user is authenticated
        if (!email) {
            return { success: false, error: 'Please log in to access contacts' };
        }

        // Search for contacts using the multi-tier contact search function
        // For permits, we don't have brand name or website, so pass null for both
        const result = await searchCompanyContacts(company_name, null, null, env);

        return {
            success: true,
            contacts: result.contacts || [],
            company_name,
            searched_name: result.searched_name || company_name,
            debug: result.debug || null
        };

    } catch (error) {
        console.error('[PermitsContacts] Error:', error);
        return {
            success: false,
            error: error.message || 'Failed to fetch contacts'
        };
    }
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

function fixDisplayName(name) {
    if (!name) return name;
    const upperWords = new Set(['LLC', 'USA', 'DBA', 'LP', 'LLP', 'INC']);
    const properWords = { 'inc': 'Inc', 'co': 'Co', 'corp': 'Corp', 'ltd': 'Ltd' };
    return name.replace(/\b\w+/g, word => {
        const upper = word.toUpperCase();
        if (upperWords.has(upper)) return upper;
        const lower = word.toLowerCase();
        if (properWords[lower]) return properWords[lower];
        return word;
    });
}

// Parse TTB state field ("OWENSBORO, KY 42303") into structured address parts
function parseLocation(stateStr) {
    if (!stateStr) return null;
    const s = stateStr.trim();
    // Pattern: "CITY, ST ZIP" or "CITY, ST" or "ST ZIP" or "ST"
    const fullMatch = s.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (fullMatch) {
        return {
            addressLocality: fullMatch[1].replace(/\b\w+/g, w => w.charAt(0) + w.slice(1).toLowerCase()),
            addressRegion: fullMatch[2],
            postalCode: fullMatch[3]
        };
    }
    const cityStateMatch = s.match(/^(.+?),\s*([A-Z]{2})$/);
    if (cityStateMatch) {
        return {
            addressLocality: cityStateMatch[1].replace(/\b\w+/g, w => w.charAt(0) + w.slice(1).toLowerCase()),
            addressRegion: cityStateMatch[2]
        };
    }
    const stateZipMatch = s.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
        return { addressRegion: stateZipMatch[1], postalCode: stateZipMatch[2] };
    }
    const stateOnly = s.match(/^([A-Z]{2})$/);
    if (stateOnly) {
        return { addressRegion: stateOnly[1] };
    }
    return { addressRegion: s };
}

// Convert "MM/DD/YYYY" approval_date to ISO "YYYY-MM-DD"
function approvalDateToISO(approvalDate) {
    if (!approvalDate) return null;
    const parts = approvalDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!parts) return null;
    return `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

// Convert numeric date (20260115) to ISO "YYYY-MM-DD"
function numericDateToISO(num) {
    if (!num) return null;
    const y = Math.floor(num / 10000);
    const m = Math.floor((num % 10000) / 100);
    const d = num % 100;
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getPageLayout(title, description, content, jsonLd = null, canonical = null, extraHead = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | BevAlc Intelligence</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical || BASE_URL}">
    <meta property="og:image" content="${BASE_URL}/favicon-192.png">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary">
    ${extraHead}
    <link rel="canonical" href="${canonical || BASE_URL}">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
    <link rel="stylesheet" href="/seo-pages.css">
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
                    <div class="footer-heading">Categories</div>
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
                    <div class="footer-heading">Resources</div>
                    <ul>
                        <li><a href="/database.html">Search Database</a></li>
                        <li><a href="/glossary/">Glossary</a></li>
                        <li><a href="/locations/">Locations</a></li>
                        <li><a href="/best/">Rankings</a></li>
                        <li><a href="/#pricing">Pricing</a></li>
                    </ul>
                </div>
                <div class="footer-column">
                    <div class="footer-heading">Legal</div>
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
    <script src="/seo-pages.js"></script>
</body>
</html>`;
}

// ==========================================
// COLA DETAIL PAGE HANDLER
// ==========================================

const R2_PUBLIC_URL = 'https://pub-1c889ae594b041a3b752c6c891eb718e.r2.dev';

// Deduplicate comma-separated company names like "Name, INC, NAME, INC."
function deduplicateCompanyName(name) {
    if (!name || !name.includes(',')) return name;
    // Try splitting at each comma — if two halves match (case-insensitive), keep only the first
    for (let i = 0; i < name.length; i++) {
        if (name[i] === ',') {
            const first = name.slice(0, i).trim().toUpperCase().replace(/\.+$/, '');
            const second = name.slice(i + 1).trim().toUpperCase().replace(/\.+$/, '');
            if (first === second) {
                return name.slice(0, i).trim();
            }
        }
    }
    return name;
}

async function handleColaPage(path, env) {
    const ttbId = path.replace('/cola/', '').replace(/\/$/, '');
    if (!ttbId) {
        return new Response('Not Found', { status: 404 });
    }

    try {
        // Q1: Full COLA record
        const cola = await env.DB.prepare('SELECT * FROM colas WHERE ttb_id = ?').bind(ttbId).first();
        if (!cola) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/html' } });
        }

        // Run remaining queries in parallel
        const [imagesResult, permitsResult, companyCountResult] = await Promise.all([
            // Q2: All images for this COLA
            env.DB.prepare(`
                SELECT image_id, label_type, r2_key, width, height,
                       ocr_abv, ocr_volume_ml, ocr_proof, ocr_age_years
                FROM cola_images
                WHERE ttb_id = ? AND download_status = 'success'
                ORDER BY image_id
            `).bind(ttbId).all(),

            // Q3: Permits via company alias join
            env.DB.prepare(`
                SELECT p.permit_number, p.industry_type, p.city, p.state
                FROM permits p
                JOIN company_aliases ca ON p.company_id = ca.company_id
                WHERE ca.raw_name = ?
                ORDER BY p.industry_type
            `).bind(cola.company_name || '').all(),

            // Q4: Total filings by same company
            env.DB.prepare('SELECT COUNT(*) as cnt FROM colas WHERE company_name = ?')
                .bind(cola.company_name || '').first()
        ]);

        const images = imagesResult?.results || [];
        const permits = permitsResult?.results || [];
        const companyFilingCount = companyCountResult?.cnt || 0;
        const isEnriched = !!cola.enriched_at;

        const displayBrand = fixDisplayName(cola.brand_name) || 'Unknown Brand';
        const displayFanciful = cola.fanciful_name ? fixDisplayName(cola.fanciful_name) : '';
        const fullName = displayFanciful ? `${displayBrand} ${displayFanciful}` : displayBrand;
        const companySlug = makeSlug(cola.company_name);
        const brandSlug = makeSlug(cola.brand_name);
        const displayCategory = getCategory(cola.class_type_code);

        // --- Build page sections ---
        let content = '<div class="seo-page">';

        // 1. Hero Section
        const signalClass = cola.signal ? `signal-${cola.signal.toLowerCase().replace(/_/g, '-')}` : '';
        const statusText = cola.status || 'Approved';
        const statusClass = statusText.toLowerCase() === 'approved' ? 'cola-status-approved' :
                            statusText.toLowerCase() === 'surrendered' ? 'cola-status-surrendered' : 'cola-status-other';

        content += `
        <div class="seo-header">
            <div class="seo-header-inner">
                <div class="breadcrumb">
                    <a href="/">Home</a> &rsaquo; <a href="/database.html">Database</a> &rsaquo; ${escapeHtml(displayBrand)}
                </div>
                <h1>${escapeHtml(fullName)}</h1>
                <div class="meta">
                    <span>TTB ID: <strong>${escapeHtml(ttbId)}</strong></span>
                    ${cola.approval_date ? `<span>Approved: <strong>${escapeHtml(cola.approval_date)}</strong></span>` : ''}
                    <span class="cola-status-badge ${statusClass}">${escapeHtml(statusText)}</span>
                    ${cola.signal ? `<span class="signal-badge ${signalClass}">${escapeHtml(cola.signal.replace(/_/g, ' '))}</span>` : ''}
                    ${isEnriched && cola.enrichment_confidence ? `<span class="cola-confidence-badge cola-confidence-${cola.enrichment_confidence}">${escapeHtml(cola.enrichment_confidence)} confidence</span>` : ''}
                </div>
                ${isEnriched && cola.super_category ? `
                <div class="cola-taxonomy-breadcrumb">
                    ${escapeHtml(cola.super_category)}
                    ${cola.commercial_category ? ` <span class="cola-tax-sep">&rsaquo;</span> ${escapeHtml(cola.commercial_category)}` : ''}
                    ${cola.subcategory ? ` <span class="cola-tax-sep">&rsaquo;</span> ${escapeHtml(cola.subcategory)}` : ''}
                </div>` : `
                <div class="cola-taxonomy-breadcrumb">${escapeHtml(displayCategory)}</div>`}
            </div>
        </div>`;

        // 2. Label Images
        if (images.length > 0) {
            content += '<div class="cola-images-grid">';
            for (const img of images) {
                const imgUrl = img.r2_key ? `${R2_PUBLIC_URL}/${img.r2_key}` : '';
                if (!imgUrl) continue;
                const caption = img.label_type || 'label';
                content += `
                <a href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener" class="cola-image-card">
                    <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(fullName)} ${escapeHtml(caption)} label" loading="lazy"${img.width ? ` width="${img.width}"` : ''}${img.height ? ` height="${img.height}"` : ''}>
                    <div class="cola-image-caption">${escapeHtml(caption)}</div>
                </a>`;
            }
            content += '</div>';
        } else {
            content += '<div class="cola-no-images">Label images not yet available</div>';
        }

        // 3. Product Intelligence (enriched only)
        if (isEnriched) {
            content += '<div class="cola-section"><h2>Product Intelligence</h2>';

            if (cola.product_description) {
                content += `<div class="cola-description"><p>${escapeHtml(cola.product_description)}</p></div>`;
            }

            // Flavor Profile
            if (cola.flavor_profile) {
                let flavors;
                try { flavors = JSON.parse(cola.flavor_profile); } catch (e) { flavors = null; }
                if (flavors && Array.isArray(flavors) && flavors.length > 0) {
                    content += '<div class="cola-detail-item cola-detail-full" style="margin-bottom:16px"><span class="cola-detail-label">Flavor Profile</span><div class="cola-flavor-tags">';
                    for (const f of flavors) {
                        content += `<span class="cola-flavor-tag">${escapeHtml(f)}</span>`;
                    }
                    content += '</div></div>';
                }
            }

            // Tasting Notes
            if (cola.tasting_notes_raw) {
                content += `<div class="cola-detail-item cola-detail-full" style="margin-bottom:16px"><span class="cola-detail-label">Tasting Notes (from label)</span><span class="cola-detail-value" style="font-style:italic">&ldquo;${escapeHtml(cola.tasting_notes_raw)}&rdquo;</span></div>`;
            }

            // Production details grid
            const prodFields = [
                ['Production Method', cola.production_method],
                ['Barrel Type', cola.barrel_type],
                ['Finishing Process', cola.finishing_process],
                ['Age', cola.age_years ? `${cola.age_years} years` : null],
                ['Packaging Format', cola.packaging_format],
            ].filter(f => f[1]);

            if (prodFields.length > 0) {
                content += '<div class="cola-detail-grid">';
                for (const [label, value] of prodFields) {
                    content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(String(value))}</span></div>`;
                }
                content += '</div>';
            }

            // Boolean pills
            const boolFlags = [
                ['Cask Strength', cola.is_cask_strength],
                ['Single Barrel', cola.is_single_barrel],
                ['Limited Release', cola.is_limited_release],
                ['Organic', cola.is_organic],
                ['Gluten Free', cola.is_gluten_free],
            ].filter(f => f[1] !== null && f[1] !== undefined);

            if (boolFlags.length > 0) {
                content += '<div class="cola-pills" style="margin-top:16px">';
                for (const [label, val] of boolFlags) {
                    const isTrue = val === 1 || val === true;
                    content += `<span class="cola-pill ${isTrue ? 'cola-pill-true' : 'cola-pill-false'}">${isTrue ? '&#10003;' : '&#10005;'} ${escapeHtml(label)}</span>`;
                }
                content += '</div>';
            }

            content += '</div>'; // end .cola-section

            // 4. Production & Sourcing
            const sourcingFields = [
                ['Distilled In', cola.distilled_in],
                ['Bottled By', cola.bottled_by],
                ['Bottled In', cola.bottled_in],
                ['Imported By', cola.imported_by],
                ['Year Established', cola.year_established],
                ['Parent Company', cola.parent_company],
            ].filter(f => f[1]);

            if (sourcingFields.length > 0) {
                content += '<div class="cola-section"><h2>Production &amp; Sourcing</h2><div class="cola-detail-grid">';
                for (const [label, value] of sourcingFields) {
                    content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(String(value))}</span></div>`;
                }
                content += '</div></div>';
            }

            // 5. Market & Pricing
            if (cola.estimated_price_tier || cola.target_market) {
                content += '<div class="cola-section"><h2>Market &amp; Pricing</h2><div class="cola-detail-grid">';
                if (cola.estimated_price_tier) {
                    const tierClass = `cola-price-${cola.estimated_price_tier.replace(/\s+/g, '-')}`;
                    content += `<div class="cola-detail-item"><span class="cola-detail-label">Estimated Price Tier</span><span class="cola-price-tier ${tierClass}">${escapeHtml(cola.estimated_price_tier)}</span></div>`;
                }
                if (cola.target_market) {
                    content += `<div class="cola-detail-item"><span class="cola-detail-label">Target Market</span><span class="cola-detail-value">${escapeHtml(cola.target_market)}</span></div>`;
                }
                content += '</div></div>';
            }

            // 6. Label Contact Info
            const contactFields = [
                ['Website', cola.label_website, true],
                ['Email', cola.label_email],
                ['Phone', cola.label_phone],
                ['Tagline', cola.label_tagline],
            ].filter(f => f[1]);

            let socialMedia = null;
            if (cola.label_social_media) {
                try { socialMedia = JSON.parse(cola.label_social_media); } catch (e) { socialMedia = null; }
            }

            if (contactFields.length > 0 || (socialMedia && socialMedia.length > 0)) {
                content += '<div class="cola-section"><h2>Label Contact Info</h2><div class="cola-detail-grid">';
                for (const [label, value, isLink] of contactFields) {
                    if (isLink && value) {
                        const href = value.startsWith('http') ? value : `https://${value}`;
                        content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value"><a href="${escapeHtml(href)}" target="_blank" rel="noopener nofollow">${escapeHtml(value)}</a></span></div>`;
                    } else {
                        content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(value)}</span></div>`;
                    }
                }
                if (socialMedia && socialMedia.length > 0) {
                    content += `<div class="cola-detail-item cola-detail-full"><span class="cola-detail-label">Social Media</span><span class="cola-detail-value">${socialMedia.map(s => escapeHtml(s)).join(', ')}</span></div>`;
                }
                content += '</div></div>';
            }
        } else {
            // Non-enriched placeholder
            content += `
            <div class="cola-section cola-not-enriched">
                <h2>Product Intelligence</h2>
                <p>This product has not been enriched yet. Product intelligence including classification,
                flavor profile, and production details will be available soon.</p>
            </div>`;
        }

        // 7. Alcohol & Volume
        const bestImage = images.find(i => i.ocr_abv) || images[0] || {};
        const alcoholFields = [
            ['Alcohol Content (TTB)', cola.alcohol_content],
            ['ABV (Label OCR)', bestImage.ocr_abv ? `${bestImage.ocr_abv}%` : null],
            ['Volume (Label OCR)', bestImage.ocr_volume_ml ? `${bestImage.ocr_volume_ml} mL` : null],
            ['Proof (Label OCR)', bestImage.ocr_proof],
            ['Total Bottle Capacity', cola.total_bottle_capacity],
        ].filter(f => f[1]);

        if (alcoholFields.length > 0) {
            content += '<div class="cola-section"><h2>Alcohol &amp; Volume</h2><div class="cola-detail-grid">';
            for (const [label, value] of alcoholFields) {
                content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(String(value))}</span></div>`;
            }
            content += '</div></div>';
        }

        // 8. TTB Filing Data
        const ttbFields = [
            ['Status', cola.status],
            ['Approval Date', cola.approval_date],
            ['Class/Type Code', cola.class_type_code],
            ['Origin', cola.origin_code],
            ['Vendor Code', cola.vendor_code],
            ['Serial Number', cola.serial_number],
            ['Plant Registry', cola.plant_registry],
            ['Qualifications', cola.qualifications],
            ['For Sale In', cola.for_sale_in],
            ['Type of Application', cola.type_of_application],
        ].filter(f => f[1]);

        // Wine fields
        const wineFields = [
            ['Grape Varietal', cola.grape_varietal],
            ['Wine Vintage', cola.wine_vintage],
            ['Appellation', cola.appellation],
            ['pH Level', cola.ph_level],
        ].filter(f => f[1]);

        if (ttbFields.length > 0) {
            content += '<div class="cola-section"><h2>TTB Filing Data</h2><div class="cola-detail-grid">';
            for (const [label, value] of ttbFields) {
                content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(String(value))}</span></div>`;
            }
            if (cola.formula) {
                content += `<div class="cola-detail-item cola-detail-full"><span class="cola-detail-label">Formula</span><span class="cola-detail-value">${escapeHtml(cola.formula)}</span></div>`;
            }
            content += '</div>';

            // Wine fields sub-section
            if (wineFields.length > 0) {
                content += '<div class="cola-detail-grid" style="margin-top:20px;padding-top:20px;border-top:1px solid #f1f5f9">';
                for (const [label, value] of wineFields) {
                    content += `<div class="cola-detail-item"><span class="cola-detail-label">${escapeHtml(label)}</span><span class="cola-detail-value">${escapeHtml(String(value))}</span></div>`;
                }
                content += '</div>';
            }

            content += '</div>';
        }

        // 9. Company Information
        const displayCompany = deduplicateCompanyName(fixDisplayName(cola.company_name));
        content += '<div class="cola-section"><h2>Company Information</h2><div class="cola-detail-grid">';
        if (cola.company_name) {
            content += `<div class="cola-detail-item"><span class="cola-detail-label">Company</span><span class="cola-detail-value"><a href="/company/${escapeHtml(companySlug)}">${escapeHtml(displayCompany)}</a></span></div>`;
        }
        if (cola.state) {
            content += `<div class="cola-detail-item"><span class="cola-detail-label">Location</span><span class="cola-detail-value">${escapeHtml(cola.state)}</span></div>`;
        }
        if (cola.street) {
            content += `<div class="cola-detail-item"><span class="cola-detail-label">Address</span><span class="cola-detail-value">${escapeHtml(cola.street)}</span></div>`;
        }
        content += '</div>';

        // Permits
        if (permits.length > 0) {
            content += '<div class="cola-permits" style="margin-top:16px">';
            for (const p of permits) {
                content += `<span class="cola-permit-badge">${escapeHtml(p.permit_number)} (${escapeHtml(p.industry_type || 'Permit')})</span>`;
            }
            content += '</div>';
        }

        // Link to all filings
        if (companyFilingCount > 1 && companySlug) {
            content += `<div style="margin-top:16px"><a href="/company/${escapeHtml(companySlug)}" style="color:#0d9488;font-weight:600;text-decoration:none;font-size:0.9rem">View all ${formatNumber(companyFilingCount)} filings from this company &rarr;</a></div>`;
        }

        content += '</div>'; // end company section

        // Related links
        content += `
        <div class="related-links">
            <div class="related-heading">Explore More</div>
            ${brandSlug ? `<a href="/brand/${escapeHtml(brandSlug)}">${escapeHtml(displayBrand)} Brand Page</a>` : ''}
            ${companySlug ? `<a href="/company/${escapeHtml(companySlug)}">${escapeHtml(displayCompany)}</a>` : ''}
            <a href="/${getCategorySlug(displayCategory)}/">${escapeHtml(displayCategory)} Category</a>
            <a href="/database.html">Search Database</a>
        </div>`;

        content += '</div>'; // end .seo-page

        // SEO
        const metaDescription = isEnriched && cola.product_description
            ? cola.product_description.slice(0, 155)
            : `${fullName} - ${cola.class_type_code || 'Beverage'} from ${displayCompany}. TTB COLA approval #${ttbId}.`;

        const canonical = `${BASE_URL}/cola/${ttbId}/`;

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: fullName,
            description: isEnriched && cola.product_description ? cola.product_description : `${fullName} by ${displayCompany}`,
            brand: { '@type': 'Brand', name: displayBrand },
            category: isEnriched && cola.commercial_category ? cola.commercial_category : displayCategory,
            url: canonical,
        };

        if (images.length > 0 && images[0].r2_key) {
            jsonLd.image = `${R2_PUBLIC_URL}/${images[0].r2_key}`;
        }

        const pageTitle = `${fullName} - COLA ${ttbId}`;
        const html = getPageLayout(pageTitle, metaDescription, content, jsonLd, canonical);

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=3600, s-maxage=86400',
            }
        });

    } catch (err) {
        console.error('COLA page error:', err);
        return new Response('Internal Server Error', { status: 500 });
    }
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

    company.display_name = fixDisplayName(company.display_name);

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
                ORDER BY COALESCE(co.year, 9999) DESC, COALESCE(co.month, 99) DESC, COALESCE(co.day, 99) DESC, CASE co.signal WHEN 'REFILE' THEN 1 WHEN 'NEW_SKU' THEN 2 WHEN 'NEW_BRAND' THEN 3 WHEN 'NEW_COMPANY' THEN 4 ELSE 5 END, co.ttb_id DESC
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
                ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, COALESCE(day, 99) DESC, CASE signal WHEN 'REFILE' THEN 1 WHEN 'NEW_SKU' THEN 2 WHEN 'NEW_BRAND' THEN 3 WHEN 'NEW_COMPANY' THEN 4 ELSE 5 END, ttb_id DESC
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

    // Generate narrative sentences from data
    const companyNarrative = (() => {
        const sentences = [];
        // Category dominance sentence
        if (categoryBars.length > 0 && categoryBars[0].pct >= 60) {
            sentences.push(`${categoryBars[0].name} accounts for <strong>${categoryBars[0].pct}%</strong> of their portfolio, making it their dominant product category.`);
        } else if (categoryBars.length >= 2) {
            sentences.push(`Their product mix spans <strong>${categoryBars[0].name}</strong> (${categoryBars[0].pct}%) and <strong>${categoryBars[1].name}</strong> (${categoryBars[1].pct}%), showing a diversified portfolio.`);
        }
        // Recent signal activity
        const newBrandCount = recentFilings.filter(f => f.signal === 'NEW_BRAND').length;
        const newSkuCount = recentFilings.filter(f => f.signal === 'NEW_SKU').length;
        if (newBrandCount >= 2) {
            sentences.push(`Among their most recent filings, <strong>${newBrandCount}</strong> are new brand launches — a sign of active market expansion.`);
        } else if (newSkuCount >= 3) {
            sentences.push(`Their latest filings include <strong>${newSkuCount}</strong> new product variants, indicating ongoing line extensions.`);
        }
        // Scale context
        const total = company.total_filings;
        if (total >= 500) {
            sentences.push(`With <strong>${formatNumber(total)}</strong> total filings, this is one of the more prolific filers in the beverage alcohol industry.`);
        } else if (total >= 50 && earliestYear) {
            const span = new Date().getFullYear() - earliestYear;
            if (span > 0) sentences.push(`Over <strong>${span} years</strong> of filing history, they have built a steady portfolio of <strong>${formatNumber(total)}</strong> products.`);
        }
        return sentences.join(' ');
    })();

    const title = `${company.display_name} Brands & Portfolio`;

    // SEO-optimized meta description (max 155 chars)
    // Template: "[Company Name]: [X] product filings since [earliest year], [Y] brands, based in [City, State]. See their full portfolio and latest launches."
    let metaDesc = `${company.display_name}: ${formatNumber(company.total_filings)} product filings`;
    if (earliestYear) metaDesc += ` since ${earliestYear}`;
    metaDesc += `, ${formatNumber(brands.length)}+ brands`;
    if (primaryLocation) metaDesc += `, based in ${primaryLocation}`;
    const descSuffix = 'See their full portfolio and latest launches.';
    metaDesc = metaDesc.replace(/\.+$/, '') + `. ${descSuffix}`;
    // Truncate intelligently if over 155 chars
    if (metaDesc.length > 155) {
        metaDesc = `${company.display_name}: ${formatNumber(company.total_filings)} filings, ${formatNumber(brands.length)}+ brands. See their full portfolio.`;
    }
    const description = metaDesc;

    // Schema markup with structured address
    const parsedAddr = parseLocation(primaryLocation);
    const latestCompanyDate = approvalDateToISO(recentFilings[0]?.approval_date);
    const jsonLd = [
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": company.canonical_name,
            "url": `${BASE_URL}/company/${slug}`,
            "description": `Beverage alcohol company with ${formatNumber(company.total_filings)} product filings and ${formatNumber(brands.length)}+ brands`,
            ...(parsedAddr && {
                "address": {
                    "@type": "PostalAddress",
                    ...parsedAddr
                }
            }),
            ...(latestCompanyDate && { "dateModified": latestCompanyDate }),
            "brand": brands.slice(0, 10).map(b => ({
                "@type": "Brand",
                "name": b.brand_name
            }))
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                { "@type": "ListItem", "position": 2, "name": "Database", "item": `${BASE_URL}/database.html` },
                { "@type": "ListItem", "position": 3, "name": company.display_name }
            ]
        }
    ];

    const content = `
        <header class="seo-header">
            <div class="seo-header-inner">
                <div class="breadcrumb">
                    <a href="/">Home</a> / <a href="/database.html">Database</a> / ${escapeHtml(company.display_name)}
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
                        ${companyNarrative}
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
                                        const signalClasses = { 'NEW_COMPANY': 'signal-new-company', 'NEW_BRAND': 'signal-new-brand', 'NEW_SKU': 'signal-new-sku', 'REFILE': 'signal-refile' };
                                        const signalLabels = { 'NEW_COMPANY': 'New Company', 'NEW_BRAND': 'New Brand', 'NEW_SKU': 'New SKU', 'REFILE': 'Refile' };
                                        const sigClass = signalClasses[f.signal] || 'signal-refile';
                                        const sigLabel = signalLabels[f.signal] || f.signal || '-';
                                        return `
                                        <tr>
                                            <td><a href="/brand/${makeSlug(f.brand_name)}"><strong>${escapeHtml(f.brand_name)}</strong></a></td>
                                            <td>${escapeHtml(f.fanciful_name || '-')}</td>
                                            <td style="font-size: 0.8rem; color: #64748b;">${escapeHtml(filingEntity)}</td>
                                            <td>${escapeHtml(f.approval_date)}</td>
                                            <td><span class="signal-gated"><span class="signal-badge ${sigClass}">${sigLabel}</span><span class="signal-lock" onclick="window.location.href='/#pricing'">PRO</span></span></td>
                                        </tr>
                                    `}).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="gate-overlay">
                            <div class="gate-content">
                                <div class="gate-title">Sign Up to View All Filings</div>
                                <p>Get free access to ${escapeHtml(company.display_name)}'s complete filing history</p>
                                <a href="/#signup" class="btn">Get Free Access</a>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="related-links">
                    <div class="related-heading">Related Companies</div>
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
        SELECT co.company_name, c.id as company_id, c.canonical_name, c.slug, COUNT(*) as filing_count
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
        ORDER BY COALESCE(year, 9999) DESC, COALESCE(month, 99) DESC, CAST(SUBSTR(approval_date, 4, 2) AS INTEGER) DESC, CASE signal WHEN 'REFILE' THEN 1 WHEN 'NEW_SKU' THEN 2 WHEN 'NEW_BRAND' THEN 3 WHEN 'NEW_COMPANY' THEN 4 ELSE 5 END, ttb_id DESC
        LIMIT 15
    `).bind(...brandVariants).all();
    const products = productsResult.results || [];

    // Related brands (same category) + other brands from same company — parallel queries
    const [relatedBrandsResult, companyBrandsResult] = await Promise.all([
        categoryResult?.class_type_code ? env.DB.prepare(`
            SELECT brand_name, COUNT(*) as cnt
            FROM colas
            WHERE class_type_code = ? AND brand_name NOT IN (${placeholders})
            GROUP BY brand_name
            ORDER BY cnt DESC
            LIMIT 8
        `).bind(categoryResult.class_type_code, ...brandVariants).all() : Promise.resolve({ results: [] }),
        companyResult?.company_id ? env.DB.prepare(`
            SELECT co.brand_name, COUNT(*) as cnt
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            WHERE ca.company_id = ? AND co.brand_name NOT IN (${placeholders})
            GROUP BY co.brand_name
            ORDER BY cnt DESC
            LIMIT 8
        `).bind(companyResult.company_id, ...brandVariants).all() : Promise.resolve({ results: [] })
    ]);
    // Deduplicate related brands by slug to prevent misspelling variants (e.g., MARKERS MARK vs MAKER'S MARK)
    const dedupeBySlug = (brands, currentSlug) => {
        const seen = new Set([currentSlug]);
        const dupes = [];
        const unique = brands.filter(b => {
            const s = makeSlug(b.brand_name);
            if (seen.has(s)) { dupes.push(b.brand_name); return false; }
            seen.add(s);
            return true;
        });
        if (dupes.length > 0) console.log(`[brand-dedup] ${currentSlug}: filtered ${dupes.length} variant(s): ${dupes.join(', ')}`);
        return unique;
    };
    const relatedBrands = dedupeBySlug(relatedBrandsResult.results || [], slug);
    const companyBrands = dedupeBySlug(companyBrandsResult.results || [], slug);

    const maxTimeline = Math.max(...timeline.map(t => t.cnt), 1);
    const earliestYear = timeline.length > 0 ? Math.min(...timeline.map(t => t.year).filter(y => y)) : null;

    const title = `${brand.brand_name} Brand Filings & Portfolio`;

    // SEO-optimized meta description (max 155 chars)
    // Template: "[Brand]: X product filings since [year], [category]. By [company]. See product timeline and latest launches."
    let metaDesc = `${brand.brand_name}: ${formatNumber(brand.cnt)} product ${brand.cnt === 1 ? 'filing' : 'filings'}`;
    if (earliestYear) metaDesc += ` since ${earliestYear}`;
    metaDesc += `, ${primaryCategory}`;
    if (companyResult?.canonical_name) {
        const compName = companyResult.canonical_name.replace(/\.+$/, '');
        metaDesc += `. By ${compName}`;
    }
    metaDesc += `. See product timeline and latest launches.`;
    if (metaDesc.length > 155) {
        metaDesc = `${brand.brand_name}: ${formatNumber(brand.cnt)} ${primaryCategory} ${brand.cnt === 1 ? 'filing' : 'filings'}. See product timeline.`;
    }
    const description = metaDesc;

    // Generate narrative sentences from existing data
    const brandNarrative = (() => {
        const sentences = [];
        // Origin and history
        if (earliestYear && products[0]?.approval_date) {
            const latestDate = products[0].approval_date;
            sentences.push(`${escapeHtml(brand.brand_name)} first appeared in TTB filings in <strong>${earliestYear}</strong>, with the most recent filing on <strong>${latestDate}</strong>.`);
        } else if (earliestYear) {
            sentences.push(`${escapeHtml(brand.brand_name)} first appeared in TTB filings in <strong>${earliestYear}</strong>.`);
        }
        // YoY trend from timeline
        if (timeline.length >= 2) {
            const current = timeline[0];
            const previous = timeline[1];
            if (current.cnt > 0 && previous.cnt > 0) {
                const change = Math.round(((current.cnt - previous.cnt) / previous.cnt) * 100);
                if (change > 10) {
                    sentences.push(`Filing activity increased <strong>${change}%</strong> in ${current.year} compared to ${previous.year}, suggesting accelerating product development.`);
                } else if (change < -10) {
                    sentences.push(`Filing activity decreased <strong>${Math.abs(change)}%</strong> in ${current.year} versus ${previous.year}.`);
                } else {
                    sentences.push(`Filing volume held steady between ${previous.year} and ${current.year}, with <strong>${current.cnt}</strong> filings in the latest year.`);
                }
            }
        }
        // New SKU count
        if (timeline.length > 0 && timeline[0].new_skus >= 2) {
            sentences.push(`In ${timeline[0].year}, <strong>${timeline[0].new_skus}</strong> new product variants were introduced under this brand.`);
        }
        return sentences.join(' ');
    })();

    const latestBrandDate = approvalDateToISO(products[0]?.approval_date);
    const jsonLd = [
        {
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
            }),
            ...(latestBrandDate && { "dateModified": latestBrandDate })
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                { "@type": "ListItem", "position": 2, "name": "Database", "item": `${BASE_URL}/database.html` },
                { "@type": "ListItem", "position": 3, "name": brand.brand_name }
            ]
        }
    ];

    const content = `
        <header class="seo-header">
            <div class="seo-header-inner">
                <div class="breadcrumb">
                    <a href="/">Home</a> / <a href="/database.html">Database</a> / ${escapeHtml(brand.brand_name)}
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
                ${brandNarrative ? `<section class="seo-card" style="margin-bottom: 32px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
                    <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                        ${brandNarrative}
                    </p>
                </section>` : ''}
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
                                    ${products.map(p => {
                                        const signalClasses = { 'NEW_COMPANY': 'signal-new-company', 'NEW_BRAND': 'signal-new-brand', 'NEW_SKU': 'signal-new-sku', 'REFILE': 'signal-refile' };
                                        const signalLabels = { 'NEW_COMPANY': 'New Company', 'NEW_BRAND': 'New Brand', 'NEW_SKU': 'New SKU', 'REFILE': 'Refile' };
                                        const sigClass = signalClasses[p.signal] || 'signal-refile';
                                        const sigLabel = signalLabels[p.signal] || p.signal || '-';
                                        return `
                                        <tr>
                                            <td><strong>${escapeHtml(brand.brand_name)}</strong></td>
                                            <td>${escapeHtml(p.fanciful_name || '-')}</td>
                                            <td>${escapeHtml(getCategory(p.class_type_code))}</td>
                                            <td>${escapeHtml(p.approval_date)}</td>
                                            <td><span class="signal-gated"><span class="signal-badge ${sigClass}">${sigLabel}</span><span class="signal-lock" onclick="window.location.href='/#pricing'">PRO</span></span></td>
                                        </tr>
                                    `}).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="gate-overlay">
                            <div class="gate-content">
                                <div class="gate-title">Sign Up to View All Products</div>
                                <p>Get free access to ${escapeHtml(brand.brand_name)}'s complete product history</p>
                                <a href="/#signup" class="btn">Get Free Access</a>
                            </div>
                        </div>
                    </div>
                </div>

                ${companyBrands.length > 0 ? `
                <div class="related-links">
                    <div class="related-heading">More from ${escapeHtml(companyResult?.canonical_name || 'This Company')}</div>
                    ${companyBrands.map(b => `<a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>`).join('')}
                </div>` : ''}
                ${relatedBrands.length > 0 ? `
                <div class="related-links">
                    <div class="related-heading">More ${primaryCategory} Brands</div>
                    ${relatedBrands.map(b => `<a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>`).join('')}
                </div>` : ''}
                ${(() => {
                    const compareBrands = relatedBrands.filter(b => b.cnt >= 10).slice(0, 3);
                    return compareBrands.length > 0 ? `
                <div class="related-links">
                    <div class="related-heading">Compare ${escapeHtml(brand.brand_name)}</div>
                    ${compareBrands.map(b => `<a href="/compare/${slug}-vs-${makeSlug(b.brand_name)}/">${escapeHtml(brand.brand_name)} vs ${escapeHtml(b.brand_name)}</a>`).join('')}
                </div>` : '';
                })()}
            </div>
        </div>
    `;

    const noindex = brand.cnt < 5;
    if (noindex) console.log(`[noindex] brand/${slug} — ${brand.cnt} filings`);
    const extraHead = noindex ? '<meta name="robots" content="noindex, follow">' : '';

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/brand/${slug}`, extraHead), {
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
            `SELECT total_filings, week_filings, month_new_companies, top_companies, top_brands, latest_filing_date, updated_at
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

        // Top states for this category (for cross-linking section)
        const topStatesResult = await env.DB.prepare(`
            SELECT origin_code as origin, COUNT(*) as cnt
            FROM colas WHERE category = ? AND origin_code IS NOT NULL AND TRIM(origin_code) != ''
            GROUP BY origin_code
            ORDER BY cnt DESC LIMIT 6
        `).bind(category).all();
        const topStates = (topStatesResult?.results || []).filter(r => STATE_DATA[r.origin]);

        // Signal badge helper - renders real values in HTML (for Googlebot), gated via CSS for free users
        const getSignalBadge = (signal) => {
            const badges = {
                'NEW_COMPANY': { class: 'signal-new-company', label: 'New Company' },
                'NEW_BRAND': { class: 'signal-new-brand', label: 'New Brand' },
                'NEW_SKU': { class: 'signal-new-sku', label: 'New SKU' },
                'REFILE': { class: 'signal-refile', label: 'Refile' }
            };
            const badge = badges[signal];
            if (!badge) return '<span class="signal-badge">-</span>';
            // Real signal value in HTML, CSS blur gates it for free users
            return `<span class="signal-gated"><span class="signal-badge ${badge.class}">${badge.label}</span><span class="signal-lock" onclick="showUpgradeModal()">PRO</span></span>`;
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

        const latestHubDate = approvalDateToISO(filings[0]?.approval_date);
        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": `${category} Brands & Companies | TTB Label Database`,
            "description": description,
            "url": canonicalUrl,
            "numberOfItems": totalFilings,
            ...(latestHubDate && { "dateModified": latestHubDate }),
            "provider": {
                "@type": "Organization",
                "name": "BevAlc Intelligence",
                "url": BASE_URL
            }
        };

        const content = `
            <div class="hub-page" data-category="${category}">
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
                <div class="hub-data-updated">Data through ${now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</div>

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
                    <div class="related-heading">Browse All Categories</div>
                    <div class="hub-category-links">
                        ${Object.entries(categoryMap).map(([slug, name]) =>
                            slug === categorySlug
                                ? `<span class="current">${name}</span>`
                                : `<a href="/${slug}/">${name}</a>`
                        ).join('')}
                    </div>
                </nav>

                ${topStates.length > 0 ? `
                <section class="hub-section" style="margin-top: 32px;">
                    <h2>${category} by State</h2>
                    <div class="related-links">
                        ${topStates.map(s => {
                            const st = STATE_DATA[s.origin];
                            const catSlug2 = LOCATION_CATEGORY_SLUG_MAP[category];
                            return catSlug2 ? `<a href="/locations/${st.slug}/${catSlug2}/">${st.name} (${formatNumber(s.cnt)})</a>` : '';
                        }).filter(Boolean).join('')}
                        <a href="/locations/">All States →</a>
                    </div>
                </section>
                ` : ''}

                ${BEST_CATEGORY_REVERSE[category] ? `
                <section class="hub-section" style="margin-top: 16px;">
                    <h2>${category} Rankings</h2>
                    <div class="related-links">
                        <a href="/best/${BEST_CATEGORY_REVERSE[category]}-brands-${now.getFullYear()}/">Top ${category} Brands ${now.getFullYear()}</a>
                        <a href="/best/${BEST_CATEGORY_REVERSE[category]}-companies-${now.getFullYear()}/">Top ${category} Companies ${now.getFullYear()}</a>
                        <a href="/best/">All Rankings →</a>
                    </div>
                </section>
                ` : ''}
            </div>

            <!-- Upgrade Modal -->
            <div class="upgrade-modal-overlay" id="upgrade-modal">
                <div class="upgrade-modal">
                    <div class="gate-title">Unlock Pro Features</div>
                    <p>Get full access to signal data, CSV exports, watchlist alerts, and more. See which brands are NEW vs refiles at a glance.</p>
                    <a href="/#pricing" class="btn-primary">View Pro Plans</a>
                    <button class="btn-close" onclick="closeUpgradeModal()">Maybe later</button>
                </div>
            </div>

        `;

        const extraHead = '<link rel="stylesheet" href="/hub-pages.css"><script src="/hub-pages.js" defer><\/script>';

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
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
    // Get total filings for this year
    const totalResult = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas
        WHERE year = ? AND category = ?
    `).bind(year, category).first();
    const totalFilings = totalResult?.cnt || 0;

    // Get previous year for comparison
    const prevResult = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM colas
        WHERE year = ? AND category = ?
    `).bind(year - 1, category).first();
    const prevFilings = prevResult?.cnt || 1;
    const yoyChange = Math.round(((totalFilings - prevFilings) / prevFilings) * 100);

    // Get new brands count
    const newBrandsResult = await env.DB.prepare(`
        SELECT COUNT(DISTINCT brand_name) as cnt FROM colas
        WHERE year = ? AND signal = 'NEW_BRAND' AND category = ?
    `).bind(year, category).first();
    const newBrands = newBrandsResult?.cnt || 0;

    // Get monthly trend
    const monthlyResult = await env.DB.prepare(`
        SELECT month, COUNT(*) as cnt FROM colas
        WHERE year = ? AND category = ?
        GROUP BY month ORDER BY month
    `).bind(year, category).all();
    const monthly = monthlyResult.results || [];
    const maxMonthly = Math.max(...monthly.map(m => m.cnt), 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Get top filing companies
    const topCompaniesResult = await env.DB.prepare(`
        SELECT c.canonical_name, c.slug, COUNT(*) as cnt
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        JOIN companies c ON ca.company_id = c.id
        WHERE co.year = ? AND co.category = ?
        GROUP BY c.id
        ORDER BY cnt DESC
        LIMIT 10
    `).bind(year, category).all();
    const topCompanies = topCompaniesResult.results || [];

    // Get top new brands
    const topBrandsResult = await env.DB.prepare(`
        SELECT brand_name, COUNT(*) as cnt
        FROM colas
        WHERE year = ? AND signal IN ('NEW_BRAND', 'NEW_SKU') AND category = ?
        GROUP BY brand_name
        ORDER BY cnt DESC
        LIMIT 10
    `).bind(year, category).all();
    const topBrands = topBrandsResult.results || [];

    // Available years + latest filing date (parallel)
    const [yearsResult, latestDateResult] = await Promise.all([
        env.DB.prepare(`
            SELECT DISTINCT year FROM colas WHERE year >= 2020 ORDER BY year DESC
        `).all(),
        env.DB.prepare(`
            SELECT MAX(year * 10000 + month * 100 + day) as latest_date
            FROM colas WHERE year = ? AND category = ?
        `).bind(year, category).first()
    ]);
    const years = (yearsResult.results || []).map(r => r.year);
    const latestCatDate = numericDateToISO(latestDateResult?.latest_date);

    // Generate narrative sentences from existing data
    const categoryNarrative = (() => {
        const sentences = [];
        // YoY direction
        if (yoyChange > 10) {
            sentences.push(`The ${category.toLowerCase()} category saw a <strong>${yoyChange}%</strong> increase in filing activity in ${year} compared to ${year - 1}, signaling growing market momentum.`);
        } else if (yoyChange < -10) {
            sentences.push(`Filing activity in the ${category.toLowerCase()} category declined <strong>${Math.abs(yoyChange)}%</strong> in ${year} versus ${year - 1}.`);
        } else {
            sentences.push(`The ${category.toLowerCase()} category filed <strong>${formatNumber(totalFilings)}</strong> products in ${year}, roughly in line with ${year - 1} levels.`);
        }
        // Top filer
        if (topCompanies.length > 0) {
            const top = topCompanies[0];
            const topPct = totalFilings > 0 ? Math.round((top.cnt / totalFilings) * 100) : 0;
            sentences.push(`<strong>${escapeHtml(top.canonical_name)}</strong> led the category with <strong>${formatNumber(top.cnt)}</strong> filings (${topPct}% of total).`);
        }
        // Peak month
        if (monthly.length > 0) {
            const peakMonth = monthly.reduce((max, m) => m.cnt > max.cnt ? m : max, monthly[0]);
            sentences.push(`Activity peaked in <strong>${monthNames[peakMonth.month - 1]}</strong> with <strong>${formatNumber(peakMonth.cnt)}</strong> filings.`);
        }
        return sentences.join(' ');
    })();

    const title = `${category} Filings ${year}`;
    const description = `${formatNumber(totalFilings)} ${category} TTB COLA filings in ${year}. ${yoyChange >= 0 ? '+' : ''}${yoyChange}% vs ${year-1}. View top filers, new brands, and monthly trends.`;

    const jsonLd = [
        {
            "@context": "https://schema.org",
            "@type": "Dataset",
            "name": `${category} Industry TTB Filings - ${year}`,
            "description": description,
            "url": `${BASE_URL}/category/${categorySlug}/${year}`,
            "datePublished": `${year}-01-01`,
            ...(latestCatDate && { "dateModified": latestCatDate }),
            "provider": {
                "@type": "Organization",
                "name": "BevAlc Intelligence",
                "url": BASE_URL
            }
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                { "@type": "ListItem", "position": 2, "name": "Database", "item": `${BASE_URL}/database.html` },
                { "@type": "ListItem", "position": 3, "name": category, "item": `${BASE_URL}/${categorySlug}/` },
                { "@type": "ListItem", "position": 4, "name": String(year) }
            ]
        }
    ];

    const content = `
        <div class="breadcrumb">
            <a href="/">Home</a> / <a href="/database.html">Database</a> / <a href="/${categorySlug}/">${category}</a> / ${year}
        </div>
        <header class="seo-header">
            <h1>${category} Filings in ${year}</h1>
            <p class="meta">${formatNumber(totalFilings)} Total Filings · ${formatNumber(newBrands)} New Brands · ${yoyChange >= 0 ? '+' : ''}${yoyChange}% vs ${year - 1}</p>
        </header>

        ${categoryNarrative ? `<section class="seo-card" style="margin-bottom: 32px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
            <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                ${categoryNarrative}
            </p>
        </section>` : ''}

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
            <div class="related-heading">Browse by Year</div>
            ${years.map(y => y === year ? `<strong>${y}</strong>` : `<a href="/category/${categorySlug}/${y}">${y}</a>`).join(' ')}
            <div class="related-heading" style="margin-top: 24px;">Other Categories</div>
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

// ============================================================
// Glossary Handlers
// ============================================================

const GLOSSARY_CATEGORY_ORDER = [
    'TTB Basics', 'Product Information', 'Labeling Terms', 'Company Information',
    'Wine-Specific', 'Application Types', 'Status Definitions', 'Intelligence Signals',
    'Federal Permits', 'Production Terms', 'Distribution Terms', 'Business Terms'
];

// Glossary Index Page — /glossary/
async function handleGlossaryIndex(env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        const result = await env.DB.prepare(`
            SELECT term_slug, term_name, category, definition
            FROM glossary_terms
            ORDER BY category, term_name
        `).all();
        const terms = result.results || [];

        // Group by category
        const grouped = {};
        for (const t of terms) {
            if (!grouped[t.category]) grouped[t.category] = [];
            grouped[t.category].push(t);
        }

        // Build category sections
        const categorySections = GLOSSARY_CATEGORY_ORDER
            .filter(cat => grouped[cat] && grouped[cat].length > 0)
            .map(cat => {
                const catTerms = grouped[cat];
                const termCards = catTerms.map(t => `
                    <a href="/glossary/${t.term_slug}/" class="glossary-index-card">
                        <strong>${escapeHtml(t.term_name)}</strong>
                        <span>${escapeHtml(t.definition.substring(0, 140))}${t.definition.length > 140 ? '...' : ''}</span>
                    </a>
                `).join('');
                return `
                    <section class="seo-card glossary-index-section">
                        <h2>${escapeHtml(cat)}</h2>
                        <div class="glossary-index-grid">${termCards}</div>
                    </section>
                `;
            }).join('');

        const title = 'Beverage Alcohol Glossary';
        const description = `${terms.length} beverage alcohol terms defined — TTB regulatory terminology, production methods, distribution law, and industry business terms. Each with plain-English explanations and practical context.`;
        const canonicalUrl = `${BASE_URL}/glossary/`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "DefinedTermSet",
                "name": "BevAlc Intelligence Glossary",
                "description": description,
                "url": canonicalUrl,
                "hasDefinedTerm": terms.map(t => ({
                    "@type": "DefinedTerm",
                    "name": t.term_name,
                    "url": `${BASE_URL}/glossary/${t.term_slug}/`
                }))
            },
            {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "numberOfItems": terms.length,
                "provider": {
                    "@type": "Organization",
                    "name": "BevAlc Intelligence",
                    "url": BASE_URL
                }
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Glossary" }
                ]
            }
        ];

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / Glossary
            </div>
            <header class="seo-header">
                <h1>Beverage Alcohol Glossary</h1>
                <p class="meta">${terms.length} Terms · TTB Regulation · Production · Distribution · Business</p>
            </header>

            <section class="seo-card" style="margin-bottom: 32px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    A comprehensive reference covering every term you'll encounter in the beverage alcohol industry — from
                    <a href="/glossary/cola/">TTB label approvals</a> and <a href="/glossary/federal-basic-permit/">federal permits</a>
                    to <a href="/glossary/three-tier-system/">distribution law</a> and <a href="/glossary/distillation/">production methods</a>.
                    Each entry includes a plain-English explanation, technical regulatory detail, and practical context for
                    distillers, importers, compliance professionals, and investors.
                </p>
            </section>

            <nav class="glossary-toc-nav">
                ${GLOSSARY_CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat =>
                    `<a href="#${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${cat}</a>`
                ).join('')}
            </nav>

            ${GLOSSARY_CATEGORY_ORDER
                .filter(cat => grouped[cat] && grouped[cat].length > 0)
                .map(cat => {
                    const catTerms = grouped[cat];
                    const anchor = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const termCards = catTerms.map(t => `
                        <a href="/glossary/${t.term_slug}/" class="glossary-index-card">
                            <strong>${escapeHtml(t.term_name)}</strong>
                            <span>${escapeHtml(t.definition.substring(0, 140))}${t.definition.length > 140 ? '...' : ''}</span>
                        </a>
                    `).join('');
                    return `
                        <section class="seo-card glossary-index-section" id="${anchor}">
                            <h2>${escapeHtml(cat)} <span class="glossary-cat-count">${catTerms.length}</span></h2>
                            <div class="glossary-index-grid">${termCards}</div>
                        </section>
                    `;
                }).join('')}

            <section class="seo-card" style="text-align: center; padding: 32px;">
                <p style="color: #64748b; margin-bottom: 16px;">Use this glossary alongside our database to understand what you're seeing in TTB filings.</p>
                <a href="/database.html" class="btn-primary" style="margin-right: 12px;">Search the Database</a>
                <a href="/whiskey/" class="btn-secondary">Browse Categories</a>
            </section>
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error('Glossary index error:', error.message);
        return new Response('Error loading glossary', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// Glossary Term Page — /glossary/[slug]/
async function handleGlossaryTerm(path, env) {
    const slug = path.replace('/glossary/', '').replace(/\/$/, '');
    if (!slug) return await handleGlossaryIndex(env);

    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        const term = await env.DB.prepare(`
            SELECT * FROM glossary_terms WHERE term_slug = ?
        `).bind(slug).first();

        if (!term) {
            return new Response('Term not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
        }

        // Parse JSON fields
        let relatedSlugs = [];
        try { relatedSlugs = JSON.parse(term.related_terms || '[]'); } catch (e) {}
        let faqs = [];
        try { faqs = JSON.parse(term.faqs || '[]'); } catch (e) {}

        // Fetch related terms
        let relatedTerms = [];
        if (relatedSlugs.length > 0) {
            const placeholders = relatedSlugs.map(() => '?').join(',');
            const relResult = await env.DB.prepare(`
                SELECT term_slug, term_name, definition FROM glossary_terms WHERE term_slug IN (${placeholders})
            `).bind(...relatedSlugs).all();
            relatedTerms = relResult.results || [];
        }

        const title = term.term_name;
        const description = term.definition.substring(0, 155).replace(/\.?\s*$/, '.');
        const canonicalUrl = `${BASE_URL}/glossary/${slug}/`;
        const dateModified = term.updated_at ? term.updated_at.split(' ')[0] : new Date().toISOString().split('T')[0];

        // JSON-LD: DefinedTerm + BreadcrumbList + FAQPage
        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "DefinedTerm",
                "name": term.term_name,
                "description": term.definition,
                "inDefinedTermSet": {
                    "@type": "DefinedTermSet",
                    "name": "BevAlc Intelligence Glossary",
                    "url": `${BASE_URL}/glossary/`
                },
                "url": canonicalUrl
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Glossary", "item": `${BASE_URL}/glossary/` },
                    { "@type": "ListItem", "position": 3, "name": term.term_name }
                ]
            }
        ];

        if (faqs.length > 0) {
            jsonLd.push({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": faqs.map(f => ({
                    "@type": "Question",
                    "name": f.q,
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": f.a
                    }
                }))
            });
        }

        // Build related terms HTML
        const relatedHtml = relatedTerms.length > 0 ? `
            <section class="seo-card">
                <h2>Related Terms</h2>
                <div class="glossary-related-grid">
                    ${relatedTerms.map(r => `
                        <a href="/glossary/${r.term_slug}/" class="glossary-related-card">
                            <strong>${escapeHtml(r.term_name)}</strong>
                            <span>${escapeHtml(r.definition.substring(0, 100))}${r.definition.length > 100 ? '...' : ''}</span>
                        </a>
                    `).join('')}
                </div>
            </section>
        ` : '';

        // Build FAQ HTML
        const faqHtml = faqs.length > 0 ? `
            <section class="seo-card">
                <h2>Frequently Asked Questions</h2>
                ${faqs.map(f => `
                    <div class="glossary-faq">
                        <h3>${escapeHtml(f.q)}</h3>
                        <p>${escapeHtml(f.a)}</p>
                    </div>
                `).join('')}
            </section>
        ` : '';

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/glossary/">Glossary</a> / ${escapeHtml(term.term_name)}
            </div>
            <header class="seo-header">
                <h1>${escapeHtml(term.term_name)}</h1>
                <p class="meta">${escapeHtml(term.category)} · Updated ${dateModified}</p>
            </header>

            <section class="glossary-lead">
                <p>${escapeHtml(term.definition)}</p>
            </section>

            <section class="seo-card">
                <h2>In Plain English</h2>
                <p>${escapeHtml(term.plain_english)}</p>
            </section>

            <section class="seo-card">
                <h2>Technical Detail</h2>
                <p>${escapeHtml(term.technical_detail)}</p>
            </section>

            <section class="seo-card">
                <h2>Why It Matters</h2>
                <p>${escapeHtml(term.why_it_matters)}</p>
            </section>

            ${relatedHtml}
            ${faqHtml}

            <div class="glossary-back-nav">
                <a href="/glossary/">← Back to Full Glossary</a>
            </div>
        `;

        const extraHead = `<meta property="article:modified_time" content="${dateModified}">`;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`Glossary term error for ${slug}:`, error.message);
        return new Response('Error loading glossary term', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// ==========================================
// LOCATION PAGE HANDLERS
// ==========================================

// Keyed by UPPERCASE origin_code values as stored in the colas table
const STATE_DATA = {
    'ALABAMA': { name: 'Alabama', slug: 'alabama', abbr: 'AL', control: true, model: 'Control state (ABC stores)' },
    'ALASKA': { name: 'Alaska', slug: 'alaska', abbr: 'AK', control: false, model: 'License state' },
    'ARIZONA': { name: 'Arizona', slug: 'arizona', abbr: 'AZ', control: false, model: 'License state' },
    'ARKANSAS': { name: 'Arkansas', slug: 'arkansas', abbr: 'AR', control: false, model: 'License state' },
    'CALIFORNIA': { name: 'California', slug: 'california', abbr: 'CA', control: false, model: 'License state' },
    'COLORADO': { name: 'Colorado', slug: 'colorado', abbr: 'CO', control: false, model: 'License state' },
    'CONNECTICUT': { name: 'Connecticut', slug: 'connecticut', abbr: 'CT', control: false, model: 'License state' },
    'DELAWARE': { name: 'Delaware', slug: 'delaware', abbr: 'DE', control: false, model: 'License state' },
    'FLORIDA': { name: 'Florida', slug: 'florida', abbr: 'FL', control: false, model: 'License state' },
    'GEORGIA': { name: 'Georgia', slug: 'georgia', abbr: 'GA', control: false, model: 'License state' },
    'HAWAII': { name: 'Hawaii', slug: 'hawaii', abbr: 'HI', control: false, model: 'License state' },
    'IDAHO': { name: 'Idaho', slug: 'idaho', abbr: 'ID', control: true, model: 'Control state (state liquor stores)' },
    'ILLINOIS': { name: 'Illinois', slug: 'illinois', abbr: 'IL', control: false, model: 'License state' },
    'INDIANA': { name: 'Indiana', slug: 'indiana', abbr: 'IN', control: false, model: 'License state' },
    'IOWA': { name: 'Iowa', slug: 'iowa', abbr: 'IA', control: true, model: 'Control state (state-run spirits)' },
    'KANSAS': { name: 'Kansas', slug: 'kansas', abbr: 'KS', control: false, model: 'License state' },
    'KENTUCKY': { name: 'Kentucky', slug: 'kentucky', abbr: 'KY', control: false, model: 'License state' },
    'LOUISIANA': { name: 'Louisiana', slug: 'louisiana', abbr: 'LA', control: false, model: 'License state' },
    'MAINE': { name: 'Maine', slug: 'maine', abbr: 'ME', control: true, model: 'Control state (state-run spirits)' },
    'MARYLAND': { name: 'Maryland', slug: 'maryland', abbr: 'MD', control: false, model: 'License state' },
    'MASSACHUSETTS': { name: 'Massachusetts', slug: 'massachusetts', abbr: 'MA', control: false, model: 'License state' },
    'MICHIGAN': { name: 'Michigan', slug: 'michigan', abbr: 'MI', control: true, model: 'Control state (MLCC)' },
    'MINNESOTA': { name: 'Minnesota', slug: 'minnesota', abbr: 'MN', control: false, model: 'License state' },
    'MISSISSIPPI': { name: 'Mississippi', slug: 'mississippi', abbr: 'MS', control: true, model: 'Control state (ABC)' },
    'MISSOURI': { name: 'Missouri', slug: 'missouri', abbr: 'MO', control: false, model: 'License state' },
    'MONTANA': { name: 'Montana', slug: 'montana', abbr: 'MT', control: true, model: 'Control state (state liquor stores)' },
    'NEBRASKA': { name: 'Nebraska', slug: 'nebraska', abbr: 'NE', control: false, model: 'License state' },
    'NEVADA': { name: 'Nevada', slug: 'nevada', abbr: 'NV', control: false, model: 'License state' },
    'NEW HAMPSHIRE': { name: 'New Hampshire', slug: 'new-hampshire', abbr: 'NH', control: true, model: 'Control state (state liquor stores)' },
    'NEW JERSEY': { name: 'New Jersey', slug: 'new-jersey', abbr: 'NJ', control: false, model: 'License state' },
    'NEW MEXICO': { name: 'New Mexico', slug: 'new-mexico', abbr: 'NM', control: false, model: 'License state' },
    'NEW YORK': { name: 'New York', slug: 'new-york', abbr: 'NY', control: false, model: 'License state' },
    'NORTH CAROLINA': { name: 'North Carolina', slug: 'north-carolina', abbr: 'NC', control: true, model: 'Control state (ABC stores)' },
    'NORTH DAKOTA': { name: 'North Dakota', slug: 'north-dakota', abbr: 'ND', control: false, model: 'License state' },
    'OHIO': { name: 'Ohio', slug: 'ohio', abbr: 'OH', control: true, model: 'Control state (state-run spirits)' },
    'OKLAHOMA': { name: 'Oklahoma', slug: 'oklahoma', abbr: 'OK', control: false, model: 'License state' },
    'OREGON': { name: 'Oregon', slug: 'oregon', abbr: 'OR', control: true, model: 'Control state (OLCC)' },
    'PENNSYLVANIA': { name: 'Pennsylvania', slug: 'pennsylvania', abbr: 'PA', control: true, model: 'Control state (PLCB)' },
    'RHODE ISLAND': { name: 'Rhode Island', slug: 'rhode-island', abbr: 'RI', control: false, model: 'License state' },
    'SOUTH CAROLINA': { name: 'South Carolina', slug: 'south-carolina', abbr: 'SC', control: false, model: 'License state' },
    'SOUTH DAKOTA': { name: 'South Dakota', slug: 'south-dakota', abbr: 'SD', control: false, model: 'License state' },
    'TENNESSEE': { name: 'Tennessee', slug: 'tennessee', abbr: 'TN', control: false, model: 'License state' },
    'TEXAS': { name: 'Texas', slug: 'texas', abbr: 'TX', control: false, model: 'License state' },
    'UTAH': { name: 'Utah', slug: 'utah', abbr: 'UT', control: true, model: 'Control state (DABC)' },
    'VERMONT': { name: 'Vermont', slug: 'vermont', abbr: 'VT', control: true, model: 'Control state (state liquor stores)' },
    'VIRGINIA': { name: 'Virginia', slug: 'virginia', abbr: 'VA', control: true, model: 'Control state (ABC stores)' },
    'WASHINGTON': { name: 'Washington', slug: 'washington', abbr: 'WA', control: false, model: 'License state (privatized 2012)' },
    'WEST VIRGINIA': { name: 'West Virginia', slug: 'west-virginia', abbr: 'WV', control: false, model: 'License state' },
    'WISCONSIN': { name: 'Wisconsin', slug: 'wisconsin', abbr: 'WI', control: false, model: 'License state' },
    'WYOMING': { name: 'Wyoming', slug: 'wyoming', abbr: 'WY', control: true, model: 'Control state (state-run spirits)' },
    'DISTRICT OF COLUMBIA': { name: 'District of Columbia', slug: 'district-of-columbia', abbr: 'DC', control: false, model: 'License jurisdiction' },
};

// Reverse lookup: slug → origin_code (uppercase state name)
const STATE_SLUG_MAP = {};
for (const [originCode, data] of Object.entries(STATE_DATA)) {
    STATE_SLUG_MAP[data.slug] = originCode;
}

// Category slug mapping for location/category pages
const LOCATION_CATEGORY_MAP = {
    'whiskey': 'Whiskey',
    'tequila': 'Tequila',
    'vodka': 'Vodka',
    'gin': 'Gin',
    'rum': 'Rum',
    'brandy': 'Brandy',
    'wine': 'Wine',
    'beer': 'Beer',
    'liqueur': 'Liqueur',
    'cocktails': 'Cocktails',
    'other': 'Other',
};
const LOCATION_CATEGORY_SLUG_MAP = {};
for (const [slug, name] of Object.entries(LOCATION_CATEGORY_MAP)) {
    LOCATION_CATEGORY_SLUG_MAP[name] = slug;
}

// Location page router — determines state vs state+category
async function handleLocationPage(path, env) {
    const parts = path.replace('/locations/', '').replace(/\/$/, '').split('/');
    const stateSlug = parts[0];
    const categorySlug = parts[1] || null;

    const originCode = STATE_SLUG_MAP[stateSlug];
    if (!originCode) {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
    }

    if (categorySlug) {
        const categoryName = LOCATION_CATEGORY_MAP[categorySlug];
        if (!categoryName) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }
        return await handleStateCategoryPage(originCode, categorySlug, categoryName, env);
    }

    return await handleStatePage(originCode, env);
}

// Handler 1: /locations/ — Index of all states
async function handleLocationsIndex(env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Get state counts using origin_code (uppercase state names like "CALIFORNIA")
        const stateStats = await env.DB.prepare(`
            SELECT origin_code as origin, COUNT(*) as total, COUNT(DISTINCT company_name) as companies
            FROM colas
            WHERE origin_code IS NOT NULL AND origin_code != ''
            GROUP BY origin
            ORDER BY total DESC
        `).all();

        // Get top category per state
        const topCategories = await env.DB.prepare(`
            SELECT origin_code as origin, category, COUNT(*) as cnt
            FROM colas
            WHERE origin_code IS NOT NULL AND origin_code != '' AND category IS NOT NULL
            GROUP BY origin, category
            ORDER BY origin, cnt DESC
        `).all();

        // Build top category map (first row per state wins due to ORDER BY)
        const topCatMap = {};
        for (const row of topCategories.results) {
            if (!topCatMap[row.origin]) {
                topCatMap[row.origin] = row.category;
            }
        }

        // Build total stats
        let totalFilings = 0;
        let totalCompanies = 0;
        for (const row of stateStats.results) {
            if (STATE_DATA[row.origin]) {
                totalFilings += row.total;
                totalCompanies += row.companies;
            }
        }

        // Build state cards HTML
        const stateCardsHtml = stateStats.results
            .filter(row => STATE_DATA[row.origin])
            .map(row => {
                const state = STATE_DATA[row.origin];
                const topCat = topCatMap[row.origin] || '';
                const catSlug = LOCATION_CATEGORY_SLUG_MAP[topCat];
                const topCatLink = catSlug ? `<a href="/locations/${state.slug}/${catSlug}/">${escapeHtml(topCat)}</a>` : escapeHtml(topCat);
                return `
                    <a href="/locations/${state.slug}/" class="state-card">
                        <div class="state-card-header">
                            <span class="state-card-name">${escapeHtml(state.name)}</span>
                            <span class="state-card-code">${state.abbr}</span>
                        </div>
                        <div class="state-card-stats">
                            <div class="state-card-stat">
                                <span class="state-card-value">${formatNumber(row.total)}</span>
                                <span class="state-card-label">filings</span>
                            </div>
                            <div class="state-card-stat">
                                <span class="state-card-value">${formatNumber(row.companies)}</span>
                                <span class="state-card-label">companies</span>
                            </div>
                        </div>
                        <div class="state-card-meta">
                            <span class="state-card-type">${state.control ? 'Control' : 'License'}</span>
                            ${topCat ? `<span class="state-card-top-cat">Top: ${escapeHtml(topCat)}</span>` : ''}
                        </div>
                    </a>
                `;
            }).join('');

        const canonicalUrl = `${BASE_URL}/locations/`;
        const title = 'Alcohol Industry by State — TTB Filings & Company Data';
        const description = `Explore beverage alcohol industry data across all 50 US states. ${formatNumber(totalFilings)} TTB label approvals from ${formatNumber(totalCompanies)} companies, broken down by state, category, and regulatory environment.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": title,
                "description": description,
                "url": canonicalUrl
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Locations" }
                ]
            }
        ];

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / Locations
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>Alcohol Industry by State</h1>
                    <div class="meta">
                        <span><strong>${formatNumber(totalFilings)}</strong> total TTB filings</span>
                        <span><strong>${formatNumber(totalCompanies)}</strong> companies across <strong>${stateStats.results.filter(r => STATE_DATA[r.origin]).length}</strong> states</span>
                    </div>
                </div>
            </header>

            <section class="seo-card" style="margin-bottom: 32px;">
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    Every beverage alcohol product sold in the United States requires a Certificate of Label Approval (COLA) from the Alcohol and Tobacco Tax and Trade Bureau (TTB). This page provides a geographic breakdown of all TTB label approvals in our database, showing where beverage alcohol companies are based and how activity varies across states. Whether you're a service provider looking for prospects in your region or analyzing market concentration, this data helps you understand the landscape state by state.
                </p>
            </section>

            <div class="state-grid">
                ${stateCardsHtml}
            </div>

            <section class="seo-card" style="margin-top: 32px;">
                <h2>Control vs. License States</h2>
                <p style="line-height: 1.75; color: #475569; margin: 0;">
                    US states follow one of two regulatory models for alcohol distribution. <strong>Control states</strong> (also called monopoly states) operate government-run retail stores for spirits, giving the state direct control over wholesale and sometimes retail sales. <strong>License states</strong> allow private businesses to sell spirits through a licensing system. This distinction significantly affects how brands enter and compete in each market. Our data tracks TTB filings regardless of state model, giving you visibility into new brand activity in both regulatory environments.
                </p>
            </section>
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error('Locations index error:', error.message);
        return new Response('Error loading locations', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// Handler 2: /locations/[state-slug]/ — Individual state page
async function handleStatePage(originCode, env) {
    const state = STATE_DATA[originCode];
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Run all queries in parallel — use origin_code for colas, state (2-letter abbr) for permits
        const [totalRes, companiesRes, categoryRes, topCompaniesRes, topBrandsRes, permitRes, yearTrendRes] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) as cnt FROM colas WHERE origin_code = ?').bind(originCode).first(),
            env.DB.prepare('SELECT COUNT(DISTINCT company_name) as cnt FROM colas WHERE origin_code = ?').bind(originCode).first(),
            env.DB.prepare('SELECT category, COUNT(*) as cnt FROM colas WHERE origin_code = ? AND category IS NOT NULL GROUP BY category ORDER BY cnt DESC').bind(originCode).all(),
            env.DB.prepare(`
                SELECT c.canonical_name, c.slug, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.origin_code = ?
                GROUP BY c.id
                ORDER BY cnt DESC LIMIT 10
            `).bind(originCode).all(),
            env.DB.prepare('SELECT brand_name, COUNT(*) as cnt FROM colas WHERE origin_code = ? GROUP BY brand_name ORDER BY cnt DESC LIMIT 10').bind(originCode).all(),
            env.DB.prepare('SELECT COUNT(*) as cnt FROM permits WHERE UPPER(TRIM(state)) = ?').bind(state.abbr).first(),
            env.DB.prepare('SELECT year, COUNT(*) as cnt FROM colas WHERE origin_code = ? AND year IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 5').bind(originCode).all(),
        ]);

        const totalFilings = totalRes?.cnt || 0;
        const totalCompanies = companiesRes?.cnt || 0;
        const permitCount = permitRes?.cnt || 0;
        const categories = categoryRes.results || [];
        const topCompanies = topCompaniesRes.results || [];
        const topBrands = topBrandsRes.results || [];
        const yearTrend = yearTrendRes.results || [];

        if (totalFilings === 0) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Category breakdown with percentages
        const maxCat = categories.length > 0 ? categories[0].cnt : 1;
        const categoryHtml = categories.map(cat => {
            const pct = ((cat.cnt / totalFilings) * 100).toFixed(1);
            const barWidth = ((cat.cnt / maxCat) * 100).toFixed(0);
            const catSlug = LOCATION_CATEGORY_SLUG_MAP[cat.category];
            const nameHtml = catSlug && cat.cnt >= 10
                ? `<a href="/locations/${state.slug}/${catSlug}/" style="color: inherit; text-decoration: none;">${escapeHtml(cat.category)}</a>`
                : escapeHtml(cat.category);
            return `<div class="bar-row">
                <div class="bar-label">${nameHtml}</div>
                <div class="bar-container"><div class="bar-fill" style="width: ${barWidth}%"></div></div>
                <div class="bar-value">${formatNumber(cat.cnt)} <span style="font-size: 0.7rem; color: #94a3b8;">(${pct}%)</span></div>
            </div>`;
        }).join('');

        // Top companies table
        const companiesTableHtml = topCompanies.length > 0 ? `
            <section class="seo-card">
                <h2>Top Companies in ${escapeHtml(state.name)}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Company</th><th>Filings</th></tr></thead>
                        <tbody>
                            ${topCompanies.map((co, i) => `
                                <tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/company/${co.slug}/">${escapeHtml(co.canonical_name)}</a></td>
                                    <td>${formatNumber(co.cnt)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Top brands table
        const brandsTableHtml = topBrands.length > 0 ? `
            <section class="seo-card">
                <h2>Top Brands in ${escapeHtml(state.name)}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Brand</th><th>Filings</th></tr></thead>
                        <tbody>
                            ${topBrands.map((br, i) => {
                                const brandSlug = br.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                                return `
                                <tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/brand/${brandSlug}/">${escapeHtml(br.brand_name)}</a></td>
                                    <td>${formatNumber(br.cnt)}</td>
                                </tr>
                            `;}).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Year trend chart
        const yearTrendHtml = yearTrend.length > 0 ? (() => {
            const maxYear = Math.max(...yearTrend.map(y => y.cnt));
            return `
                <section class="seo-card">
                    <h2>Filing Trend (Last 5 Years)</h2>
                    <div class="bar-chart">
                        ${yearTrend.map(y => `
                            <div class="bar-row">
                                <div class="bar-label">${y.year}</div>
                                <div class="bar-container"><div class="bar-fill" style="width: ${((y.cnt / maxYear) * 100).toFixed(0)}%"></div></div>
                                <div class="bar-value">${formatNumber(y.cnt)}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            `;
        })() : '';

        // Category links for state+category subpages (only categories with 10+ filings)
        const categoryLinksHtml = categories.filter(c => c.cnt >= 10 && LOCATION_CATEGORY_SLUG_MAP[c.category]).map(c => {
            const catSlug = LOCATION_CATEGORY_SLUG_MAP[c.category];
            return `<a href="/locations/${state.slug}/${catSlug}/">${escapeHtml(c.category)} (${formatNumber(c.cnt)})</a>`;
        }).join('');

        const canonicalUrl = `${BASE_URL}/locations/${state.slug}/`;
        const title = `${state.name} Alcohol Industry Overview — Companies, Brands & TTB Data`;
        const description = `${state.name} has ${formatNumber(totalCompanies)} beverage alcohol companies with ${formatNumber(totalFilings)} TTB label approvals. ${state.model}. Browse top companies, brands, and category breakdown.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "WebPage",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "about": {
                    "@type": "Place",
                    "name": state.name,
                    "address": { "@type": "PostalAddress", "addressRegion": state.abbr, "addressCountry": "US" }
                }
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Locations", "item": `${BASE_URL}/locations/` },
                    { "@type": "ListItem", "position": 3, "name": state.name }
                ]
            }
        ];

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/locations/">Locations</a> / ${escapeHtml(state.name)}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>${escapeHtml(state.name)} Alcohol Industry Overview</h1>
                    <div class="meta">
                        <span><strong>${formatNumber(totalFilings)}</strong> TTB filings</span>
                        <span><strong>${formatNumber(totalCompanies)}</strong> companies</span>
                        ${permitCount > 0 ? `<span><strong>${formatNumber(permitCount)}</strong> federal permits</span>` : ''}
                        <span class="category-badge">${state.control ? 'Control State' : 'License State'}</span>
                    </div>
                </div>
            </header>

            <div class="seo-grid">
                <div class="seo-card">
                    <h2>Total Companies</h2>
                    <div class="stat-value">${formatNumber(totalCompanies)}</div>
                    <div class="stat-label">Companies with TTB label approvals in ${escapeHtml(state.name)}</div>
                </div>
                <div class="seo-card">
                    <h2>Total Filings</h2>
                    <div class="stat-value">${formatNumber(totalFilings)}</div>
                    <div class="stat-label">COLA label approvals on record</div>
                </div>
                <div class="seo-card">
                    <h2>Federal Permits</h2>
                    <div class="stat-value">${formatNumber(permitCount)}</div>
                    <div class="stat-label">TTB permits registered in ${escapeHtml(state.name)}</div>
                </div>
                <div class="seo-card">
                    <h2>Regulatory Model</h2>
                    <div class="stat-value" style="font-size: 1.5rem;">${state.control ? 'Control' : 'License'}</div>
                    <div class="stat-label">${escapeHtml(state.model)}</div>
                </div>
            </div>

            <section class="seo-card">
                <h2>About ${escapeHtml(state.name)}'s Beverage Alcohol Industry</h2>
                <p style="line-height: 1.75; color: #475569; margin: 0 0 16px 0;">
                    ${escapeHtml(state.name)} is a <strong>${state.control ? 'control' : 'license'}</strong> state with <strong>${formatNumber(totalCompanies)}</strong> companies that have submitted TTB label approvals. The state accounts for <strong>${formatNumber(totalFilings)}</strong> Certificate of Label Approval (COLA) filings across ${categories.length} product categories.
                </p>
                <p style="line-height: 1.75; color: #475569; margin: 0 0 16px 0;">
                    ${state.control
                        ? `As a control state, ${escapeHtml(state.name)} operates under a ${escapeHtml(state.model).toLowerCase()} framework where the government plays a direct role in the distribution and retail of distilled spirits. This means brands entering the ${escapeHtml(state.name)} market must work within the state's controlled distribution system, which affects pricing, availability, and market entry strategy.`
                        : `As a license state, ${escapeHtml(state.name)} allows private businesses to distribute and sell alcohol through a licensing system. This generally provides more flexibility for brands entering the market, though licensees must still comply with state-specific regulations on distribution, pricing, and retail operations.`
                    }
                </p>
                <p style="line-height: 1.75; color: #475569; margin: 0;">
                    ${categories.length > 0 ? `The most active category in ${escapeHtml(state.name)} is <strong>${escapeHtml(categories[0].category)}</strong>, representing ${((categories[0].cnt / totalFilings) * 100).toFixed(1)}% of all filings.` : ''}
                    ${permitCount > 0 ? ` There are <strong>${formatNumber(permitCount)}</strong> active federal TTB permits registered to businesses in the state, covering breweries, distilleries, wineries, and other production facilities.` : ''}
                    For service providers — including label printers, compliance consultants, co-packers, and branding agencies — this data reveals where new brand activity is concentrated and which segments are growing.
                </p>
            </section>

            <section class="seo-card">
                <h2>Category Breakdown</h2>
                <div class="bar-chart">
                    ${categoryHtml}
                </div>
            </section>

            ${companiesTableHtml}
            ${brandsTableHtml}
            ${yearTrendHtml}

            ${categoryLinksHtml ? `
                <div class="related-links">
                    <div class="related-heading">Explore ${escapeHtml(state.name)} by Category</div>
                    ${categoryLinksHtml}
                </div>
            ` : ''}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`State page error for ${originCode}:`, error.message);
        return new Response('Error loading state page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// Handler 3: /locations/[state-slug]/[category]/ — State + category page
async function handleStateCategoryPage(originCode, categorySlug, categoryName, env) {
    const state = STATE_DATA[originCode];
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Run all queries in parallel — use origin_code for colas
        const [totalRes, topCompaniesRes, topBrandsRes, recentRes, yearTrendRes, otherCatsRes] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) as cnt FROM colas WHERE origin_code = ? AND category = ?').bind(originCode, categoryName).first(),
            env.DB.prepare(`
                SELECT c.canonical_name, c.slug, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.origin_code = ? AND co.category = ?
                GROUP BY c.id
                ORDER BY cnt DESC LIMIT 10
            `).bind(originCode, categoryName).all(),
            env.DB.prepare('SELECT brand_name, COUNT(*) as cnt FROM colas WHERE origin_code = ? AND category = ? GROUP BY brand_name ORDER BY cnt DESC LIMIT 10').bind(originCode, categoryName).all(),
            env.DB.prepare('SELECT ttb_id, brand_name, fanciful_name, company_name, approval_date, signal FROM colas WHERE origin_code = ? AND category = ? ORDER BY approval_date DESC LIMIT 10').bind(originCode, categoryName).all(),
            env.DB.prepare('SELECT year, COUNT(*) as cnt FROM colas WHERE origin_code = ? AND category = ? AND year IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 5').bind(originCode, categoryName).all(),
            env.DB.prepare('SELECT category, COUNT(*) as cnt FROM colas WHERE origin_code = ? AND category IS NOT NULL AND category != ? GROUP BY category HAVING cnt >= 10 ORDER BY cnt DESC').bind(originCode, categoryName).all(),
        ]);

        const totalFilings = totalRes?.cnt || 0;

        // 404 if fewer than 10 filings
        if (totalFilings < 10) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        const topCompanies = topCompaniesRes.results || [];
        const topBrands = topBrandsRes.results || [];
        const recentFilings = recentRes.results || [];
        const yearTrend = yearTrendRes.results || [];
        const otherCats = otherCatsRes.results || [];

        // Top companies table
        const companiesTableHtml = topCompanies.length > 0 ? `
            <section class="seo-card">
                <h2>Top ${escapeHtml(categoryName)} Companies in ${escapeHtml(state.name)}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Company</th><th>Filings</th></tr></thead>
                        <tbody>
                            ${topCompanies.map((co, i) => `
                                <tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/company/${co.slug}/">${escapeHtml(co.canonical_name)}</a></td>
                                    <td>${formatNumber(co.cnt)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Top brands table
        const brandsTableHtml = topBrands.length > 0 ? `
            <section class="seo-card">
                <h2>Top ${escapeHtml(categoryName)} Brands in ${escapeHtml(state.name)}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Brand</th><th>Filings</th></tr></thead>
                        <tbody>
                            ${topBrands.map((br, i) => {
                                const brandSlug = br.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                                return `
                                <tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/brand/${brandSlug}/">${escapeHtml(br.brand_name)}</a></td>
                                    <td>${formatNumber(br.cnt)}</td>
                                </tr>
                            `;}).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Recent filings table
        const signalClass = { 'NEW_COMPANY': 'signal-new-company', 'NEW_BRAND': 'signal-new-brand', 'NEW_SKU': 'signal-new-sku', 'REFILE': 'signal-refile' };
        const recentHtml = recentFilings.length > 0 ? `
            <section class="seo-card">
                <h2>Recent ${escapeHtml(categoryName)} Filings in ${escapeHtml(state.name)}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>Date</th><th>Brand</th><th>Product</th><th>Company</th><th>Signal</th></tr></thead>
                        <tbody>
                            ${recentFilings.map(f => `
                                <tr>
                                    <td>${f.approval_date || ''}</td>
                                    <td>${escapeHtml(f.brand_name || '')}</td>
                                    <td>${escapeHtml(f.fanciful_name || '—')}</td>
                                    <td>${escapeHtml(f.company_name || '')}</td>
                                    <td><span class="signal-gated"><span class="signal-badge ${signalClass[f.signal] || ''}">${f.signal || ''}</span><span class="signal-lock" title="Pro feature">&#128274;</span></span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Year trend chart
        const yearTrendHtml = yearTrend.length > 0 ? (() => {
            const maxYear = Math.max(...yearTrend.map(y => y.cnt));
            return `
                <section class="seo-card">
                    <h2>Filing Trend (Last 5 Years)</h2>
                    <div class="bar-chart">
                        ${yearTrend.map(y => `
                            <div class="bar-row">
                                <div class="bar-label">${y.year}</div>
                                <div class="bar-container"><div class="bar-fill" style="width: ${((y.cnt / maxYear) * 100).toFixed(0)}%"></div></div>
                                <div class="bar-value">${formatNumber(y.cnt)}</div>
                            </div>
                        `).join('')}
                    </div>
                </section>
            `;
        })() : '';

        // Other category links
        const otherCatsHtml = otherCats.length > 0 ? `
            <div class="related-links">
                <div class="related-heading">Other Categories in ${escapeHtml(state.name)}</div>
                ${otherCats.map(c => {
                    const catSlug = LOCATION_CATEGORY_SLUG_MAP[c.category];
                    return catSlug ? `<a href="/locations/${state.slug}/${catSlug}/">${escapeHtml(c.category)} (${formatNumber(c.cnt)})</a>` : '';
                }).filter(Boolean).join('')}
            </div>
        ` : '';

        const canonicalUrl = `${BASE_URL}/locations/${state.slug}/${categorySlug}/`;
        const title = `${categoryName} in ${state.name} — Companies, Brands & TTB Data`;
        const description = `${formatNumber(totalFilings)} ${categoryName.toLowerCase()} TTB label approvals in ${state.name}. Browse top ${categoryName.toLowerCase()} companies, brands, and recent filings.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "WebPage",
                "name": title,
                "description": description,
                "url": canonicalUrl
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Locations", "item": `${BASE_URL}/locations/` },
                    { "@type": "ListItem", "position": 3, "name": state.name, "item": `${BASE_URL}/locations/${state.slug}/` },
                    { "@type": "ListItem", "position": 4, "name": categoryName }
                ]
            }
        ];

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/locations/">Locations</a> / <a href="/locations/${state.slug}/">${escapeHtml(state.name)}</a> / ${escapeHtml(categoryName)}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>${escapeHtml(categoryName)} in ${escapeHtml(state.name)}</h1>
                    <div class="meta">
                        <span><strong>${formatNumber(totalFilings)}</strong> TTB filings</span>
                        <span><strong>${topCompanies.length > 0 ? topCompanies.length + '+' : '0'}</strong> companies</span>
                        <span class="category-badge">${escapeHtml(categoryName)}</span>
                    </div>
                </div>
            </header>

            <section class="seo-card">
                <h2>Overview</h2>
                <p style="line-height: 1.75; color: #475569; margin: 0 0 16px 0;">
                    ${escapeHtml(state.name)} has <strong>${formatNumber(totalFilings)}</strong> TTB label approvals in the ${escapeHtml(categoryName).toLowerCase()} category. This data covers every Certificate of Label Approval (COLA) filed by ${escapeHtml(categoryName).toLowerCase()} producers and importers based in the state.
                </p>
                <p style="line-height: 1.75; color: #475569; margin: 0;">
                    ${yearTrend.length >= 2 ? `In ${yearTrend[0].year}, there were <strong>${formatNumber(yearTrend[0].cnt)}</strong> filings, ${yearTrend[0].cnt > yearTrend[1].cnt ? 'up' : 'down'} from <strong>${formatNumber(yearTrend[1].cnt)}</strong> in ${yearTrend[1].year}.` : ''}
                    For service providers targeting the ${escapeHtml(categoryName).toLowerCase()} segment in ${escapeHtml(state.name)}, this page highlights the most active companies and brands to watch.
                </p>
            </section>

            ${companiesTableHtml}
            ${brandsTableHtml}
            ${recentHtml}
            ${yearTrendHtml}
            ${otherCatsHtml}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`State category page error for ${originCode}/${categorySlug}:`, error.message);
        return new Response('Error loading page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// ==========================================
// COMPARISON PAGE HANDLER
// ==========================================

async function handleComparisonPage(path, env) {
    const slug = path.replace('/compare/', '').replace(/\/$/, '');
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    // Parse "brand-a-vs-brand-b" from the slug
    const vsIndex = slug.indexOf('-vs-');
    if (vsIndex === -1) {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
    }

    const slugA = slug.substring(0, vsIndex);
    const slugB = slug.substring(vsIndex + 4);

    if (!slugA || !slugB || slugA === slugB) {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
    }

    try {
        // Look up both brands in brand_slugs
        const [brandA, brandB] = await Promise.all([
            env.DB.prepare('SELECT brand_name, filing_count as cnt FROM brand_slugs WHERE slug = ?').bind(slugA).first(),
            env.DB.prepare('SELECT brand_name, filing_count as cnt FROM brand_slugs WHERE slug = ?').bind(slugB).first(),
        ]);

        if (!brandA || !brandB) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Require 10+ filings each
        if (brandA.cnt < 10 || brandB.cnt < 10) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Run queries for both brands in parallel
        const [
            catsA, catsB,
            companiesA, companiesB,
            recentA, recentB,
            trendA, trendB,
            statesA, statesB
        ] = await Promise.all([
            // Category breakdown
            env.DB.prepare('SELECT category, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND category IS NOT NULL GROUP BY category ORDER BY cnt DESC').bind(brandA.brand_name).all(),
            env.DB.prepare('SELECT category, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND category IS NOT NULL GROUP BY category ORDER BY cnt DESC').bind(brandB.brand_name).all(),
            // Parent company (top company by filings)
            env.DB.prepare(`
                SELECT c.canonical_name, c.slug, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.brand_name = ?
                GROUP BY c.id ORDER BY cnt DESC LIMIT 1
            `).bind(brandA.brand_name).first(),
            env.DB.prepare(`
                SELECT c.canonical_name, c.slug, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.brand_name = ?
                GROUP BY c.id ORDER BY cnt DESC LIMIT 1
            `).bind(brandB.brand_name).first(),
            // Most recent filing
            env.DB.prepare('SELECT approval_date, fanciful_name, signal FROM colas WHERE brand_name = ? ORDER BY approval_date DESC LIMIT 1').bind(brandA.brand_name).first(),
            env.DB.prepare('SELECT approval_date, fanciful_name, signal FROM colas WHERE brand_name = ? ORDER BY approval_date DESC LIMIT 1').bind(brandB.brand_name).first(),
            // Year trend (last 5 years)
            env.DB.prepare('SELECT year, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND year IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 5').bind(brandA.brand_name).all(),
            env.DB.prepare('SELECT year, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND year IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 5').bind(brandB.brand_name).all(),
            // Top states
            env.DB.prepare('SELECT origin_code as origin, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND origin_code IS NOT NULL GROUP BY origin ORDER BY cnt DESC LIMIT 3').bind(brandA.brand_name).all(),
            env.DB.prepare('SELECT origin_code as origin, COUNT(*) as cnt FROM colas WHERE brand_name = ? AND origin_code IS NOT NULL GROUP BY origin ORDER BY cnt DESC LIMIT 3').bind(brandB.brand_name).all(),
        ]);

        const categoriesA = catsA.results || [];
        const categoriesB = catsB.results || [];
        const yearsA = trendA.results || [];
        const yearsB = trendB.results || [];
        const topStatesA = (statesA.results || []).map(s => STATE_DATA[s.origin]?.name || s.origin).slice(0, 3);
        const topStatesB = (statesB.results || []).map(s => STATE_DATA[s.origin]?.name || s.origin).slice(0, 3);

        const primaryCatA = categoriesA.length > 0 ? categoriesA[0].category : 'Unknown';
        const primaryCatB = categoriesB.length > 0 ? categoriesB[0].category : 'Unknown';
        const companyNameA = companiesA?.canonical_name || 'Unknown';
        const companyNameB = companiesB?.canonical_name || 'Unknown';
        const companySlugA = companiesA?.slug || '';
        const companySlugB = companiesB?.slug || '';

        // Compute YoY trend direction
        function getTrend(years) {
            if (years.length < 2) return 'stable';
            return years[0].cnt > years[1].cnt ? 'up' : years[0].cnt < years[1].cnt ? 'down' : 'stable';
        }
        const trendDirA = getTrend(yearsA);
        const trendDirB = getTrend(yearsB);
        const trendLabelA = trendDirA === 'up' ? 'Trending Up' : trendDirA === 'down' ? 'Trending Down' : 'Stable';
        const trendLabelB = trendDirB === 'up' ? 'Trending Up' : trendDirB === 'down' ? 'Trending Down' : 'Stable';

        // Format display names (title case)
        const nameA = brandA.brand_name;
        const nameB = brandB.brand_name;
        const displayA = fixDisplayName(nameA);
        const displayB = fixDisplayName(nameB);

        // Generate verdict
        const moreActive = brandA.cnt > brandB.cnt ? displayA : brandB.cnt > brandA.cnt ? displayB : null;
        const ratio = Math.max(brandA.cnt, brandB.cnt) / Math.min(brandA.cnt, brandB.cnt);
        const sameCat = primaryCatA === primaryCatB;
        const sameCompany = companyNameA === companyNameB && companyNameA !== 'Unknown';

        let verdict = '';
        if (moreActive) {
            verdict += `<strong>${escapeHtml(moreActive)}</strong> has ${formatNumber(Math.max(brandA.cnt, brandB.cnt))} total TTB filings compared to ${formatNumber(Math.min(brandA.cnt, brandB.cnt))} for ${escapeHtml(moreActive === displayA ? displayB : displayA)}, making it roughly ${ratio.toFixed(1)}x more active in label submissions. `;
        } else {
            verdict += `Both brands have exactly ${formatNumber(brandA.cnt)} TTB filings, indicating comparable market activity. `;
        }
        if (sameCat) {
            verdict += `Both brands compete primarily in the <strong>${escapeHtml(primaryCatA)}</strong> category. `;
        } else {
            verdict += `${escapeHtml(displayA)} is primarily a <strong>${escapeHtml(primaryCatA).toLowerCase()}</strong> brand while ${escapeHtml(displayB)} focuses on <strong>${escapeHtml(primaryCatB).toLowerCase()}</strong>. `;
        }
        if (trendDirA === 'up' && trendDirB !== 'up') {
            verdict += `${escapeHtml(displayA)} shows increasing filing activity year-over-year, suggesting growing market momentum.`;
        } else if (trendDirB === 'up' && trendDirA !== 'up') {
            verdict += `${escapeHtml(displayB)} shows increasing filing activity year-over-year, suggesting growing market momentum.`;
        } else if (trendDirA === 'up' && trendDirB === 'up') {
            verdict += `Both brands show increasing filing activity, reflecting growth in their respective segments.`;
        }

        // Comparison table
        const comparisonRows = [
            ['Total Filings', formatNumber(brandA.cnt), formatNumber(brandB.cnt), brandA.cnt > brandB.cnt ? 'a' : brandB.cnt > brandA.cnt ? 'b' : ''],
            ['Primary Category', escapeHtml(primaryCatA), escapeHtml(primaryCatB), ''],
            ['Parent Company',
                companySlugA ? `<a href="/company/${companySlugA}/">${escapeHtml(companyNameA)}</a>` : escapeHtml(companyNameA),
                companySlugB ? `<a href="/company/${companySlugB}/">${escapeHtml(companyNameB)}</a>` : escapeHtml(companyNameB),
                ''],
            ['Most Recent Filing', recentA?.approval_date || '—', recentB?.approval_date || '—', ''],
            ['Categories', String(categoriesA.length), String(categoriesB.length), categoriesA.length > categoriesB.length ? 'a' : categoriesB.length > categoriesA.length ? 'b' : ''],
            ['YoY Trend', trendLabelA, trendLabelB, trendDirA === 'up' && trendDirB !== 'up' ? 'a' : trendDirB === 'up' && trendDirA !== 'up' ? 'b' : ''],
            ['Top States', topStatesA.join(', ') || '—', topStatesB.join(', ') || '—', ''],
        ];

        const comparisonTableHtml = `
            <section class="seo-card">
                <h2>Side-by-Side Comparison</h2>
                <div class="table-wrapper">
                    <table class="filings-table compare-table">
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th><a href="/brand/${slugA}/">${escapeHtml(displayA)}</a></th>
                                <th><a href="/brand/${slugB}/">${escapeHtml(displayB)}</a></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${comparisonRows.map(([label, valA, valB, winner]) => `
                                <tr>
                                    <td><strong>${label}</strong></td>
                                    <td${winner === 'a' ? ' class="compare-winner"' : ''}>${valA}</td>
                                    <td${winner === 'b' ? ' class="compare-winner"' : ''}>${valB}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `;

        // Category breakdown side-by-side
        const allCats = new Set([...categoriesA.map(c => c.category), ...categoriesB.map(c => c.category)]);
        const catMapA = Object.fromEntries(categoriesA.map(c => [c.category, c.cnt]));
        const catMapB = Object.fromEntries(categoriesB.map(c => [c.category, c.cnt]));

        const categoryCompareHtml = allCats.size > 0 ? `
            <section class="seo-card">
                <h2>Category Breakdown</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>Category</th><th>${escapeHtml(displayA)}</th><th>${escapeHtml(displayB)}</th></tr></thead>
                        <tbody>
                            ${[...allCats].map(cat => {
                                const cntA = catMapA[cat] || 0;
                                const cntB = catMapB[cat] || 0;
                                return `<tr>
                                    <td>${escapeHtml(cat)}</td>
                                    <td${cntA > cntB ? ' class="compare-winner"' : ''}>${formatNumber(cntA)}</td>
                                    <td${cntB > cntA ? ' class="compare-winner"' : ''}>${formatNumber(cntB)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        // Year trend side-by-side
        const allYears = new Set([...yearsA.map(y => y.year), ...yearsB.map(y => y.year)]);
        const yearMapA = Object.fromEntries(yearsA.map(y => [y.year, y.cnt]));
        const yearMapB = Object.fromEntries(yearsB.map(y => [y.year, y.cnt]));
        const sortedYears = [...allYears].sort((a, b) => b - a);

        const yearCompareHtml = sortedYears.length > 0 ? `
            <section class="seo-card">
                <h2>Filing Timeline</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>Year</th><th>${escapeHtml(displayA)}</th><th>${escapeHtml(displayB)}</th></tr></thead>
                        <tbody>
                            ${sortedYears.map(yr => {
                                const cntA = yearMapA[yr] || 0;
                                const cntB = yearMapB[yr] || 0;
                                return `<tr>
                                    <td>${yr}</td>
                                    <td${cntA > cntB ? ' class="compare-winner"' : ''}>${formatNumber(cntA)}</td>
                                    <td${cntB > cntA ? ' class="compare-winner"' : ''}>${formatNumber(cntB)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : '';

        const dateModified = new Date().toISOString().split('T')[0];
        const canonicalUrl = `${BASE_URL}/compare/${slugA}-vs-${slugB}/`;
        const title = `${displayA} vs ${displayB} — Brand Comparison`;
        const description = `Compare ${displayA} and ${displayB}: ${formatNumber(brandA.cnt)} vs ${formatNumber(brandB.cnt)} TTB filings. Side-by-side analysis of categories, companies, filing trends, and market activity.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "WebPage",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "dateModified": dateModified
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Compare", "item": `${BASE_URL}/compare/` },
                    { "@type": "ListItem", "position": 3, "name": `${displayA} vs ${displayB}` }
                ]
            }
        ];

        const extraHead = `<meta property="article:modified_time" content="${dateModified}">`;

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / Compare / ${escapeHtml(displayA)} vs ${escapeHtml(displayB)}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>${escapeHtml(displayA)} vs ${escapeHtml(displayB)}</h1>
                    <div class="meta">
                        <span><a href="/brand/${slugA}/">${escapeHtml(displayA)}</a>: <strong>${formatNumber(brandA.cnt)}</strong> filings</span>
                        <span><a href="/brand/${slugB}/">${escapeHtml(displayB)}</a>: <strong>${formatNumber(brandB.cnt)}</strong> filings</span>
                    </div>
                </div>
            </header>

            <section class="seo-card">
                <h2>Verdict</h2>
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    ${verdict}
                </p>
            </section>

            ${comparisonTableHtml}
            ${categoryCompareHtml}
            ${yearCompareHtml}

            <section class="seo-card">
                <h2>About This Comparison</h2>
                <p style="line-height: 1.75; color: #475569; margin: 0;">
                    This comparison is based on TTB (Alcohol and Tobacco Tax and Trade Bureau) Certificate of Label Approval data. Each filing represents a label approval for a specific product SKU. More filings generally indicate a broader product portfolio or more frequent label updates, which can signal active market participation and brand investment. This data helps service providers — such as label printers, compliance consultants, and co-packers — understand which brands are most actively expanding their product lines.
                </p>
            </section>

            <div class="related-links">
                <div class="related-heading">Explore These Brands</div>
                <a href="/brand/${slugA}/">${escapeHtml(displayA)} Brand Page</a>
                <a href="/brand/${slugB}/">${escapeHtml(displayB)} Brand Page</a>
                ${companySlugA ? `<a href="/company/${companySlugA}/">${escapeHtml(companyNameA)}</a>` : ''}
                ${companySlugB && companySlugB !== companySlugA ? `<a href="/company/${companySlugB}/">${escapeHtml(companyNameB)}</a>` : ''}
            </div>
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`Comparison page error for ${slug}:`, error.message);
        return new Response('Error loading comparison', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// ==========================================
// CURATION PAGE HANDLERS (/best/)
// ==========================================

// Map for curation category slugs
const BEST_CATEGORY_MAP = {
    'whiskey': 'Whiskey', 'tequila': 'Tequila', 'vodka': 'Vodka', 'gin': 'Gin',
    'rum': 'Rum', 'brandy': 'Brandy', 'wine': 'Wine', 'beer': 'Beer',
    'liqueur': 'Liqueur', 'cocktails': 'Cocktails', 'other': 'Other',
};
const BEST_CATEGORY_REVERSE = {};
for (const [slug, name] of Object.entries(BEST_CATEGORY_MAP)) {
    BEST_CATEGORY_REVERSE[name] = slug;
}

// Router for /best/* pages
async function handleBestPage(path, env) {
    const slug = path.replace('/best/', '').replace(/\/$/, '');
    const headers404 = { 'Content-Type': 'text/plain', ...SECURITY_HEADERS };

    // Match /best/new-brands-YYYY/
    const newBrandsMatch = slug.match(/^new-brands-(\d{4})$/);
    if (newBrandsMatch) {
        return await handleBestNewBrands(parseInt(newBrandsMatch[1]), env);
    }

    // Match /best/[category]-brands-YYYY/ or /best/[category]-companies-YYYY/
    const catMatch = slug.match(/^(.+)-(brands|companies)-(\d{4})$/);
    if (catMatch) {
        const catSlug = catMatch[1];
        const type = catMatch[2];
        const year = parseInt(catMatch[3]);
        const categoryName = BEST_CATEGORY_MAP[catSlug];
        if (!categoryName) {
            return new Response('Not Found', { status: 404, headers: headers404 });
        }
        if (type === 'brands') {
            return await handleBestBrands(catSlug, categoryName, year, env);
        } else {
            return await handleBestCompanies(catSlug, categoryName, year, env);
        }
    }

    return new Response('Not Found', { status: 404, headers: headers404 });
}

// /best/ — Index page
async function handleBestIndex(env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Get all valid category+year combos with 20+ filings
        const combos = await env.DB.prepare(`
            SELECT category, year, COUNT(*) as cnt
            FROM colas
            WHERE category IS NOT NULL AND year IS NOT NULL
            GROUP BY category, year
            HAVING cnt >= 20
            ORDER BY year DESC, category
        `).all();

        // Get years with new brands (first appearance)
        const newBrandYears = await env.DB.prepare(`
            SELECT year, COUNT(DISTINCT brand_name) as cnt
            FROM colas
            WHERE year IS NOT NULL AND signal = 'NEW_BRAND'
            GROUP BY year
            HAVING cnt >= 5
            ORDER BY year DESC
        `).all();

        // Group combos by year
        const byYear = {};
        for (const row of (combos.results || [])) {
            if (!byYear[row.year]) byYear[row.year] = [];
            byYear[row.year].push(row);
        }
        const years = Object.keys(byYear).sort((a, b) => b - a);

        // Build content
        let yearSectionsHtml = '';
        for (const year of years) {
            const cats = byYear[year];
            const linksHtml = cats.map(c => {
                const catSlug = BEST_CATEGORY_REVERSE[c.category];
                if (!catSlug) return '';
                return `
                    <div class="best-index-pair">
                        <a href="/best/${catSlug}-brands-${year}/">Top ${escapeHtml(c.category)} Brands</a>
                        <a href="/best/${catSlug}-companies-${year}/">Top ${escapeHtml(c.category)} Companies</a>
                    </div>
                `;
            }).filter(Boolean).join('');

            // Check if this year has a new brands page
            const hasNewBrands = (newBrandYears.results || []).find(r => r.year == year);
            const newBrandsLink = hasNewBrands
                ? `<div class="best-index-pair"><a href="/best/new-brands-${year}/">New Brands of ${year}</a></div>`
                : '';

            yearSectionsHtml += `
                <section class="seo-card best-year-section" id="year-${year}">
                    <h2>${year}</h2>
                    <div class="best-index-grid">
                        ${newBrandsLink}
                        ${linksHtml}
                    </div>
                </section>
            `;
        }

        // Year nav
        const yearNavHtml = years.map(y => `<a href="#year-${y}">${y}</a>`).join('');

        const canonicalUrl = `${BASE_URL}/best/`;
        const title = 'Top Brands & Companies by Category — Annual Rankings';
        const description = 'Annual rankings of the most active beverage alcohol brands and companies by TTB filing volume. Browse top brands, companies, and new market entrants by category and year.';

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": title,
                "description": description,
                "url": canonicalUrl
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Best" }
                ]
            }
        ];

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / Rankings
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>Top Brands & Companies by Category</h1>
                    <div class="meta">
                        <span>Annual rankings based on TTB filing volume</span>
                        <span><strong>${years.length}</strong> years of data</span>
                    </div>
                </div>
            </header>

            <section class="seo-card" style="margin-bottom: 32px;">
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    These rankings are based on TTB Certificate of Label Approval (COLA) filing volume — the number of product labels each brand or company submitted for federal approval in a given year. Higher filing counts indicate a broader product portfolio, more frequent label updates, or active market expansion. For service providers looking to identify the most active players in each category, these rankings highlight who's investing the most in new products year over year.
                </p>
            </section>

            <nav class="glossary-toc-nav" style="margin-bottom: 24px;">
                ${yearNavHtml}
            </nav>

            ${yearSectionsHtml}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error('Best index error:', error.message);
        return new Response('Error loading page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// /best/[category]-brands-[year]/ — Top 25 brands in a category for a year
async function handleBestBrands(catSlug, categoryName, year, env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Check threshold
        const totalRes = await env.DB.prepare(
            'SELECT COUNT(*) as cnt FROM colas WHERE category = ? AND year = ?'
        ).bind(categoryName, year).first();

        if (!totalRes || totalRes.cnt < 20) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Top 25 brands + prior year counts in parallel
        const [topBrandsRes, priorYearRes] = await Promise.all([
            env.DB.prepare(`
                SELECT brand_name, COUNT(*) as cnt
                FROM colas WHERE category = ? AND year = ?
                GROUP BY brand_name ORDER BY cnt DESC LIMIT 25
            `).bind(categoryName, year).all(),
            env.DB.prepare(`
                SELECT brand_name, COUNT(*) as cnt
                FROM colas WHERE category = ? AND year = ?
                GROUP BY brand_name
            `).bind(categoryName, year - 1).all(),
        ]);

        const topBrands = topBrandsRes.results || [];
        if (topBrands.length === 0) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        const priorMap = Object.fromEntries((priorYearRes.results || []).map(r => [r.brand_name, r.cnt]));

        // Get parent companies for top brands (batch via IN clause)
        const brandNames = topBrands.map(b => b.brand_name);
        const placeholders = brandNames.map(() => '?').join(',');
        const companiesRes = await env.DB.prepare(`
            SELECT co.brand_name, c.canonical_name, c.slug
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            JOIN companies c ON ca.company_id = c.id
            WHERE co.brand_name IN (${placeholders}) AND co.category = ? AND co.year = ?
            GROUP BY co.brand_name, c.id
            ORDER BY COUNT(*) DESC
        `).bind(...brandNames, categoryName, year).all();

        const companyMap = {};
        for (const row of (companiesRes.results || [])) {
            if (!companyMap[row.brand_name]) {
                companyMap[row.brand_name] = { name: row.canonical_name, slug: row.slug };
            }
        }

        // Build table
        const leader = topBrands[0];
        const fastestGrower = topBrands.reduce((best, b) => {
            const prior = priorMap[b.brand_name] || 0;
            const growth = prior > 0 ? (b.cnt - prior) / prior : (b.cnt > 5 ? 999 : 0);
            const bestPrior = priorMap[best.brand_name] || 0;
            const bestGrowth = bestPrior > 0 ? (best.cnt - bestPrior) / bestPrior : (best.cnt > 5 ? 999 : 0);
            return growth > bestGrowth ? b : best;
        }, topBrands[0]);

        const newEntrants = topBrands.filter(b => !priorMap[b.brand_name] && b.cnt >= 5);

        const tableHtml = `
            <section class="seo-card">
                <h2>Top 25 ${escapeHtml(categoryName)} Brands — ${year}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Brand</th><th>${year} Filings</th><th>${year - 1}</th><th>Trend</th><th>Company</th></tr></thead>
                        <tbody>
                            ${topBrands.map((b, i) => {
                                const brandSlug = makeSlug(b.brand_name);
                                const prior = priorMap[b.brand_name] || 0;
                                const diff = b.cnt - prior;
                                const trendIcon = diff > 0 ? '<span style="color:#059669">&#9650;</span>' : diff < 0 ? '<span style="color:#dc2626">&#9660;</span>' : '<span style="color:#94a3b8">&#8212;</span>';
                                const trendText = prior > 0 ? ` ${diff > 0 ? '+' : ''}${formatNumber(diff)}` : (b.cnt >= 5 ? ' new' : '');
                                const co = companyMap[b.brand_name];
                                const coHtml = co ? `<a href="/company/${co.slug}/">${escapeHtml(co.name)}</a>` : '—';
                                return `<tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/brand/${brandSlug}/">${escapeHtml(b.brand_name)}</a></td>
                                    <td><strong>${formatNumber(b.cnt)}</strong></td>
                                    <td>${prior > 0 ? formatNumber(prior) : '—'}</td>
                                    <td>${trendIcon}${trendText}</td>
                                    <td>${coHtml}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `;

        // Intro paragraph
        const leaderDisplay = leader.brand_name;
        const leaderPrior = priorMap[leader.brand_name] || 0;
        let introHtml = `<strong>${escapeHtml(leaderDisplay)}</strong> leads all ${escapeHtml(categoryName).toLowerCase()} brands in ${year} with <strong>${formatNumber(leader.cnt)}</strong> TTB label approvals`;
        if (leaderPrior > 0) {
            introHtml += `, ${leader.cnt > leaderPrior ? 'up' : 'down'} from ${formatNumber(leaderPrior)} in ${year - 1}`;
        }
        introHtml += '. ';

        if (fastestGrower && fastestGrower.brand_name !== leader.brand_name) {
            const fgPrior = priorMap[fastestGrower.brand_name] || 0;
            if (fgPrior > 0) {
                const growthPct = (((fastestGrower.cnt - fgPrior) / fgPrior) * 100).toFixed(0);
                if (parseInt(growthPct) > 20) {
                    introHtml += `<strong>${escapeHtml(fastestGrower.brand_name)}</strong> is the fastest grower, up ${growthPct}% year-over-year. `;
                }
            }
        }

        if (newEntrants.length > 0) {
            const topNew = newEntrants.slice(0, 3).map(b => `<strong>${escapeHtml(b.brand_name)}</strong>`);
            introHtml += `Notable new entrants include ${topNew.join(', ')}${newEntrants.length > 3 ? ` and ${newEntrants.length - 3} more` : ''}.`;
        }

        // Related links
        const relatedHtml = `
            <div class="related-links">
                <div class="related-heading">Related Rankings</div>
                <a href="/best/${catSlug}-companies-${year}/">Top ${escapeHtml(categoryName)} Companies ${year}</a>
                ${year > 2000 ? `<a href="/best/${catSlug}-brands-${year - 1}/">Top ${escapeHtml(categoryName)} Brands ${year - 1}</a>` : ''}
                <a href="/best/new-brands-${year}/">New Brands of ${year}</a>
                <a href="/best/">All Rankings</a>
            </div>
        `;

        const dateModified = new Date().toISOString().split('T')[0];
        const canonicalUrl = `${BASE_URL}/best/${catSlug}-brands-${year}/`;
        const title = `Top ${categoryName} Brands ${year} — Ranked by TTB Filings`;
        const description = `The 25 most active ${categoryName.toLowerCase()} brands in ${year} by TTB filing volume. ${escapeHtml(leaderDisplay)} leads with ${formatNumber(leader.cnt)} label approvals.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "ItemList",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "numberOfItems": topBrands.length,
                "itemListElement": topBrands.slice(0, 10).map((b, i) => ({
                    "@type": "ListItem",
                    "position": i + 1,
                    "name": b.brand_name,
                    "url": `${BASE_URL}/brand/${makeSlug(b.brand_name)}/`
                }))
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Rankings", "item": `${BASE_URL}/best/` },
                    { "@type": "ListItem", "position": 3, "name": `${categoryName} Brands ${year}` }
                ]
            }
        ];

        const extraHead = `<meta property="article:modified_time" content="${dateModified}">`;

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/best/">Rankings</a> / ${escapeHtml(categoryName)} Brands ${year}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>Top ${escapeHtml(categoryName)} Brands ${year}</h1>
                    <div class="meta">
                        <span>Ranked by TTB filing volume</span>
                        <span><strong>${formatNumber(totalRes.cnt)}</strong> total ${escapeHtml(categoryName).toLowerCase()} filings in ${year}</span>
                        <span class="category-badge">${escapeHtml(categoryName)}</span>
                    </div>
                </div>
            </header>

            <section class="seo-card">
                <h2>Overview</h2>
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    ${introHtml}
                </p>
            </section>

            ${tableHtml}
            ${relatedHtml}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`Best brands error for ${catSlug}/${year}:`, error.message);
        return new Response('Error loading page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// /best/[category]-companies-[year]/ — Top 25 companies in a category for a year
async function handleBestCompanies(catSlug, categoryName, year, env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Check threshold
        const totalRes = await env.DB.prepare(
            'SELECT COUNT(*) as cnt FROM colas WHERE category = ? AND year = ?'
        ).bind(categoryName, year).first();

        if (!totalRes || totalRes.cnt < 20) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Top 25 companies with filing count and brand count
        const [topCompaniesRes, priorYearRes] = await Promise.all([
            env.DB.prepare(`
                SELECT c.canonical_name, c.slug, COUNT(*) as cnt, COUNT(DISTINCT co.brand_name) as brand_count
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.category = ? AND co.year = ?
                GROUP BY c.id ORDER BY cnt DESC LIMIT 25
            `).bind(categoryName, year).all(),
            env.DB.prepare(`
                SELECT c.canonical_name, COUNT(*) as cnt
                FROM colas co
                JOIN company_aliases ca ON co.company_name = ca.raw_name
                JOIN companies c ON ca.company_id = c.id
                WHERE co.category = ? AND co.year = ?
                GROUP BY c.id
            `).bind(categoryName, year - 1).all(),
        ]);

        const topCompanies = topCompaniesRes.results || [];
        if (topCompanies.length === 0) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        const priorMap = Object.fromEntries((priorYearRes.results || []).map(r => [r.canonical_name, r.cnt]));

        const leader = topCompanies[0];
        const leaderPrior = priorMap[leader.canonical_name] || 0;

        // Table
        const tableHtml = `
            <section class="seo-card">
                <h2>Top 25 ${escapeHtml(categoryName)} Companies — ${year}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Company</th><th>${year} Filings</th><th>Brands</th><th>${year - 1}</th><th>Trend</th></tr></thead>
                        <tbody>
                            ${topCompanies.map((co, i) => {
                                const prior = priorMap[co.canonical_name] || 0;
                                const diff = co.cnt - prior;
                                const trendIcon = diff > 0 ? '<span style="color:#059669">&#9650;</span>' : diff < 0 ? '<span style="color:#dc2626">&#9660;</span>' : '<span style="color:#94a3b8">&#8212;</span>';
                                const trendText = prior > 0 ? ` ${diff > 0 ? '+' : ''}${formatNumber(diff)}` : (co.cnt >= 5 ? ' new' : '');
                                return `<tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/company/${co.slug}/">${escapeHtml(co.canonical_name)}</a></td>
                                    <td><strong>${formatNumber(co.cnt)}</strong></td>
                                    <td>${co.brand_count}</td>
                                    <td>${prior > 0 ? formatNumber(prior) : '—'}</td>
                                    <td>${trendIcon}${trendText}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `;

        // Intro
        let introHtml = `<strong>${escapeHtml(leader.canonical_name)}</strong> is the most active ${escapeHtml(categoryName).toLowerCase()} company in ${year} with <strong>${formatNumber(leader.cnt)}</strong> TTB filings across <strong>${leader.brand_count}</strong> brand${leader.brand_count !== 1 ? 's' : ''}`;
        if (leaderPrior > 0) {
            introHtml += `, ${leader.cnt > leaderPrior ? 'up' : 'down'} from ${formatNumber(leaderPrior)} in ${year - 1}`;
        }
        introHtml += '. ';

        const newEntrants = topCompanies.filter(co => !priorMap[co.canonical_name] && co.cnt >= 5);
        if (newEntrants.length > 0) {
            const topNew = newEntrants.slice(0, 3).map(co => `<strong>${escapeHtml(co.canonical_name)}</strong>`);
            introHtml += `New to the top 25 this year: ${topNew.join(', ')}${newEntrants.length > 3 ? ` and ${newEntrants.length - 3} more` : ''}.`;
        }

        const relatedHtml = `
            <div class="related-links">
                <div class="related-heading">Related Rankings</div>
                <a href="/best/${catSlug}-brands-${year}/">Top ${escapeHtml(categoryName)} Brands ${year}</a>
                ${year > 2000 ? `<a href="/best/${catSlug}-companies-${year - 1}/">Top ${escapeHtml(categoryName)} Companies ${year - 1}</a>` : ''}
                <a href="/best/new-brands-${year}/">New Brands of ${year}</a>
                <a href="/best/">All Rankings</a>
            </div>
        `;

        const dateModified = new Date().toISOString().split('T')[0];
        const canonicalUrl = `${BASE_URL}/best/${catSlug}-companies-${year}/`;
        const title = `Top ${categoryName} Companies ${year} — Ranked by TTB Filings`;
        const description = `The 25 most active ${categoryName.toLowerCase()} companies in ${year} by TTB filing volume. ${escapeHtml(leader.canonical_name)} leads with ${formatNumber(leader.cnt)} label approvals across ${leader.brand_count} brands.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "ItemList",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "numberOfItems": topCompanies.length,
                "itemListElement": topCompanies.slice(0, 10).map((co, i) => ({
                    "@type": "ListItem",
                    "position": i + 1,
                    "name": co.canonical_name,
                    "url": `${BASE_URL}/company/${co.slug}/`
                }))
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Rankings", "item": `${BASE_URL}/best/` },
                    { "@type": "ListItem", "position": 3, "name": `${categoryName} Companies ${year}` }
                ]
            }
        ];

        const extraHead = `<meta property="article:modified_time" content="${dateModified}">`;

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/best/">Rankings</a> / ${escapeHtml(categoryName)} Companies ${year}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>Top ${escapeHtml(categoryName)} Companies ${year}</h1>
                    <div class="meta">
                        <span>Ranked by TTB filing volume</span>
                        <span><strong>${formatNumber(totalRes.cnt)}</strong> total filings</span>
                        <span class="category-badge">${escapeHtml(categoryName)}</span>
                    </div>
                </div>
            </header>

            <section class="seo-card">
                <h2>Overview</h2>
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    ${introHtml}
                </p>
            </section>

            ${tableHtml}
            ${relatedHtml}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`Best companies error for ${catSlug}/${year}:`, error.message);
        return new Response('Error loading page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
}

// /best/new-brands-[year]/ — Brands that first appeared in a given year
async function handleBestNewBrands(year, env) {
    const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        ...SECURITY_HEADERS
    };

    try {
        // Get brands with NEW_BRAND signal in this year, ranked by filing count
        const brandsRes = await env.DB.prepare(`
            SELECT brand_name, COUNT(*) as cnt,
                   (SELECT category FROM colas c2 WHERE c2.brand_name = c1.brand_name AND c2.category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1) as primary_category
            FROM colas c1
            WHERE year = ? AND signal IN ('NEW_BRAND', 'NEW_COMPANY')
            GROUP BY brand_name
            ORDER BY cnt DESC
            LIMIT 50
        `).bind(year).all();

        const brands = brandsRes.results || [];
        if (brands.length < 5) {
            return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain', ...SECURITY_HEADERS } });
        }

        // Get parent companies for top brands
        const brandNames = brands.slice(0, 25).map(b => b.brand_name);
        const placeholders = brandNames.map(() => '?').join(',');
        const companiesRes = await env.DB.prepare(`
            SELECT co.brand_name, c.canonical_name, c.slug
            FROM colas co
            JOIN company_aliases ca ON co.company_name = ca.raw_name
            JOIN companies c ON ca.company_id = c.id
            WHERE co.brand_name IN (${placeholders})
            GROUP BY co.brand_name, c.id
            ORDER BY COUNT(*) DESC
        `).bind(...brandNames).all();

        const companyMap = {};
        for (const row of (companiesRes.results || [])) {
            if (!companyMap[row.brand_name]) {
                companyMap[row.brand_name] = { name: row.canonical_name, slug: row.slug };
            }
        }

        // Category breakdown of new brands
        const catCounts = {};
        for (const b of brands) {
            const cat = b.primary_category || 'Other';
            catCounts[cat] = (catCounts[cat] || 0) + 1;
        }
        const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

        const tableHtml = `
            <section class="seo-card">
                <h2>Top New Brands of ${year}</h2>
                <div class="table-wrapper">
                    <table class="filings-table">
                        <thead><tr><th>#</th><th>Brand</th><th>Filings</th><th>Category</th><th>Company</th></tr></thead>
                        <tbody>
                            ${brands.slice(0, 25).map((b, i) => {
                                const brandSlug = makeSlug(b.brand_name);
                                const co = companyMap[b.brand_name];
                                const coHtml = co ? `<a href="/company/${co.slug}/">${escapeHtml(co.name)}</a>` : '—';
                                return `<tr>
                                    <td>${i + 1}</td>
                                    <td><a href="/brand/${brandSlug}/">${escapeHtml(b.brand_name)}</a></td>
                                    <td><strong>${formatNumber(b.cnt)}</strong></td>
                                    <td>${escapeHtml(b.primary_category || 'Other')}</td>
                                    <td>${coHtml}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `;

        const leader = brands[0];
        let introHtml = `In ${year}, <strong>${brands.length}</strong> new brands made their first appearance in the TTB COLA database. `;
        introHtml += `<strong>${escapeHtml(leader.brand_name)}</strong> led new entrants with <strong>${formatNumber(leader.cnt)}</strong> label filings`;
        if (leader.primary_category) {
            introHtml += ` in the ${escapeHtml(leader.primary_category).toLowerCase()} category`;
        }
        introHtml += '. ';
        if (topCats.length > 0) {
            introHtml += `The most popular categories for new brands were ${topCats.map(([cat, cnt]) => `<strong>${escapeHtml(cat)}</strong> (${cnt})`).join(', ')}.`;
        }

        const relatedHtml = `
            <div class="related-links">
                <div class="related-heading">Related Rankings</div>
                ${year > 2000 ? `<a href="/best/new-brands-${year - 1}/">New Brands of ${year - 1}</a>` : ''}
                ${topCats.slice(0, 3).map(([cat]) => {
                    const cs = BEST_CATEGORY_REVERSE[cat];
                    return cs ? `<a href="/best/${cs}-brands-${year}/">Top ${escapeHtml(cat)} Brands ${year}</a>` : '';
                }).filter(Boolean).join('')}
                <a href="/best/">All Rankings</a>
            </div>
        `;

        const dateModified = new Date().toISOString().split('T')[0];
        const canonicalUrl = `${BASE_URL}/best/new-brands-${year}/`;
        const title = `New Alcohol Brands ${year} — First-Time TTB Filings`;
        const description = `${brands.length} new beverage alcohol brands entered the market in ${year}. ${escapeHtml(leader.brand_name)} led with ${formatNumber(leader.cnt)} label approvals. Browse the complete list of new market entrants.`;

        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "ItemList",
                "name": title,
                "description": description,
                "url": canonicalUrl,
                "numberOfItems": Math.min(brands.length, 25),
                "itemListElement": brands.slice(0, 10).map((b, i) => ({
                    "@type": "ListItem",
                    "position": i + 1,
                    "name": b.brand_name,
                    "url": `${BASE_URL}/brand/${makeSlug(b.brand_name)}/`
                }))
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    { "@type": "ListItem", "position": 1, "name": "Home", "item": `${BASE_URL}/` },
                    { "@type": "ListItem", "position": 2, "name": "Rankings", "item": `${BASE_URL}/best/` },
                    { "@type": "ListItem", "position": 3, "name": `New Brands ${year}` }
                ]
            }
        ];

        const extraHead = `<meta property="article:modified_time" content="${dateModified}">`;

        const content = `
            <div class="breadcrumb">
                <a href="/">Home</a> / <a href="/best/">Rankings</a> / New Brands ${year}
            </div>
            <header class="seo-header">
                <div class="seo-header-inner">
                    <h1>New Alcohol Brands ${year}</h1>
                    <div class="meta">
                        <span><strong>${brands.length}</strong> new brands</span>
                        <span>First-time TTB filings</span>
                    </div>
                </div>
            </header>

            <section class="seo-card">
                <h2>Overview</h2>
                <p style="font-size: 1.05rem; line-height: 1.75; color: #475569; margin: 0;">
                    ${introHtml}
                    For service providers — including label printers, compliance consultants, co-packers, and branding agencies — new brand launches represent the highest-value prospecting opportunities. These companies are actively building their product lines and need partners across the supply chain.
                </p>
            </section>

            ${tableHtml}
            ${relatedHtml}
        `;

        return new Response(getPageLayout(title, description, content, jsonLd, canonicalUrl, extraHead), {
            status: 200,
            headers
        });
    } catch (error) {
        console.error(`Best new brands error for ${year}:`, error.message);
        return new Response('Error loading page', { status: 500, headers: { 'Content-Type': 'text/plain' } });
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

    // Dynamic sitemaps
    if (path === '/sitemap-locations.xml') {
        return await generateLocationsSitemap(env, cacheHeaders);
    }
    if (path === '/sitemap-comparisons.xml') {
        return await generateComparisonsSitemap(env, cacheHeaders);
    }
    if (path === '/sitemap-best.xml') {
        return await generateBestSitemap(env, cacheHeaders);
    }
    if (path === '/sitemap-glossary.xml') {
        return await generateGlossarySitemap(env, cacheHeaders);
    }

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
        let xml = await r2Response.text();

        // Inject dynamic sitemap references into the sitemap index
        if (path === '/sitemap.xml') {
            const today = new Date().toISOString().split('T')[0];
            const dynamicEntries = [
                `  <sitemap>\n    <loc>${BASE_URL}/sitemap-locations.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
                `  <sitemap>\n    <loc>${BASE_URL}/sitemap-comparisons.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
                `  <sitemap>\n    <loc>${BASE_URL}/sitemap-best.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
                `  <sitemap>\n    <loc>${BASE_URL}/sitemap-glossary.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
            ].join('\n');
            xml = xml.replace('</sitemapindex>', dynamicEntries + '\n</sitemapindex>');
        }

        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error(`Error fetching sitemap from R2: ${error.message}`);
        return new Response('Error loading sitemap', { status: 500 });
    }
}

async function generateLocationsSitemap(env, cacheHeaders) {
    try {
        // Get all valid state+category combos with 10+ filings
        const combos = await env.DB.prepare(`
            SELECT origin_code as origin, category, COUNT(*) as cnt
            FROM colas
            WHERE origin_code IS NOT NULL AND origin_code != '' AND category IS NOT NULL
            GROUP BY origin, category
            HAVING cnt >= 10
        `).all();

        const today = new Date().toISOString().split('T')[0];
        let urls = '';

        // Add /locations/ index
        urls += `  <url><loc>${BASE_URL}/locations/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;

        // Add all state pages
        const statesWithData = new Set();
        for (const row of combos.results) {
            statesWithData.add(row.origin);
        }
        for (const originCode of statesWithData) {
            const state = STATE_DATA[originCode];
            if (state) {
                urls += `  <url><loc>${BASE_URL}/locations/${state.slug}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
            }
        }

        // Add state+category pages
        for (const row of combos.results) {
            const state = STATE_DATA[row.origin];
            const catSlug = LOCATION_CATEGORY_SLUG_MAP[row.category];
            if (state && catSlug) {
                urls += `  <url><loc>${BASE_URL}/locations/${state.slug}/${catSlug}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`;
            }
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;

        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error('Error generating locations sitemap:', error.message);
        return new Response('Error generating sitemap', { status: 500 });
    }
}

async function generateComparisonsSitemap(env, cacheHeaders) {
    try {
        // Get top 200 brands with 10+ filings, including their primary category and parent company
        const topBrands = await env.DB.prepare(`
            SELECT bs.slug, bs.brand_name, bs.filing_count,
                   (SELECT category FROM colas WHERE brand_name = bs.brand_name AND category IS NOT NULL GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1) as primary_category,
                   (SELECT ca.company_id FROM colas co JOIN company_aliases ca ON co.company_name = ca.raw_name WHERE co.brand_name = bs.brand_name GROUP BY ca.company_id ORDER BY COUNT(*) DESC LIMIT 1) as company_id
            FROM brand_slugs bs
            WHERE bs.filing_count >= 10
            ORDER BY bs.filing_count DESC
            LIMIT 200
        `).all();

        const brands = topBrands.results || [];
        const today = new Date().toISOString().split('T')[0];
        let urls = '';
        const pairsSeen = new Set();

        // Generate meaningful pairs: same category or same parent company
        for (let i = 0; i < brands.length; i++) {
            for (let j = i + 1; j < brands.length; j++) {
                const a = brands[i];
                const b = brands[j];

                // Must share category or company
                const sameCategory = a.primary_category && a.primary_category === b.primary_category;
                const sameCompany = a.company_id && a.company_id === b.company_id;

                if (!sameCategory && !sameCompany) continue;

                // Canonical order: alphabetical by slug
                const [first, second] = a.slug < b.slug ? [a.slug, b.slug] : [b.slug, a.slug];
                const pairKey = `${first}-vs-${second}`;

                if (pairsSeen.has(pairKey)) continue;
                pairsSeen.add(pairKey);

                urls += `  <url><loc>${BASE_URL}/compare/${first}-vs-${second}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.4</priority></url>\n`;
            }
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;

        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error('Error generating comparisons sitemap:', error.message);
        return new Response('Error generating sitemap', { status: 500 });
    }
}

async function generateBestSitemap(env, cacheHeaders) {
    try {
        const [combos, newBrandYears] = await Promise.all([
            env.DB.prepare(`
                SELECT category, year, COUNT(*) as cnt
                FROM colas WHERE category IS NOT NULL AND year IS NOT NULL
                GROUP BY category, year HAVING cnt >= 20
            `).all(),
            env.DB.prepare(`
                SELECT year, COUNT(DISTINCT brand_name) as cnt
                FROM colas WHERE year IS NOT NULL AND signal IN ('NEW_BRAND', 'NEW_COMPANY')
                GROUP BY year HAVING cnt >= 5
            `).all(),
        ]);

        const today = new Date().toISOString().split('T')[0];
        let urls = `  <url><loc>${BASE_URL}/best/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;

        for (const row of (combos.results || [])) {
            const catSlug = BEST_CATEGORY_REVERSE[row.category];
            if (!catSlug) continue;
            urls += `  <url><loc>${BASE_URL}/best/${catSlug}-brands-${row.year}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
            urls += `  <url><loc>${BASE_URL}/best/${catSlug}-companies-${row.year}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
        }

        for (const row of (newBrandYears.results || [])) {
            urls += `  <url><loc>${BASE_URL}/best/new-brands-${row.year}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;

        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error('Error generating best sitemap:', error.message);
        return new Response('Error generating sitemap', { status: 500 });
    }
}

async function generateGlossarySitemap(env, cacheHeaders) {
    try {
        const terms = await env.DB.prepare(
            'SELECT term_slug FROM glossary_terms ORDER BY term_slug'
        ).all();

        const today = new Date().toISOString().split('T')[0];
        let urls = `  <url><loc>${BASE_URL}/glossary/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;

        for (const row of (terms.results || [])) {
            urls += `  <url><loc>${BASE_URL}/glossary/${row.term_slug}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;

        return new Response(xml, { headers: cacheHeaders });
    } catch (error) {
        console.error('Error generating glossary sitemap:', error.message);
        return new Response('Error generating sitemap', { status: 500 });
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
    const { company_id, company_name, brand_name, email, token: bodyToken } = body;
    const normalizedEmail = email?.toLowerCase()?.trim();
    const token = getRequestToken(request, null, bodyToken || '');

    // company_name is required, company_id is optional (permits don't have one)
    if (!company_name) {
        return { success: false, error: 'Missing company_name' };
    }

    if (!normalizedEmail) {
        return { success: false, error: 'Authentication required' };
    }
    if (!token) {
        return { success: false, error: 'Token required' };
    }
    if (!(await requireValidToken(normalizedEmail, token, env))) {
        return { success: false, error: 'Invalid token' };
    }

    // Check if already enhanced (cache hit) - only if we have a company_id
    if (company_id) {
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
    }

    // Check user credits (all users need purchased credits now)
    const creditCheck = await checkUserCredits(normalizedEmail, env);
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
            // Save to cache only if we have a company_id (not for permits)
            if (company_id) {
                await saveEnhancement(company_id, company_name, tearsheet, normalizedEmail, env);
            }

            // Deduct credit
            await deductCredit(normalizedEmail, company_id, env);
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

async function handleGetCredits(request, url, env) {
    const email = url.searchParams.get('email')?.toLowerCase();
    const token = getRequestToken(request, url);
    if (!email) {
        return { success: false, error: 'Missing email' };
    }

    if (!token) {
        return { success: false, error: 'Token required' };
    }
    if (!(await requireValidToken(email, token, env))) {
        return { success: false, error: 'Invalid token' };
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
        'SELECT is_pro, enhancement_credits FROM user_preferences WHERE LOWER(email) = ?'
    ).bind(email.toLowerCase()).first();

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
    // Deduct purchased credit atomically
    const debit = await env.DB.prepare(
        'UPDATE user_preferences SET enhancement_credits = enhancement_credits - 1 WHERE LOWER(email) = ? AND enhancement_credits > 0'
    ).bind(email.toLowerCase()).run();
    if (!debit?.meta || debit.meta.changes < 1) {
        throw new Error('Insufficient credits');
    }

    // Log the transaction
    await env.DB.prepare(`
        INSERT INTO enhancement_credits (email, type, amount, company_id, created_at)
        VALUES (?, 'used', -1, ?, datetime('now'))
    `).bind(email.toLowerCase(), companyId).run();
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
                } else if (urlLower.includes('/about') || urlLower.includes('/story') || urlLower.includes('/history')) {
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

    // Step 4: Search for contacts using multi-tier approach
    let contacts = [];
    try {
        const scrapedContent = discoveredUrls.scrapedPages || [];
        console.log(`[Enhancement] Searching for contacts. Website: ${websiteUrl || 'none'}, Scraped pages: ${scrapedContent.length}`);
        const contactResult = await searchCompanyContacts(companyName, primaryBrand, websiteUrl, scrapedContent, env);
        contacts = contactResult.contacts || [];
        console.log(`[Enhancement] Found ${contacts.length} contacts via ${contactResult.method || 'unknown'}`);
    } catch (e) {
        console.error(`[Enhancement] Contact search error: ${e.message}`);
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
        contacts,
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

// Hash a string for cache key (simple hash, not crypto)
async function hashQuery(query) {
    const encoder = new TextEncoder();
    const data = encoder.encode(query.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

// Check search cache for existing results
async function getSearchCache(query, env) {
    try {
        const queryHash = await hashQuery(query);
        const result = await env.DB.prepare(
            'SELECT results FROM search_cache WHERE query_hash = ? AND expires_at > datetime("now")'
        ).bind(queryHash).first();

        if (result) {
            console.log(`[Google] Cache HIT for: "${query}"`);
            return JSON.parse(result.results);
        }
        return null;
    } catch (e) {
        console.error('Cache lookup failed:', e);
        return null;
    }
}

// Save search results to cache (30-day TTL)
async function saveSearchCache(query, results, env) {
    try {
        const queryHash = await hashQuery(query);
        const now = new Date().toISOString();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await env.DB.prepare(
            'INSERT OR REPLACE INTO search_cache (query_hash, query, results, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(queryHash, query, JSON.stringify(results), now, expires).run();

        console.log(`[Google] Cached results for: "${query}"`);
    } catch (e) {
        console.error('Cache save failed:', e);
    }
}

// Single Google Custom Search query with caching, rate limiting, and retry
async function googleSearch(query, env, retryCount = 0) {
    if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID) {
        console.error('Google CSE credentials not configured');
        return [];
    }

    // Check cache first (only on first attempt, not retries)
    if (retryCount === 0) {
        const cached = await getSearchCache(query, env);
        if (cached) {
            return cached;
        }
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
        url.searchParams.set('num', '10');

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
        const results = data.items || [];
        console.log(`[Google] Found ${results.length} results`);

        // Cache successful results
        if (results.length > 0) {
            await saveSearchCache(query, results, env);
        }

        return results;
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

        // FIRST: Extract emails from raw HTML (before stripping tags)
        // This catches mailto: links and emails in attributes
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const foundEmails = html.match(emailRegex) || [];
        const emailSection = foundEmails.length > 0 ? `\n[EMAILS FOUND: ${[...new Set(foundEmails)].join(', ')}]\n` : '';

        // THEN: Extract text content (strip HTML tags, scripts, styles)
        let text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Prepend extracted emails to ensure they're in the content
        const content = emailSection + text;
        console.log(`[Fetch] Got ${text.length} chars from ${url}${foundEmails.length > 0 ? `, found ${foundEmails.length} emails` : ''}`);
        return content.substring(0, 5000);
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
// Strategy: Fetch homepage, extract ALL internal links, fetch those pages, search for @
async function scrapeWebsitePages(baseUrl, maxPages = 12) {
    try {
        const baseDomain = new URL(baseUrl).hostname;
        const baseOrigin = new URL(baseUrl).origin;
        const results = [];
        const visitedUrls = new Set();
        const rawHtmlForLinks = []; // Store raw HTML for link extraction

        console.log(`[Scrape] Starting crawl of ${baseDomain}`);

        // Helper to fetch raw HTML (for link extraction)
        const fetchRawHtml = async (url) => {
            try {
                await delay(500);
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(10000),
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml'
                    },
                    redirect: 'follow'
                });
                if (!response.ok) return null;
                return await response.text();
            } catch (e) {
                return null;
            }
        };

        // Helper to process raw HTML into clean content with emails extracted
        const processHtml = (html) => {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const foundEmails = html.match(emailRegex) || [];
            const emailSection = foundEmails.length > 0 ? `\n[EMAILS FOUND: ${[...new Set(foundEmails)].join(', ')}]\n` : '';

            let text = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            return (emailSection + text).substring(0, 5000);
        };

        // STEP 1: Fetch the discovered URL and root homepage (get raw HTML first)
        const homeHtml = await fetchRawHtml(baseUrl);
        if (homeHtml) {
            rawHtmlForLinks.push(homeHtml);
            results.push({ url: baseUrl, content: processHtml(homeHtml) });
            visitedUrls.add(baseUrl);
            visitedUrls.add(baseUrl.replace(/\/$/, '')); // Also mark without trailing slash
            console.log(`[Scrape] Fetched homepage: ${baseUrl}`);
        }

        // Also fetch root if discovered URL is a subpage
        if (baseUrl !== baseOrigin && baseUrl !== baseOrigin + '/') {
            const rootHtml = await fetchRawHtml(baseOrigin);
            if (rootHtml) {
                rawHtmlForLinks.push(rootHtml);
                results.push({ url: baseOrigin, content: processHtml(rootHtml) });
                visitedUrls.add(baseOrigin);
                visitedUrls.add(baseOrigin + '/');
                console.log(`[Scrape] Fetched root: ${baseOrigin}`);
            }
        }

        // STEP 2: Extract ALL internal links from pages we have
        const extractInternalLinks = (html, origin, domain) => {
            const links = new Set();
            const linkRegex = /href=["']([^"'#]+)["']/gi;
            let match;

            while ((match = linkRegex.exec(html)) !== null) {
                const href = match[1].trim();

                // Skip non-page links
                if (!href ||
                    href.startsWith('mailto:') ||
                    href.startsWith('tel:') ||
                    href.startsWith('javascript:') ||
                    href.startsWith('//') ||
                    href.match(/\.(jpg|jpeg|png|gif|svg|pdf|css|js|ico|woff|ttf)$/i)) {
                    continue;
                }

                try {
                    const fullUrl = new URL(href, origin).toString();
                    // Only keep same-domain links
                    if (new URL(fullUrl).hostname === domain) {
                        // Normalize URL (remove trailing slash for comparison)
                        const normalized = fullUrl.replace(/\/$/, '');
                        links.add(normalized);
                    }
                } catch (e) {
                    continue;
                }
            }
            return links;
        };

        // Get all links from raw HTML (not processed content which has tags stripped)
        const allLinks = new Set();
        for (const rawHtml of rawHtmlForLinks) {
            const links = extractInternalLinks(rawHtml, baseOrigin, baseDomain);
            links.forEach(link => allLinks.add(link));
        }

        console.log(`[Scrape] Found ${allLinks.size} internal links from homepage(s)`);

        // STEP 3: Fetch all internal pages (up to limit)
        for (const linkUrl of allLinks) {
            if (results.length >= maxPages) break;

            const normalizedLink = linkUrl.replace(/\/$/, '');
            if (visitedUrls.has(normalizedLink) || visitedUrls.has(normalizedLink + '/')) continue;

            try {
                const content = await fetchPageContent(linkUrl, 4000);
                if (content && content.length > 200) {
                    results.push({ url: linkUrl, content });
                    visitedUrls.add(normalizedLink);
                    visitedUrls.add(normalizedLink + '/');
                }
            } catch (e) {
                continue;
            }
        }

        console.log(`[Scrape] Crawled ${results.length} pages from ${baseDomain}`);
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
    console.log(`[Enhancement] === COMPREHENSIVE WEBSITE DISCOVERY ===`);
    console.log(`[Enhancement] Company: "${companyName}"`);
    console.log(`[Enhancement] Brand: "${brandName}"`);
    console.log(`[Enhancement] Industry: "${industryHint}"`);

    // STEP 1: Use Claude to intelligently parse company name and extract search terms
    let searchTerms = [];

    if (env.ANTHROPIC_API_KEY) {
        try {
            console.log('[Enhancement] Using Claude to parse company name...');
            const parsePrompt = `You are extracting search terms from a beverage company name to find their website.

Company name: "${companyName}"

Extract ALL possible names/aliases this company might use for their website:
1. DBAs (doing business as)
2. AKAs (also known as)
3. Comma-separated alternate names
4. Primary company name without legal suffixes
5. Abbreviated versions

Examples:
- "One Tier LLC dba BOTLD" → ["One Tier", "BOTLD"]
- "Smith Wines, Jones Imports LLC" → ["Smith Wines", "Jones Imports"]
- "United Liquors, LLC" → ["United Liquors", "United", "UL"]
- "American Beverage Company Inc" → ["American Beverage Company", "American Beverage", "ABC"]

Return ONLY a JSON array of strings: ["term1", "term2", "term3"]
Include 2-5 search terms. Be smart about abbreviations and variations.`;

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 200,
                    messages: [{ role: 'user', content: parsePrompt }]
                })
            });

            if (response.ok) {
                const result = await response.json();
                const text = (result.content?.[0]?.text || '').trim();

                // Extract JSON array
                const jsonMatch = text.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    searchTerms = JSON.parse(jsonMatch[0]);
                    console.log(`[Enhancement] Claude extracted search terms: ${searchTerms.map(t => `"${t}"`).join(', ')}`);
                }
            }
        } catch (e) {
            console.error('[Enhancement] Claude parsing failed:', e.message);
        }
    }

    // Fallback: Basic regex parsing if Claude failed
    if (searchTerms.length === 0) {
        console.log('[Enhancement] Using fallback regex parsing...');
        searchTerms = companyName
            .split(/\s*,\s*|\s+DBA\s+|\s+D\/B\/A\s+|\s+AKA\s+|\s+A\/K\/A\s+/i)
            .map(p => p
                .replace(/\b(LLC|Inc|Corp|Corporation|Company|Co|Ltd|Limited|L\.?L\.?C\.?|INC\.?|CORP\.?|LP|LLP|PLLC|PLC)\b\.?/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter(p => p.length >= 3);
    }

    searchTerms = [...new Set(searchTerms)]; // dedupe

    // STEP 2: Build SIMPLE search query list - company, brand, LinkedIn
    const queries = [];

    // Primary company name (cleaned, first term)
    const primaryCompanyTerm = searchTerms[0] || companyName;

    // 1. Company name search
    queries.push(`"${primaryCompanyTerm}"`);

    // 2. Company name + industry
    if (industryHint && industryHint !== 'alcohol') {
        queries.push(`"${primaryCompanyTerm}" ${industryHint}`);
    }

    // 3. Brand name search (ALWAYS search it if provided)
    if (brandName && brandName !== 'Unknown' && brandName.toLowerCase() !== primaryCompanyTerm.toLowerCase()) {
        queries.push(`"${brandName}"`);
        queries.push(`"${brandName}" ${industryHint}`);
    }

    // 4. LinkedIn searches (high priority for finding social presence)
    queries.push(`site:linkedin.com/company "${primaryCompanyTerm}"`);
    if (brandName && brandName !== 'Unknown' && brandName.toLowerCase() !== primaryCompanyTerm.toLowerCase()) {
        queries.push(`site:linkedin.com/company "${brandName}"`);
    }

    // 5. If we have a second company term (e.g., "Ska Durango" from "Ska Brewing Co, Ska Durango, LLC")
    if (searchTerms[1] && searchTerms[1].toLowerCase() !== primaryCompanyTerm.toLowerCase()) {
        queries.push(`"${searchTerms[1]}"`);
    }

    // De-duplicate and limit to 8 queries max
    const uniqueQueries = [...new Set(queries)].slice(0, 8);
    console.log(`[Enhancement] Will search ${uniqueQueries.length} queries:`);
    uniqueQueries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

    // STEP 2: Execute all search queries in parallel for speed
    const allResults = [];
    const seenUrls = new Set();

    const searchPromises = uniqueQueries.map(query => googleSearch(query, env));
    const searchResults = await Promise.all(searchPromises);

    // Combine and deduplicate results
    for (const results of searchResults) {
        for (const r of results) {
            if (!seenUrls.has(r.link)) {
                seenUrls.add(r.link);
                allResults.push(r);
            }
        }
    }

    console.log(`[Enhancement] Google returned ${allResults.length} unique results across all queries`);

    // STEP 3: Extract social media URLs from results (no extra API call)
    let facebookUrl = null, instagramUrl = null, youtubeUrl = null, linkedinCompanyUrl = null;
    for (const r of allResults) {
        const url = r.link;
        if (url.includes('facebook.com/') && !facebookUrl && !url.includes('/posts/')) facebookUrl = url;
        if (url.includes('instagram.com/') && !instagramUrl && !url.includes('/p/')) instagramUrl = url;
        if (url.includes('youtube.com/') && !youtubeUrl && !url.includes('/watch?')) youtubeUrl = url;
        // Capture LinkedIn company pages (not individual profiles)
        if (url.includes('linkedin.com/company/') && !linkedinCompanyUrl) linkedinCompanyUrl = url;
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
        // Fall back to LinkedIn company page if no website candidates
        const fallbackWebsite = linkedinCompanyUrl || null;
        if (fallbackWebsite) {
            console.log(`[Enhancement] Using LinkedIn company page as fallback: ${fallbackWebsite}`);
        }
        return { website: fallbackWebsite, social: { facebook: facebookUrl, instagram: instagramUrl, youtube: youtubeUrl, linkedin: linkedinCompanyUrl }, news: [], scrapedPages: [] };
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
- Companies often abbreviate: "United Liquors" may use "unisco.com", "American Beverage" may use "ambevco.com"
- Look for context clues: title/snippet mentioning the company name, "about us", contact info
- Distilleries, wineries, breweries usually have their own .com site
- Importers/distributors may have parent company domains - check if snippet mentions the company
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

    // STEP 5.5: Fall back to LinkedIn company page if no official website found
    if (!websiteUrl && linkedinCompanyUrl) {
        websiteUrl = linkedinCompanyUrl;
        console.log(`[Enhancement] No official website found, using LinkedIn company page: ${websiteUrl}`);
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
        social: { facebook: facebookUrl, instagram: instagramUrl, youtube: youtubeUrl, linkedin: linkedinCompanyUrl },
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
// PEOPLE DATA LABS CONTACT SEARCH
// ============================================================================

/**
 * Search for contacts at a company using multi-page website scraping with Claude
 * Falls back through multiple tiers: scraped content → Google search → LinkedIn search → Hunter.io
 * @param {string} companyName - Company name
 * @param {string} brandName - Brand name (for LinkedIn search)
 * @param {string} websiteUrl - Company website URL (from Google CSE)
 * @param {Array} scrapedContent - Already-scraped pages from website discovery [{url, content}, ...]
 * @param {object} env - Worker environment
 * @returns {Promise<object>} - { contacts: [], debug: string, searched_name: string }
 */
async function searchCompanyContacts(companyName, brandName, websiteUrl, scrapedContent, env) {
    console.log(`[Contacts] Starting contact search for: ${companyName}, website: ${websiteUrl || 'none'}, scrapedContent: ${scrapedContent?.length || 0} pages`);

    // Helper function to extract emails and phones from text
    const extractContactInfo = (text) => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

        const allEmails = text.match(emailRegex) || [];
        const phones = text.match(phoneRegex) || [];

        // Filter spam emails
        const spamPatterns = ['noreply', 'no-reply', 'donotreply', 'mailer', 'notifications', 'newsletter', 'sentry', 'wixpress', 'example.com', 'schema.org', 'w3.org', 'wordpress', 'googleapis', 'gravatar', 'sentry.io', 'cloudflare'];
        const validEmails = [...new Set(allEmails)].filter(email => {
            const lower = email.toLowerCase();
            return !spamPatterns.some(pattern => lower.includes(pattern));
        });

        return { emails: validEmails, phones: [...new Set(phones)] };
    };

    // STEP 1: First check already-scraped content (fastest, already fetched)
    if (scrapedContent && scrapedContent.length > 0) {
        console.log(`[Contacts] Checking ${scrapedContent.length} pre-scraped pages for emails`);
        const allScrapedText = scrapedContent.map(p => p.content || '').join('\n');

        // DIAGNOSTIC: Check if @ exists in content
        const hasAtSign = allScrapedText.includes('@');
        const hasEmailsFoundTag = allScrapedText.includes('[EMAILS FOUND:');
        const contentLength = allScrapedText.length;
        const first500 = allScrapedText.substring(0, 500);
        console.log(`[Contacts] DIAGNOSTIC: contentLength=${contentLength}, hasAtSign=${hasAtSign}, hasEmailsFoundTag=${hasEmailsFoundTag}`);
        console.log(`[Contacts] DIAGNOSTIC first 500 chars: ${first500}`);

        const { emails, phones } = extractContactInfo(allScrapedText);

        console.log(`[Contacts] Pre-scraped content search found ${emails.length} emails: ${emails.join(', ')}`);

        if (emails.length > 0) {
            const contacts = emails.slice(0, 3).map((email, idx) => ({
                name: idx === 0 ? 'Company Contact' : `Contact ${idx + 1}`,
                title: idx === 0 ? 'Primary Contact' : 'Additional Contact',
                email: email,
                phone: idx === 0 && phones.length > 0 ? phones[0] : null,
                linkedin: null
            }));
            return { contacts, debug: null, searched_name: companyName, method: 'scraped_content' };
        }
    }

    // STEP 2: Direct fetch of website (in case scraped content didn't have emails)
    if (websiteUrl) {
        try {
            const rootUrl = new URL(websiteUrl).origin;
            const urlsToFetch = [websiteUrl];
            if (rootUrl !== websiteUrl && rootUrl + '/' !== websiteUrl) {
                urlsToFetch.push(rootUrl);
            }

            console.log(`[Contacts] Direct fetching: ${urlsToFetch.join(', ')}`);

            let allHtml = '';
            for (const url of urlsToFetch) {
                try {
                    const response = await fetch(url, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        signal: AbortSignal.timeout(10000)
                    });
                    if (response.ok) {
                        const html = await response.text();
                        allHtml += html + '\n';
                        console.log(`[Contacts] Fetched ${html.length} chars from ${url}`);
                    } else {
                        console.log(`[Contacts] Fetch returned ${response.status} for ${url}`);
                    }
                } catch (e) {
                    console.log(`[Contacts] Fetch error for ${url}: ${e.message}`);
                }
            }

            if (allHtml.length > 0) {
                const { emails, phones } = extractContactInfo(allHtml);
                console.log(`[Contacts] Direct fetch found ${emails.length} emails: ${emails.join(', ')}`);

                if (emails.length > 0) {
                    const contacts = emails.slice(0, 3).map((email, idx) => ({
                        name: idx === 0 ? 'Company Contact' : `Contact ${idx + 1}`,
                        title: idx === 0 ? 'Primary Contact' : 'Additional Contact',
                        email: email,
                        phone: idx === 0 && phones.length > 0 ? phones[0] : null,
                        linkedin: null
                    }));
                    return { contacts, debug: null, searched_name: companyName, method: 'direct_fetch' };
                }
            }
        } catch (e) {
            console.log(`[Contacts] Direct fetch failed: ${e.message}`);
        }
    }

    // TIER 1: Scrape website with Claude Sonnet (only if we have a website and no emails found above)
    if (websiteUrl) {
        try {
            const scrapedContacts = await scrapeWebsiteForContacts(companyName, websiteUrl, env);
            if (scrapedContacts.contacts && scrapedContacts.contacts.length > 0) {
                console.log(`[Contacts] Found ${scrapedContacts.contacts.length} contacts via website scraping`);
                return {
                    contacts: scrapedContacts.contacts,
                    debug: null,
                    searched_name: companyName,
                    method: 'website_scraping'
                };
            }
        } catch (error) {
            console.error('[Contacts] Website scraping failed:', error);
        }
    } else {
        console.log('[Contacts] No website - skipping Tier 1 (website scraping)');
    }

    // TIER 2: Google search for company owner/CEO (works without website)
    if (env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_ID) {
        try {
            const googleContacts = await googleSearchForContacts(companyName, env);
            if (googleContacts.contacts && googleContacts.contacts.length > 0) {
                console.log(`[Contacts] Found ${googleContacts.contacts.length} contacts via Google search`);
                return {
                    contacts: googleContacts.contacts,
                    debug: null,
                    searched_name: companyName,
                    method: 'google_search'
                };
            }
        } catch (error) {
            console.error('[Contacts] Google search failed:', error);
        }
    }

    // TIER 3: LinkedIn search via Google (searches both company and brand name)
    if (env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_ID && env.ANTHROPIC_API_KEY) {
        try {
            const linkedInContacts = await linkedInSearchForContacts(companyName, brandName, env);
            if (linkedInContacts.contacts && linkedInContacts.contacts.length > 0) {
                console.log(`[Contacts] Found ${linkedInContacts.contacts.length} contacts via LinkedIn search`);
                return {
                    contacts: linkedInContacts.contacts,
                    debug: null,
                    searched_name: companyName,
                    method: 'linkedin_search'
                };
            }
        } catch (error) {
            console.error('[Contacts] LinkedIn search failed:', error);
        }
    }

    // TIER 4: Try Hunter.io as fallback (requires website for domain)
    if (websiteUrl && env.HUNTER_IO_API_KEY) {
        try {
            const domain = new URL(websiteUrl).hostname.replace(/^www\./, '');
            const hunterContacts = await hunterDomainSearch(domain, env);
            if (hunterContacts.contacts && hunterContacts.contacts.length > 0) {
                console.log(`[Contacts] Found ${hunterContacts.contacts.length} contacts via Hunter.io`);
                return {
                    contacts: hunterContacts.contacts,
                    debug: null,
                    searched_name: companyName,
                    method: 'hunter_io'
                };
            }
        } catch (error) {
            console.error('[Contacts] Hunter.io failed:', error);
        }
    } else if (!websiteUrl) {
        console.log('[Contacts] No website - skipping Tier 4 (Hunter.io needs domain)');
    }

    // Nothing found
    const methods = websiteUrl ? 'website, Google, LinkedIn, or Hunter.io' : 'Google or LinkedIn';
    return {
        contacts: [],
        debug: `No contacts found via ${methods}`,
        searched_name: companyName
    };
}

/**
 * Scrape website for contact information using Claude Sonnet
 * Fetches multiple pages (homepage, contact, about, team) and extracts structured contact data
 */
async function scrapeWebsiteForContacts(companyName, websiteUrl, env) {
    if (!env.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key not configured');
    }

    console.log(`[WebScrape] Fetching pages from ${websiteUrl}`);

    // Common contact page paths to check
    const baseUrl = new URL(websiteUrl);
    const pagesToFetch = [
        websiteUrl, // The discovered URL
        baseUrl.origin, // Root homepage (in case websiteUrl is a subpage like /story)
        `${baseUrl.origin}/contact`,
        `${baseUrl.origin}/contact-us`,
        `${baseUrl.origin}/about`,
        `${baseUrl.origin}/about-us`,
        `${baseUrl.origin}/story`,
        `${baseUrl.origin}/our-story`,
        `${baseUrl.origin}/team`,
        `${baseUrl.origin}/leadership`
    ];

    // Fetch all pages in parallel (up to 7 pages)
    const fetchPromises = pagesToFetch.map(async url => {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'BevAlc Intelligence Contact Discovery Bot (+https://bevalcintel.com)'
                },
                signal: AbortSignal.timeout(5000) // 5 second timeout per page
            });

            if (response.ok) {
                const html = await response.text();
                return { url, html: html.slice(0, 50000) }; // Limit to 50KB per page
            }
        } catch (e) {
            // Page not found or timeout - skip it
        }
        return null;
    });

    const pages = (await Promise.all(fetchPromises)).filter(p => p !== null);

    if (pages.length === 0) {
        throw new Error('Could not fetch any pages from website');
    }

    console.log(`[WebScrape] Fetched ${pages.length} pages, sending to Claude for extraction`);

    // Combine all page HTML for Claude
    const combinedContext = pages.map(p => `=== ${p.url} ===\n${p.html}`).join('\n\n');

    // Call Claude to extract contacts
    const prompt = `You are extracting contact information for ${companyName} from their website pages.

Find decision-makers and key contacts (owners, executives, directors, sales leaders). Extract:
- Full name
- Job title
- Email address
- Phone number (if available)
- LinkedIn URL (ONLY if explicitly linked on the page - DO NOT GUESS OR MAKE UP)

IMPORTANT RULES:
- Prioritize decision-makers with names: Owner, President, CEO, VP, Director, Sales Manager
- If you find named people with emails, extract them first
- If NO named contacts exist, extract the company's main contact email (even without a name)
- For company emails without names, use "Company Contact" as the name and "Primary Contact" as the title
- Skip truly generic emails like info@, contact@, support@ ONLY if better options exist
- If you find multiple people, return up to 5 most senior contacts
- Be accurate - if you're not sure, don't include it
- NEVER invent or guess LinkedIn URLs - only include if you see an actual linkedin.com link in the HTML

Website content:
${combinedContext}

Return a JSON array of contacts in this exact format:
[
  {
    "name": "John Smith",
    "title": "Owner & Winemaker",
    "email": "john@winery.com",
    "phone": "+1-555-123-4567",
    "linkedin": null
  }
]

If you find a company email address but no named person, still return it with name "Company Contact" and title "Primary Contact".
Only return an empty array [] if the page has absolutely no email addresses or contact information.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        })
    });

    if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content[0].text;

    // Parse JSON response
    let contacts = [];
    try {
        // Extract JSON array from response (might be wrapped in markdown)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            contacts = JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error('[WebScrape] Failed to parse Claude response:', e);
        console.log('[WebScrape] Raw response:', responseText);
    }

    // FALLBACK: If Claude returned empty, try regex extraction directly from HTML
    if (contacts.length === 0) {
        console.log('[WebScrape] Claude returned no contacts, trying regex fallback');

        // Extract emails using regex (excluding common generic patterns)
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const allEmails = combinedContext.match(emailRegex) || [];

        // Filter out truly generic emails and duplicates
        const genericPatterns = ['noreply@', 'no-reply@', 'donotreply@', 'mailer@', 'notifications@', 'newsletter@'];
        const uniqueEmails = [...new Set(allEmails)].filter(email => {
            const lower = email.toLowerCase();
            // Keep company-specific emails, even if they use info@, contact@, etc.
            return !genericPatterns.some(pattern => lower.startsWith(pattern));
        });

        // Extract phone numbers
        const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
        const phones = combinedContext.match(phoneRegex) || [];
        const uniquePhones = [...new Set(phones)];

        if (uniqueEmails.length > 0) {
            console.log(`[WebScrape] Regex found ${uniqueEmails.length} emails: ${uniqueEmails.join(', ')}`);
            // Take the first non-generic email as primary contact
            const primaryEmail = uniqueEmails[0];
            contacts.push({
                name: 'Company Contact',
                title: 'Primary Contact',
                email: primaryEmail,
                phone: uniquePhones.length > 0 ? uniquePhones[0] : null,
                linkedin: null
            });
        }
    }

    return { contacts };
}

/**
 * Search for contacts using Hunter.io Domain Search API
 * Uses official Hunter.io API with executive-level filtering
 */
async function hunterDomainSearch(domain, env) {
    if (!env.HUNTER_IO_API_KEY) {
        throw new Error('Hunter.io API key not configured');
    }

    console.log(`[Hunter.io] Searching domain: ${domain}`);

    // Build URL with proper parameters per Hunter.io docs
    const params = new URLSearchParams({
        domain: domain,
        api_key: env.HUNTER_IO_API_KEY,
        limit: '10',  // Get top 10 results
        seniority: 'executive',  // Filter for executives only
        type: 'personal'  // Exclude generic emails (info@, contact@)
    });

    const response = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);

    if (!response.ok) {
        const errorText = await response.text();

        // Handle specific error codes per Hunter.io docs
        if (response.status === 401) {
            throw new Error('Hunter.io API key invalid');
        } else if (response.status === 429) {
            throw new Error('Hunter.io usage limit reached');
        } else if (response.status === 404) {
            // Domain not found - not an error, just no results
            return { contacts: [] };
        }

        throw new Error(`Hunter.io API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const emails = data.data?.emails || [];

    console.log(`[Hunter.io] Found ${emails.length} emails`);

    // Transform to our contact format
    // Note: Hunter.io returns linkedin field but it's often inaccurate, so we don't include it
    const contacts = emails
        .slice(0, 5)  // Limit to top 5
        .map(e => ({
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Unknown',
            title: e.position || 'Unknown',
            email: e.value,
            phone: e.phone_number || null,
            linkedin: null,  // Hunter.io LinkedIn data is unreliable - omit it
            confidence: e.confidence  // Hunter.io provides confidence score
        }))
        .filter(c => c.name !== 'Unknown');  // Only include named contacts

    return { contacts };
}

/**
 * Search for company contacts using Google Custom Search + Claude extraction
 * Searches for "[company] owner", "[company] CEO", "[company] founder" etc.
 */
async function googleSearchForContacts(companyName, env) {
    if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID || !env.ANTHROPIC_API_KEY) {
        throw new Error('Google CSE or Anthropic API keys not configured');
    }

    console.log(`[GoogleSearch] Searching for ${companyName} owner/CEO`);

    // Try multiple search queries for better coverage
    const searchQueries = [
        `"${companyName}" owner`,
        `"${companyName}" CEO`,
        `"${companyName}" founder`,
        `"${companyName}" president contact`
    ];

    let allSnippets = [];

    // Execute searches in parallel
    const searchPromises = searchQueries.map(async query => {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_CSE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=3`;
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.json();
                return (data.items || []).map(item => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                }));
            }
        } catch (e) {
            console.error(`[GoogleSearch] Query "${query}" failed:`, e);
        }
        return [];
    });

    const searchResults = await Promise.all(searchPromises);
    allSnippets = searchResults.flat();

    if (allSnippets.length === 0) {
        return { contacts: [] };
    }

    console.log(`[GoogleSearch] Got ${allSnippets.length} search results, extracting contacts with Claude`);

    // Use Claude to extract contact info from search snippets
    const snippetsText = allSnippets.map((s, i) =>
        `Result ${i + 1}: ${s.title}\n${s.snippet}\nURL: ${s.link}`
    ).join('\n\n---\n\n');

    const prompt = `You are extracting contact information for ${companyName} from Google search results.

Find the owner, CEO, founder, or president of ${companyName}. Extract:
- Full name
- Job title
- Email address (if found in snippets)
- Phone number (if found in snippets)
- LinkedIn URL (ONLY if an actual linkedin.com URL appears in the snippets - DO NOT GUESS)

IMPORTANT RULES:
- Only extract REAL people with actual names
- Focus on: Owner, CEO, Founder, President (not managers or staff)
- If email/phone is mentioned in the snippets, include it
- Be accurate - if you're not confident, don't include it
- Return up to 2 contacts maximum (top executives only)
- NEVER invent or guess LinkedIn URLs - only include if you see an actual linkedin.com URL

Google search results:
${snippetsText}

Return a JSON array in this exact format:
[
  {
    "name": "John Smith",
    "title": "Owner & CEO",
    "email": "john@company.com",
    "phone": "+1-555-123-4567",
    "linkedin": null
  }
]

If you find NO clear decision-makers or named contacts, return an empty array: []`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        })
    });

    if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content[0].text;

    // Parse JSON response
    let contacts = [];
    try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            contacts = JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error('[GoogleSearch] Failed to parse Claude response:', e);
        console.log('[GoogleSearch] Raw response:', responseText);
    }

    return { contacts };
}

/**
 * Search for company contacts via LinkedIn using Google site search
 * Searches for both company name and brand name to maximize results
 * @param {string} companyName - Company name
 * @param {string} brandName - Brand name (may be same as company or different)
 * @param {object} env - Worker environment
 */
async function linkedInSearchForContacts(companyName, brandName, env) {
    if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID || !env.ANTHROPIC_API_KEY) {
        throw new Error('Google CSE or Anthropic API keys not configured');
    }

    console.log(`[LinkedIn] Searching for ${companyName}${brandName && brandName !== companyName ? ` / ${brandName}` : ''}`);

    // Build search queries for both company and brand
    const searchQueries = [
        `site:linkedin.com "${companyName}" owner OR founder OR CEO`,
        `site:linkedin.com "${companyName}" president OR director`
    ];

    // Add brand-specific searches if brand is different from company
    if (brandName && brandName !== companyName && brandName !== 'Unknown') {
        searchQueries.push(`site:linkedin.com "${brandName}" owner OR founder OR CEO`);
        searchQueries.push(`site:linkedin.com "${brandName}" winemaker OR distiller OR brewmaster`);
    }

    let allSnippets = [];

    // Execute searches in parallel
    const searchPromises = searchQueries.map(async query => {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_CSE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=5`;
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.json();
                return (data.items || []).map(item => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                }));
            }
        } catch (e) {
            console.error(`[LinkedIn] Query "${query}" failed:`, e);
        }
        return [];
    });

    const searchResults = await Promise.all(searchPromises);
    allSnippets = searchResults.flat();

    // Dedupe by URL
    const seenUrls = new Set();
    allSnippets = allSnippets.filter(s => {
        if (seenUrls.has(s.link)) return false;
        seenUrls.add(s.link);
        return true;
    });

    if (allSnippets.length === 0) {
        console.log('[LinkedIn] No results found');
        return { contacts: [] };
    }

    console.log(`[LinkedIn] Got ${allSnippets.length} unique results, extracting contacts with Claude`);

    // Use Claude to extract contact info from LinkedIn search snippets
    const snippetsText = allSnippets.map((s, i) =>
        `Result ${i + 1}: ${s.title}\n${s.snippet}\nURL: ${s.link}`
    ).join('\n\n---\n\n');

    const prompt = `You are extracting contact information for "${companyName}"${brandName && brandName !== companyName ? ` (brand: "${brandName}")` : ''} from LinkedIn search results via Google.

The Google search results show LinkedIn profile titles and snippets. Extract decision-makers who work at or own this company.

IMPORTANT RULES:
- Only extract people who CLEARLY work at or own "${companyName}" or "${brandName}"
- Look for titles like: Owner, Founder, CEO, President, Winemaker, Distiller, Brewmaster, Director
- The LinkedIn URL in the results IS the person's real LinkedIn profile - include it
- Do NOT include people who just happen to have similar names but work elsewhere
- If the snippet mentions the company/brand name in connection with the person, that's a good sign
- Return up to 3 contacts maximum
- CRITICAL: email and phone should ALWAYS be null - LinkedIn does not show emails. NEVER make up or guess emails.

Google search results (from site:linkedin.com):
${snippetsText}

Return a JSON array in this exact format:
[
  {
    "name": "John Smith",
    "title": "Owner & Founder",
    "email": null,
    "phone": null,
    "linkedin": "https://www.linkedin.com/in/johnsmith"
  }
]

If you find NO clear decision-makers for this specific company, return an empty array: []`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        })
    });

    if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content[0].text;

    // Parse JSON response
    let contacts = [];
    try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            contacts = JSON.parse(jsonMatch[0]);
            // Post-process: remove any fake/hallucinated emails (LinkedIn doesn't provide emails)
            contacts = contacts.map(c => ({
                ...c,
                email: null,  // Force null - LinkedIn search never has real emails
                phone: null   // Force null - LinkedIn search never has real phones
            }));
        }
    } catch (e) {
        console.error('[LinkedIn] Failed to parse Claude response:', e);
        console.log('[LinkedIn] Raw response:', responseText);
    }

    console.log(`[LinkedIn] Extracted ${contacts.length} contacts`);
    return { contacts };
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
         distribution_states, brand_portfolio, category_breakdown, summary, news, social_links, contacts, enhanced_at, enhanced_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(tearsheet.contacts || []),
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

