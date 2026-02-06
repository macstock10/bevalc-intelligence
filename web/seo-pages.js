/* SEO Pages — shared JS for company, brand, hub, category/year pages */

// Mobile menu toggle
(function() {
    var menuBtn = document.getElementById('mobile-menu-btn');
    var mobileMenu = document.getElementById('mobile-menu');
    if (menuBtn && mobileMenu) {
        menuBtn.addEventListener('click', function() {
            mobileMenu.classList.toggle('active');
        });
    }
})();

// Dropdown toggle
function toggleDropdown(id) {
    var dropdown = document.getElementById(id);
    var isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.nav-dropdown').forEach(function(d) { d.classList.remove('open'); });
    if (!isOpen) dropdown.classList.add('open');
}
document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-dropdown')) {
        document.querySelectorAll('.nav-dropdown').forEach(function(d) { d.classList.remove('open'); });
    }
});

// Unified Pro status check — handles both layout elements and hub-specific elements
(function() {
    // Unlock all gated content (layout + hub elements)
    function unlockContent() {
        // Layout elements
        document.querySelectorAll('.seo-blur').forEach(function(el) { el.classList.remove('seo-blur'); });
        document.querySelectorAll('.pro-overlay').forEach(function(el) { el.style.display = 'none'; });
        document.querySelectorAll('.pro-locked').forEach(function(el) { el.classList.remove('pro-locked'); });
        document.querySelectorAll('.page-paywall').forEach(function(el) { el.classList.remove('page-paywall'); });
        document.querySelectorAll('.gate-overlay').forEach(function(el) { el.style.display = 'none'; });
        document.querySelectorAll('.gated-table').forEach(function(el) { el.classList.remove('gated-table'); });
        // Signal badges — shared by layout and hub
        document.querySelectorAll('.signal-gated').forEach(function(el) { el.classList.add('signal-unlocked'); });
        // Hub-specific elements (no-op on non-hub pages)
        var exportBtn = document.getElementById('export-csv-btn');
        if (exportBtn) {
            exportBtn.classList.remove('locked');
            var proTag = document.getElementById('export-pro-tag');
            if (proTag) proTag.style.display = 'none';
        }
        var banner = document.getElementById('upgrade-banner');
        if (banner) banner.classList.add('hidden');
    }

    // When Pro is detected without a cookie, hub pages need a reload for fresh server data
    function handleProDetected() {
        document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
        if (document.querySelector('.hub-page')) {
            window.location.reload();
        } else {
            unlockContent();
        }
    }

    try {
        var urlParams = new URLSearchParams(window.location.search);

        // Allow granting/revoking Pro access for testing
        if (urlParams.get('pro') === 'grant') {
            document.cookie = 'bevalc_pro=1; path=/; max-age=31536000; SameSite=Lax';
            unlockContent();
            return;
        }
        if (urlParams.get('pro') === 'revoke') {
            document.cookie = 'bevalc_pro=; path=/; max-age=0';
            var user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');
            delete user.isPro;
            delete user.is_pro;
            localStorage.setItem('bevalc_user', JSON.stringify(user));
            return;
        }

        // Check Pro cookie (fastest — server already served correct data)
        if (document.cookie.includes('bevalc_pro=1')) {
            unlockContent();
            return;
        }

        var user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');

        // Immediate check from localStorage
        if (user.isPro || user.is_pro) {
            handleProDetected();
            return;
        }

        // If user has email but no Pro flag, verify with API
        if (user.email) {
            fetch('https://bevalc-api.mac-rowan.workers.dev/api/stripe/customer-status?email=' + encodeURIComponent(user.email))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if ((data.success && data.status === 'pro') || data.is_pro) {
                        user.isPro = true;
                        user.is_pro = true;
                        localStorage.setItem('bevalc_user', JSON.stringify(user));
                        handleProDetected();
                    }
                })
                .catch(function() {});
        }
    } catch(e) { console.error('Pro check error:', e); }
})();
