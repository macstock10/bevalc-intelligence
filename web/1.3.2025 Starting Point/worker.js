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
            }
            // Database endpoints
            else if (path === '/api/search') {
                response = await handleSearch(url, env);
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
            
            if (customerEmail) {
                console.log(`Pro subscription activated for: ${customerEmail}`);
            }
            break;
        }
        
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            console.log(`Subscription ${event.type}: ${subscription.id}`);
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
    
    return {
        success: true,
        status: session.status === 'complete' ? 'complete' : session.status,
        customer_email: session.customer_email || session.customer_details?.email,
        payment_status: session.payment_status,
        subscription_id: session.subscription
    };
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
    
    if (category && category !== 'Other') {
        const categoryPatterns = {
            'Whiskey': ['%WHISK%', '%BOURBON%', '%SCOTCH%', '%RYE%'],
            'Vodka': ['%VODKA%'],
            'Tequila': ['%TEQUILA%', '%MEZCAL%', '%AGAVE%'],
            'Rum': ['%RUM%', '%CACHACA%'],
            'Gin': ['%GIN%'],
            'Brandy': ['%BRANDY%', '%COGNAC%', '%ARMAGNAC%', '%GRAPPA%', '%PISCO%'],
            'Wine': ['%WINE%', '%CHAMPAGNE%', '%PORT%', '%SHERRY%', '%VERMOUTH%', '%SAKE%', '%CIDER%', '%MEAD%'],
            'Beer': ['%BEER%', '%ALE%', '%MALT%', '%STOUT%', '%PORTER%'],
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

    const countQuery = `SELECT COUNT(*) as total FROM colas WHERE ${whereClause}`;
    const countResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
    const total = countResult?.total || 0;

    let orderByClause;
    if (safeSortColumn === 'approval_date') {
        orderByClause = `ORDER BY year ${sortOrder}, month ${sortOrder}, id ${sortOrder}`;
    } else {
        orderByClause = `ORDER BY ${safeSortColumn} ${sortOrder}`;
    }

    const dataQuery = `
        SELECT 
            ttb_id, status, brand_name, fanciful_name, 
            class_type_code, origin_code, approval_date
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
