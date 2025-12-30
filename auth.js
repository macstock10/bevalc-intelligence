/* BevAlc Intelligence - Auth */

const CONFIG = {
    COOKIE_NAME: 'bevalc_access',
    COOKIE_DAYS: 365,
    DATABASE_URL: 'app.html'
};

function hasAccess() {
    return getCookie(CONFIG.COOKIE_NAME) === 'granted';
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}

function storeLocally(data) {
    try {
        const existing = JSON.parse(localStorage.getItem('bevalc_signups') || '[]');
        existing.push({ ...data, timestamp: new Date().toISOString() });
        localStorage.setItem('bevalc_signups', JSON.stringify(existing));
    } catch (e) {
        console.error('Failed to store locally:', e);
    }
}

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem('bevalc_user') || 'null');
    } catch (e) {
        return null;
    }
}

async function handleSignup(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    const data = {
        name: form.querySelector('#name').value.trim(),
        email: form.querySelector('#email').value.trim(),
        company: form.querySelector('#company')?.value.trim() || '',
        source: window.location.href
    };
    
    if (!data.name || !data.email) {
        alert('Please fill in all required fields.');
        return;
    }
    
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline-flex';
    submitBtn.disabled = true;
    
    try {
        storeLocally(data);
        setCookie(CONFIG.COOKIE_NAME, 'granted', CONFIG.COOKIE_DAYS);
        localStorage.setItem('bevalc_user', JSON.stringify({
            name: data.name,
            email: data.email,
            company: data.company
        }));
        window.location.href = CONFIG.DATABASE_URL;
    } catch (error) {
        console.error('Signup error:', error);
        alert('Something went wrong. Please try again.');
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

function handleQuickLogin() {
    setCookie(CONFIG.COOKIE_NAME, 'granted', CONFIG.COOKIE_DAYS);
    window.location.href = CONFIG.DATABASE_URL;
}

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signup-form');
    const quickLogin = document.getElementById('quick-login');
    const quickLoginBtn = document.getElementById('quick-login-btn');
    const quickLoginName = document.getElementById('quick-login-name');
    
    // Check for returning user
    const storedUser = getStoredUser();
    if (storedUser && storedUser.name) {
        if (quickLogin) {
            quickLogin.style.display = 'block';
            quickLoginName.textContent = storedUser.name;
        }
    }
    
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }
    
    if (quickLoginBtn) {
        quickLoginBtn.addEventListener('click', handleQuickLogin);
    }
});

window.BevAlcAuth = { hasAccess, getCookie, setCookie, getStoredUser };
