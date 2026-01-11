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

async function handleExport(url, env) {
    const params = url.searchParams;

    // Verify Pro status
    const email = params.get('email');
    if (!email) {
        return { success: false, error: 'Email required for export' };
    }

    // Check if user is Pro and get tier info
    let userTier = null;
    let userTierCategory = null;

    try {
        let user = await env.DB.prepare(
            'SELECT is_pro, tier, tier_category FROM user_preferences WHERE email = ?'
        ).bind(email.toLowerCase()).first();

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
        orderByClause = `ORDER BY year ${sortOrder}, month ${sortOrder}, id ${sortOrder}`;
    } else {
        orderByClause = `ORDER BY ${safeSortColumn} ${sortOrder}`;
    }

    // Export query - all fields from detail card
    const dataQuery = `
        SELECT 
            ttb_id, brand_name, fanciful_name, status, approval_date,
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
