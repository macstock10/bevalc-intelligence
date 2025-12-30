/* ============================================
   BevAlc Intelligence - Auth / Email Gate
   ============================================ */

// Configuration
const CONFIG = {
    // Google Apps Script URL for storing emails (you'll set this up)
    GOOGLE_SCRIPT_URL: '', // Leave empty for now - we'll set up later
    
    // Cookie settings
    COOKIE_NAME: 'bevalc_access',
    COOKIE_DAYS: 365,
    
    // Redirect after signup
    DATABASE_URL: 'app.html'
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

// Store user data locally (backup if Google Sheets fails)
function storeLocally(data) {
    try {
        const existing = JSON.parse(localStorage.getItem('bevalc_signups') || '[]');
        existing.push({
            ...data,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem('bevalc_signups', JSON.stringify(existing));
    } catch (e) {
        console.error('Failed to store locally:', e);
    }
}

// Submit to Google Sheets (optional - set up later)
async function submitToGoogleSheets(data) {
    if (!CONFIG.GOOGLE_SCRIPT_URL) {
        console.log('Google Sheets not configured, storing locally only');
        return true;
    }
    
    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        return true;
    } catch (error) {
        console.error('Failed to submit to Google Sheets:', error);
        return false;
    }
}

// Handle form submission
async function handleSignup(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    // Get form data
    const data = {
        name: form.querySelector('#name').value.trim(),
        email: form.querySelector('#email').value.trim(),
        company: form.querySelector('#company')?.value.trim() || '',
        source: window.location.href,
        userAgent: navigator.userAgent
    };
    
    // Validate
    if (!data.name || !data.email) {
        alert('Please fill in all required fields.');
        return;
    }
    
    // Show loading state
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline-flex';
    submitBtn.disabled = true;
    
    try {
        // Store locally first (always works)
        storeLocally(data);
        
        // Try to submit to Google Sheets
        await submitToGoogleSheets(data);
        
        // Grant access
        setCookie(CONFIG.COOKIE_NAME, 'granted', CONFIG.COOKIE_DAYS);
        
        // Store user info for personalization
        localStorage.setItem('bevalc_user', JSON.stringify({
            name: data.name,
            email: data.email,
            company: data.company
        }));
        
        // Redirect to database
        window.location.href = CONFIG.DATABASE_URL;
        
    } catch (error) {
        console.error('Signup error:', error);
        alert('Something went wrong. Please try again.');
        
        // Reset button
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Check if already has access and on landing page
    if (hasAccess() && window.location.pathname.endsWith('index.html') || 
        hasAccess() && window.location.pathname === '/') {
        // Optionally auto-redirect to app
        // window.location.href = CONFIG.DATABASE_URL;
    }
    
    // Attach form handler
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }
});

// Export for use in other scripts
window.BevAlcAuth = {
    hasAccess,
    getCookie,
    setCookie
};
