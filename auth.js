/* ============================================
   BevAlc Intelligence - Auth / Email Gate
   Works with Loops for email capture
   ============================================ */

// Configuration
const CONFIG = {
    COOKIE_NAME: 'bevalc_access',
    COOKIE_DAYS: 365,
    DATABASE_URL: 'app.html',
    LANDING_URL: 'index.html'
};

// Check if user has access
function hasAccess() {
    return getCookie(CONFIG.COOKIE_NAME) === 'granted';
}

// Get cookie value
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Set cookie
function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax`;
}

// Grant access (called when user arrives from Loops welcome email)
function grantAccess() {
    setCookie(CONFIG.COOKIE_NAME, 'granted', CONFIG.COOKIE_DAYS);
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Check URL for access grant parameter
    // When user clicks link in welcome email: app.html?access=granted
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.get('access') === 'granted') {
        // Grant access and clean up URL
        grantAccess();
        
        // Remove the parameter from URL (cleaner)
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // If on app.html without access, redirect to landing page
    if (window.location.pathname.includes('app.html') && !hasAccess()) {
        window.location.href = CONFIG.LANDING_URL;
    }
});

// Export for use in other scripts
window.BevAlcAuth = {
    hasAccess,
    getCookie,
    setCookie,
    grantAccess
};
