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
        orderByClause = `ORDER BY approval_date ${sortOrder}, id ${sortOrder}`;
    } else {
        orderByClause = `ORDER BY ${safeSortColumn} ${sortOrder}`;
    }

    const dataQuery = `
        SELECT
            ttb_id, status, brand_name, fanciful_name,
            class_type_code, origin_code, approval_date, signal
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

    // Get total count for info
    const countQuery = `SELECT COUNT(*) as total FROM colas WHERE ${whereClause}`;
    const countResult = await env.DB.prepare(countQuery).bind(...queryParams).first();
    const total = countResult?.total || 0;

    let orderByClause;
    if (safeSortColumn === 'approval_date') {
        orderByClause = `ORDER BY approval_date ${sortOrder}, id ${sortOrder}`;
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
        .seo-page { padding-top: 100px; max-width: 1200px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
        .seo-header { margin-bottom: 32px; }
        .seo-header h1 { font-family: var(--font-display); font-size: 2.5rem; margin-bottom: 8px; }
        .seo-header .meta { color: var(--color-text-secondary); font-size: 1.1rem; }
        .seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin-bottom: 32px; }
        .seo-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 24px; }
        .seo-card h2 { font-size: 1rem; color: var(--color-text-secondary); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
        .stat-value { font-size: 2rem; font-weight: 700; color: var(--color-text); }
        .stat-label { font-size: 0.875rem; color: var(--color-text-secondary); }
        .brand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .brand-chip { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; transition: border-color var(--transition-fast); }
        .brand-chip:hover { border-color: var(--color-primary); }
        .brand-chip a { color: var(--color-text); font-weight: 500; }
        .brand-chip .count { color: var(--color-text-tertiary); font-size: 0.875rem; }
        .filings-table { width: 100%; border-collapse: collapse; }
        .filings-table th, .filings-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--color-border); }
        .filings-table th { background: var(--color-bg-secondary); font-weight: 600; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .filings-table tr:hover { background: var(--color-bg-secondary); }
        .signal-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .signal-NEW_BRAND { background: #dcfce7; color: #166534; }
        .signal-NEW_SKU { background: #dbeafe; color: #1e40af; }
        .signal-REFILE { background: #f3f4f6; color: #6b7280; }
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
    </style>
</head>
<body>
    <nav class="nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">BevAlc Intelligence</a>
            <div class="nav-links">
                <a href="/database.html">Database</a>
                <a href="/#pricing">Pricing</a>
            </div>
        </div>
    </nav>
    <main class="seo-page">
        ${content}
    </main>
    <footer style="padding: 48px 24px; text-align: center; color: var(--color-text-secondary); border-top: 1px solid var(--color-border); margin-top: 64px;">
        <p>&copy; ${new Date().getFullYear()} BevAlc Intelligence. TTB COLA data updated weekly.</p>
        <p style="margin-top: 8px;"><a href="/database.html">Search Database</a> · <a href="/#pricing">Pricing</a></p>
    </footer>
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
        SELECT * FROM companies WHERE slug = ? AND total_filings >= 3
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
                AND c.total_filings >= 3
                LIMIT 1
            `).bind(pattern).first();
            company = aliasResult;
        }
    }

    if (!company) {
        return new Response('Company not found', { status: 404 });
    }

    // Get top brands for this company
    const brandsResult = await env.DB.prepare(`
        SELECT brand_name, COUNT(*) as cnt
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        WHERE ca.company_id = ?
        GROUP BY brand_name
        ORDER BY cnt DESC
        LIMIT 20
    `).bind(company.id).all();
    const brands = brandsResult.results || [];

    // Get category breakdown
    const categoriesResult = await env.DB.prepare(`
        SELECT class_type_code, COUNT(*) as cnt
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        WHERE ca.company_id = ?
        GROUP BY class_type_code
        ORDER BY cnt DESC
        LIMIT 10
    `).bind(company.id).all();
    const categories = categoriesResult.results || [];

    // Get recent filings
    const recentResult = await env.DB.prepare(`
        SELECT ttb_id, brand_name, fanciful_name, class_type_code, approval_date, signal
        FROM colas co
        JOIN company_aliases ca ON co.company_name = ca.raw_name
        WHERE ca.company_id = ?
        ORDER BY approval_date DESC
        LIMIT 10
    `).bind(company.id).all();
    const recentFilings = recentResult.results || [];

    // Get related companies (same top category)
    const topCategory = categories[0]?.class_type_code;
    let relatedCompanies = [];
    if (topCategory) {
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
            <p class="meta">${formatNumber(brands.length)}+ Brands · ${formatNumber(company.total_filings)} Total Filings · Since ${escapeHtml(company.first_filing || 'N/A')}</p>
        </header>

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
            <table class="filings-table">
                <thead>
                    <tr>
                        <th>Brand</th>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th>Signal</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentFilings.map(f => `
                        <tr>
                            <td><a href="/brand/${makeSlug(f.brand_name)}">${escapeHtml(f.brand_name)}</a></td>
                            <td>${escapeHtml(f.fanciful_name || '-')}</td>
                            <td>${escapeHtml(getCategory(f.class_type_code))}</td>
                            <td>${escapeHtml(f.approval_date)}</td>
                            <td>${f.signal ? `<span class="signal-badge signal-${f.signal}">${f.signal.replace('_', ' ')}</span>` : ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="margin-top: 16px; text-align: center;"><a href="/database.html?q=${encodeURIComponent(company.canonical_name)}">View all filings →</a></p>
        </div>

        <div class="related-links">
            <h3>Related Companies</h3>
            ${relatedCompanies.map(c => `<a href="/company/${c.slug}">${escapeHtml(c.canonical_name)}</a>`).join('')}
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/company/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
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
    const productsResult = await env.DB.prepare(`
        SELECT ttb_id, fanciful_name, class_type_code, approval_date, signal
        FROM colas WHERE brand_name = ?
        ORDER BY approval_date DESC
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
                            <td>${p.signal ? `<span class="signal-badge signal-${p.signal}">${p.signal.replace('_', ' ')}</span>` : ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="margin-top: 16px; text-align: center;"><a href="/database.html?q=${encodeURIComponent(brand.brand_name)}">View all products →</a></p>
        </div>

        <div class="related-links">
            <h3>More ${primaryCategory} Brands</h3>
            ${relatedBrands.map(b => `<a href="/brand/${makeSlug(b.brand_name)}">${escapeHtml(b.brand_name)}</a>`).join('')}
        </div>
    `;

    return new Response(getPageLayout(title, description, content, jsonLd, `${BASE_URL}/brand/${slug}`), {
        headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
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
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
            ...corsHeaders
        }
    });
}

// Sitemap Handler - uses brand_slugs table for fast lookups
async function handleSitemap(path, env) {
    // Cache headers for all sitemaps (24h edge, 1h browser)
    const cacheHeaders = {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
    };

    // Sitemap index - lists all child sitemaps
    if (path === '/sitemap.xml') {
        // Count brands from brand_slugs table (fast - indexed)
        const brandCountResult = await env.DB.prepare(`
            SELECT COUNT(*) as cnt FROM brand_slugs
        `).first();
        const brandCount = brandCountResult?.cnt || 0;
        const brandSitemapCount = Math.ceil(brandCount / 45000); // Use 45k to stay safely under 50k

        const sitemaps = [
            `${BASE_URL}/sitemap-static.xml`,
            `${BASE_URL}/sitemap-companies.xml`
        ];
        for (let i = 1; i <= brandSitemapCount; i++) {
            sitemaps.push(`${BASE_URL}/sitemap-brands-${i}.xml`);
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map(s => `  <sitemap>
    <loc>${s}</loc>
  </sitemap>`).join('\n')}
</sitemapindex>`;

        return new Response(xml, { headers: cacheHeaders });
    }

    // Static pages + categories sitemap
    if (path === '/sitemap-static.xml') {
        const urls = [];
        urls.push({ loc: BASE_URL, priority: '1.0' });
        urls.push({ loc: `${BASE_URL}/database.html`, priority: '0.9' });

        const categories = ['whiskey', 'vodka', 'tequila', 'rum', 'gin', 'brandy', 'wine', 'beer', 'liqueur', 'cocktails'];
        const years = [2026, 2025, 2024, 2023, 2022, 2021];
        for (const cat of categories) {
            for (const year of years) {
                urls.push({ loc: `${BASE_URL}/category/${cat}/${year}`, priority: '0.8' });
            }
        }

        return new Response(generateUrlsetXml(urls), { headers: cacheHeaders });
    }

    // Companies sitemap - uses companies table with slug column
    if (path === '/sitemap-companies.xml') {
        const companiesResult = await env.DB.prepare(`
            SELECT slug FROM companies WHERE total_filings >= 3 ORDER BY total_filings DESC
        `).all();

        const urls = (companiesResult.results || []).map(c => ({
            loc: `${BASE_URL}/company/${c.slug}`,
            priority: '0.7'
        }));

        return new Response(generateUrlsetXml(urls), { headers: cacheHeaders });
    }

    // Brand sitemaps (paginated) - uses brand_slugs table for fast lookup
    const brandMatch = path.match(/^\/sitemap-brands-(\d+)\.xml$/);
    if (brandMatch) {
        const page = parseInt(brandMatch[1], 10);
        const pageSize = 45000;
        const offset = (page - 1) * pageSize;

        // Use brand_slugs table - O(1) indexed lookup, no GROUP BY needed
        const brandsResult = await env.DB.prepare(`
            SELECT slug FROM brand_slugs
            ORDER BY filing_count DESC
            LIMIT ? OFFSET ?
        `).bind(pageSize, offset).all();

        const urls = (brandsResult.results || []).map(b => ({
            loc: `${BASE_URL}/brand/${b.slug}`,
            priority: '0.6'
        }));

        return new Response(generateUrlsetXml(urls), { headers: cacheHeaders });
    }

    // 404 for unknown sitemap paths
    return new Response('Not found', { status: 404 });
}

function generateUrlsetXml(urls) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
}
