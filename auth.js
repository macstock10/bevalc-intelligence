/**
 * BevAlc Intelligence - Auth
 * Handles access control via cookies and URL parameters
 */

const BevAlcAuth = {
    COOKIE_NAME: 'bevalc_access',
    COOKIE_DAYS: 365,

    hasAccess() {
        return this.getCookie(this.COOKIE_NAME) === 'granted';
    },

    grantAccess() {
        this.setCookie(this.COOKIE_NAME, 'granted', this.COOKIE_DAYS);
    },

    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    },

    setCookie(name, value, days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
    },

    getUser() {
        try {
            return JSON.parse(localStorage.getItem('bevalc_user') || '{}');
        } catch (e) {
            return {};
        }
    },

    init() {
        // Check for access grant in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('access') === 'granted') {
            this.grantAccess();
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};

// Initialize on load
BevAlcAuth.init();

// Export for use
window.BevAlcAuth = BevAlcAuth;
