/**
 * BevAlc Intelligence - Database Page
 * Handles search, filters, pagination, and data display
 *
 * Note: TTB_CATEGORIES, CODE_LOOKUP, getCategory(), getSubcategories(),
 * getCodesForSubcategory() are loaded from ttb-categories.js
 */

// Configuration
const API_BASE = 'https://bevalc-api.mac-rowan.workers.dev';
const ITEMS_PER_PAGE = 20;

// Categories list for dropdown (matches TTB_CATEGORIES keys)
const CATEGORIES = Object.keys(TTB_CATEGORIES);

// Get just the category name from a TTB code (for backwards compatibility)
function getCategoryName(classTypeCode) {
    return getCategory(classTypeCode).category;
}

// State
const state = {
    currentPage: 1,
    totalPages: 0,
    totalRecords: 0,
    isLoading: false,
    hasAccess: false,
    sortColumn: 'approval_date',
    sortDirection: 'desc',
    filters: {
        origins: [],
        class_types: [],
        statuses: []
    },
    currentResults: []  // Store current page results for CSV export
};

// DOM Elements
const elements = {};

function getUserToken() {
    try {
        const stored = localStorage.getItem('bevalc_user');
        if (stored) {
            const user = JSON.parse(stored);
            if (user && user.token) return user.token;
        }
    } catch (e) {}
    return localStorage.getItem('bevalc_prefs_token') || '';
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
    cacheElements();
    checkAccess();
    setupEventListeners();

    // Apply URL parameters to filters before loading
    applyUrlFilters();

    // Run all async initialization tasks in parallel for faster loading
    await Promise.all([
        loadFilters(),
        performSearch(),
        checkUrlModal()
    ]);

    // Setup saved searches for Pro users
    setupSavedSearches();

    // Setup search history
    setupSearchHistory();
});

// Read URL parameters and apply to filter elements
function applyUrlFilters() {
    const urlParams = new URLSearchParams(window.location.search);

    // Search query
    const q = urlParams.get('q');
    if (q && elements.searchInput) {
        elements.searchInput.value = q;
    }

    // Category filter
    const category = urlParams.get('category');
    if (category && elements.filterCategory) {
        elements.filterCategory.value = category;
        updateSubcategoryDropdown();
    }

    // Origin filter
    const origin = urlParams.get('origin');
    if (origin && elements.filterOrigin) {
        elements.filterOrigin.value = origin;
    }

    // Status filter
    const status = urlParams.get('status');
    if (status && elements.filterStatus) {
        elements.filterStatus.value = status;
    }

    // Date range filters
    const dateFrom = urlParams.get('date_from');
    if (dateFrom && elements.filterDateFrom) {
        elements.filterDateFrom.value = dateFrom;
    }

    const dateTo = urlParams.get('date_to');
    if (dateTo && elements.filterDateTo) {
        elements.filterDateTo.value = dateTo;
    }

    // Signal filter (stored in state for API call, and populate dropdown if Pro)
    const signal = urlParams.get('signal');
    if (signal) {
        state.signalFilter = signal;
        // If dropdown exists (Pro user), set its value
        if (elements.filterSignal) {
            elements.filterSignal.value = signal;
        }
    }
}

// Check for ttb parameter in URL and open modal if found
async function checkUrlModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const ttbId = urlParams.get('ttb');

    if (ttbId) {
        try {
            // Fetch the full record by TTB ID using /api/record endpoint
            const response = await fetch(`${API_BASE}/api/record?id=${encodeURIComponent(ttbId)}`);
            const data = await response.json();

            if (data.success && data.data) {
                openModal(data.data);
            }
        } catch (e) {
            console.error('Error loading modal from URL:', e);
        }
    }
}

function cacheElements() {
    elements.searchInput = document.getElementById('search-input');
    elements.searchBtn = document.getElementById('search-btn');
    elements.filterOrigin = document.getElementById('filter-origin');
    elements.filterCategory = document.getElementById('filter-category');
    elements.filterClass = document.getElementById('filter-class');
    elements.filterStatus = document.getElementById('filter-status');
    elements.filterSignal = document.getElementById('filter-signal');
    elements.signalFilterGroup = document.getElementById('signal-filter-group');
    elements.filterDateFrom = document.getElementById('filter-date-from');
    elements.filterDateTo = document.getElementById('filter-date-to');
    elements.clearFilters = document.getElementById('clear-filters');
    elements.resultsCount = document.getElementById('results-count');
    elements.resultsBody = document.getElementById('results-body');
    elements.pagination = document.getElementById('pagination');
    elements.totalRecords = document.getElementById('total-records');
    elements.blurOverlay = document.getElementById('blur-overlay');
    elements.loadingOverlay = document.getElementById('loading-overlay');
    elements.modalOverlay = document.getElementById('modal-overlay');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalSubtitle = document.getElementById('modal-subtitle');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalClose = document.getElementById('modal-close');
    elements.userGreeting = document.getElementById('user-greeting');
    elements.navSignup = document.getElementById('nav-signup');
    elements.blurRecordCount = document.getElementById('blur-record-count');
    // Saved searches elements
    elements.savedSearchesWrapper = document.getElementById('saved-searches-wrapper');
    elements.savedSearchesBtn = document.getElementById('saved-searches-btn');
    elements.savedSearchesMenu = document.getElementById('saved-searches-menu');
    elements.savedSearchesList = document.getElementById('saved-searches-list');
    elements.saveCurrentSearch = document.getElementById('save-current-search');
    elements.saveSearchModal = document.getElementById('save-search-modal');
    elements.saveSearchName = document.getElementById('save-search-name');
    elements.saveSearchCancel = document.getElementById('save-search-cancel');
    elements.saveSearchConfirm = document.getElementById('save-search-confirm');
}

function checkAccess() {
    const hasAccessCookie = document.cookie.includes('bevalc_access=granted');
    const urlParams = new URLSearchParams(window.location.search);
    const accessParam = urlParams.get('access') === 'granted';
    const userInfo = localStorage.getItem('bevalc_user');
    
    if (accessParam) {
        document.cookie = 'bevalc_access=granted; path=/; max-age=31536000; SameSite=Lax';
        window.history.replaceState({}, document.title, window.location.pathname);
        state.hasAccess = true;
    } else if (hasAccessCookie) {
        state.hasAccess = true;
    }
    
    // Initialize CSV button as locked by default
    updateCSVButtonState(false);
    
    if (state.hasAccess) {
        if (elements.blurOverlay) elements.blurOverlay.style.display = 'none';
        if (elements.navSignup) elements.navSignup.style.display = 'none';
        
        if (userInfo && elements.userGreeting) {
            try {
                const user = JSON.parse(userInfo);
                if (user.firstName) {
                    elements.userGreeting.textContent = `Hi, ${user.firstName}`;
                    elements.userGreeting.style.display = 'inline';
                }
                
                // Set initial button state from localStorage
                if (user.isPro === true) {
                    updateCSVButtonState(true);
                }
                
                // Check if Pro and add Account link
                if (user.email) {
                    checkProStatus(user.email);
                }
            } catch (e) {}
        }
    } else {
        if (elements.blurOverlay) elements.blurOverlay.style.display = 'flex';
    }
}

async function checkProStatus(email) {
    try {
        const response = await fetch(`${API_BASE}/api/stripe/customer-status?email=${encodeURIComponent(email)}`);
        const data = await response.json();

        // Update isPro status in localStorage
        const userInfo = localStorage.getItem('bevalc_user');
        if (userInfo) {
            try {
                const user = JSON.parse(userInfo);
                user.isPro = data.success && data.status === 'pro';
                localStorage.setItem('bevalc_user', JSON.stringify(user));
            } catch (e) {}
        }

        if (data.success && data.status === 'pro') {
            // Unlock CSV export button for Pro users
            updateCSVButtonState(true);

            // Show signal filter for Pro users
            if (elements.signalFilterGroup) {
                elements.signalFilterGroup.style.display = 'flex';
            }

            // Fetch tier info from preferences API
            try {
                const prefsResponse = await fetch(`${API_BASE}/api/user/preferences?email=${encodeURIComponent(email)}`);
                const prefsData = await prefsResponse.json();
                if (prefsData.success) {
                    const userInfo = localStorage.getItem('bevalc_user');
                    if (userInfo) {
                        const user = JSON.parse(userInfo);
                        user.tier = prefsData.tier || 'pro';
                        localStorage.setItem('bevalc_user', JSON.stringify(user));

                        // Update mobile badge with Pro
                        const mobileBadge = document.getElementById('user-status-mobile');
                        if (mobileBadge) {
                            mobileBadge.textContent = 'Pro';
                            mobileBadge.style.display = 'inline-flex';
                            mobileBadge.classList.add('pro');
                        }
                    }
                }
            } catch (e) {
                console.log('Could not fetch tier info');
            }
        } else {
            // Lock CSV export button for non-Pro users
            updateCSVButtonState(false);
            // Hide signal filter for non-Pro users
            if (elements.signalFilterGroup) {
                elements.signalFilterGroup.style.display = 'none';
            }
        }
    } catch (e) {
        console.log('Could not check Pro status');
        updateCSVButtonState(false);
    }
}

function updateCSVButtonState(isPro) {
    const csvBtn = document.getElementById('csv-export-btn');
    if (csvBtn) {
        if (isPro) {
            csvBtn.classList.remove('locked');
        } else {
            csvBtn.classList.add('locked');
        }
    }
}

function setupEventListeners() {
    // Search
    elements.searchBtn.addEventListener('click', () => {
        state.currentPage = 1;
        performSearch();
    });
    
    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            state.currentPage = 1;
            performSearch();
        }
    });
    
    // Category filter - updates subcategory dropdown
    elements.filterCategory.addEventListener('change', () => {
        updateSubcategoryDropdown();
        state.currentPage = 1;
        performSearch();
    });
    
    // Other filters
    elements.filterOrigin.addEventListener('change', () => {
        state.currentPage = 1;
        performSearch();
    });
    
    elements.filterClass.addEventListener('change', () => {
        state.currentPage = 1;
        performSearch();
    });
    
    elements.filterStatus.addEventListener('change', () => {
        state.currentPage = 1;
        performSearch();
    });

    if (elements.filterSignal) {
        elements.filterSignal.addEventListener('change', () => {
            state.currentPage = 1;
            performSearch();
        });
    }

    elements.filterDateFrom.addEventListener('change', () => {
        state.currentPage = 1;
        performSearch();
    });
    
    elements.filterDateTo.addEventListener('change', () => {
        state.currentPage = 1;
        performSearch();
    });
    
    // Clear filters
    elements.clearFilters.addEventListener('click', clearAllFilters);
    
    // Sortable headers
    document.querySelectorAll('.results-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (state.sortColumn === column) {
                // Toggle direction
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                // New column, default to desc for dates, asc for text
                state.sortColumn = column;
                state.sortDirection = column === 'approval_date' ? 'desc' : 'asc';
            }
            updateSortIndicators();
            state.currentPage = 1;
            performSearch();
        });
    });
    
    // Modal
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ============================================
// SUBCATEGORY FILTERING
// ============================================

function updateSubcategoryDropdown() {
    const selectedCategory = elements.filterCategory.value;

    // Clear current options
    elements.filterClass.innerHTML = '<option value="">All Subcategories</option>';

    if (selectedCategory && TTB_CATEGORIES[selectedCategory]) {
        // Show subcategory names for the selected category
        const subcategories = getSubcategories(selectedCategory);
        subcategories.forEach(subcat => {
            const option = document.createElement('option');
            option.value = subcat;  // Subcategory name (e.g., "Bourbon")
            option.textContent = subcat;
            elements.filterClass.appendChild(option);
        });
    }
    // If no category selected, leave subcategory dropdown empty (All Subcategories)
}

function updateSortIndicators() {
    document.querySelectorAll('.results-table th.sortable').forEach(th => {
        const column = th.dataset.sort;
        const icon = th.querySelector('.sort-icon');
        
        if (column === state.sortColumn) {
            th.classList.add('active');
            th.classList.remove('asc', 'desc');
            th.classList.add(state.sortDirection);
            icon.textContent = state.sortDirection === 'asc' ? '↑' : '↓';
        } else {
            th.classList.remove('active', 'asc', 'desc');
            icon.textContent = '';
        }
    });
}

// ============================================
// API CALLS
// ============================================

async function loadFilters() {
    try {
        const response = await fetch(`${API_BASE}/api/filters`);
        const data = await response.json();
        
        if (data.success) {
            state.filters = data.filters;
            populateFilterDropdowns();
        }
    } catch (error) {
        console.error('Failed to load filters:', error);
    }
}

async function performSearch() {
    if (state.isLoading) return;

    state.isLoading = true;
    showLoading();

    try {
        const params = new URLSearchParams({
            page: state.currentPage,
            limit: ITEMS_PER_PAGE,
            sort: state.sortColumn,
            order: state.sortDirection
        });

        // Pass user email for tier checking
        const user = BevAlcAuth.getUser();
        if (user?.email) {
            params.append('email', user.email);
        }

        const query = elements.searchInput.value.trim();
        if (query) params.append('q', query);

        const origin = elements.filterOrigin.value;
        if (origin) params.append('origin', origin);

        const category = elements.filterCategory.value;
        if (category) params.append('category', category);

        // Subcategory filter - send subcategory name (e.g., "Bourbon")
        // The API will convert this to the list of TTB codes
        const subcategory = elements.filterClass.value;
        if (subcategory) params.append('subcategory', subcategory);

        const status = elements.filterStatus.value;
        if (status) params.append('status', status);

        // Signal filter - from dropdown or URL parameter
        const signal = elements.filterSignal?.value || state.signalFilter;
        if (signal) params.append('signal', signal);

        const dateFrom = elements.filterDateFrom.value;
        if (dateFrom) params.append('date_from', dateFrom);

        const dateTo = elements.filterDateTo.value;
        if (dateTo) params.append('date_to', dateTo);

        const token = getUserToken();
        const response = await fetch(`${API_BASE}/api/search?${params}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const data = await response.json();

        if (data.success) {
            state.currentResults = data.data;  // Store for CSV export
            state.userAllowedCategory = data.userAllowedCategory || null;  // For Category Pro users
            state.dataLagMonths = data.dataLagMonths || null;  // For free users
            renderResults(data.data, data.userAllowedCategory);
            renderPagination(data.pagination);
            updateResultsCount(data.pagination);
            showDataLagBanner(data.dataLagMonths);

            // Save to search history (only on page 1 to avoid duplicates)
            if (state.currentPage === 1) {
                addToSearchHistory(getCurrentSearchParams());
            }
        } else if (data.error === 'category_required') {
            // Category Pro user hasn't selected their category yet
            showCategoryRequiredMessage();
        } else {
            showError('Failed to load data. Please try again.');
        }
    } catch (error) {
        console.error('Search failed:', error);
        showError('Failed to connect to database. Please try again.');
    } finally {
        state.isLoading = false;
        hideLoading();
    }
}

async function loadRecord(ttbId) {
    try {
        const response = await fetch(`${API_BASE}/api/record?id=${encodeURIComponent(ttbId)}`);
        const data = await response.json();
        
        if (data.success) {
            openModal(data.data);
        }
    } catch (error) {
        console.error('Failed to load record:', error);
    }
}

// ============================================
// UI RENDERING
// ============================================

function populateFilterDropdowns() {
    // Origins
    state.filters.origins.forEach(origin => {
        const option = document.createElement('option');
        option.value = origin;
        option.textContent = origin;
        elements.filterOrigin.appendChild(option);
    });

    // Subcategories - initially empty (populated when category is selected)
    // The cascading filter is handled by updateSubcategoryDropdown()

    // Statuses
    state.filters.statuses.forEach(status => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        elements.filterStatus.appendChild(option);
    });
}

function showCategoryRequiredMessage() {
    elements.resultsBody.innerHTML = `
        <tr>
            <td colspan="7" class="no-results">
                <div class="no-results-content">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path>
                    </svg>
                    <h3>Select Your Category</h3>
                    <p>Please choose your category in <a href="account.html" style="color: var(--color-primary);">Account Settings</a> to access the database.</p>
                </div>
            </td>
        </tr>
    `;
    elements.pagination.innerHTML = '';
    elements.resultsCount.textContent = '';
}

function showDataLagBanner(lagMonths) {
    // Remove any existing banner
    const existingBanner = document.querySelector('.data-lag-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // Only show banner for free users with data lag
    if (!lagMonths) return;

    const banner = document.createElement('div');
    banner.className = 'data-lag-banner';
    banner.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v6l4 2"></path>
        </svg>
        <span>Free accounts see data with a ${lagMonths}-month delay. <a href="index.html#pricing">Upgrade to Pro</a> for real-time access.</span>
    `;

    // Insert before the results table
    const resultsTable = document.querySelector('.results-table');
    if (resultsTable) {
        resultsTable.parentNode.insertBefore(banner, resultsTable);
    }
}

function renderResults(data, userAllowedCategory = null) {
    if (!data || data.length === 0) {
        elements.resultsBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-results">
                    <div class="no-results-content">
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.35-4.35"></path>
                        </svg>
                        <h3>No results found</h3>
                        <p>Try adjusting your search or filters</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Check if user is Pro for signal column
    let isPro = false;
    const userInfo = localStorage.getItem('bevalc_user');
    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            isPro = user.isPro === true;
        } catch (e) {}
    }

    const lockIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

    elements.resultsBody.innerHTML = data.map(cola => {
        // Check if this result is in the user's allowed category (for Category Pro)
        let hasAccessToRow = isPro;
        if (userAllowedCategory && cola.class_type_code) {
            // Get the parent category for this TTB code
            const rowCategory = getCategoryName(cola.class_type_code);
            hasAccessToRow = (rowCategory === userAllowedCategory);
        }

        let signalHtml = '-';
        if (hasAccessToRow) {
            // User has access - show actual signals with refile note
            if (cola.signal) {
                const signalClass = cola.signal.toLowerCase().replace(/_/g, '-');
                let noteHtml = '';

                // Show refile count for NEW_SKU only (how many times this SKU was subsequently refiled)
                if (cola.signal === 'NEW_SKU') {
                    const refileCount = cola.refile_count || 0;
                    if (refileCount > 0) {
                        noteHtml = `<span class="signal-note">(${refileCount} refile${refileCount > 1 ? 's' : ''})</span>`;
                    }
                }

                signalHtml = `<span class="signal-badge signal-${signalClass}">${cola.signal.replace(/_/g, ' ')}</span>${noteHtml}`;
            } else {
                // No signal yet - data enrichment in progress
                signalHtml = `<span style="color: #94a3b8; font-style: italic; font-size: 0.75rem;">Enriching...</span>`;
            }
        } else {
            // No access (free user or Category Pro viewing other category) - show blurred signal
            signalHtml = `<span class="signal-badge signal-blurred" onclick="showProUpgradePrompt(); event.stopPropagation();" title="Upgrade to view">X</span>`;
        }
        // Note: No blurred-row class - Category Pro users see other categories same as free users
        return `
        <tr data-ttb-id="${escapeHtml(cola.ttb_id)}" class="clickable-row">
            <td class="cell-brand">${escapeHtml(cola.brand_name || '-')}</td>
            <td class="cell-fanciful">${escapeHtml(cola.fanciful_name || '-')}</td>
            <td>${escapeHtml(cola.class_type_code || '-')}</td>
            <td>${escapeHtml(cola.approval_date || '-')}</td>
            <td class="cell-signal">${signalHtml}</td>
        </tr>
    `}).join('');
    
    // Add click handlers
    elements.resultsBody.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', () => {
            if (state.hasAccess) {
                loadRecord(row.dataset.ttbId);
            }
        });
    });
}

function renderPagination(pagination) {
    state.totalPages = pagination.totalPages;
    state.totalRecords = pagination.total;
    
    if (pagination.totalPages <= 1) {
        elements.pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `<button class="page-btn" ${pagination.page === 1 ? 'disabled' : ''} data-page="${pagination.page - 1}">
        ← Prev
    </button>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, pagination.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="page-btn" data-page="1">1</button>`;
        if (startPage > 2) html += `<span class="page-ellipsis">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === pagination.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    // Note: Last page button removed - it doesn't work well with large datasets
    
    // Next button
    html += `<button class="page-btn" ${pagination.page === pagination.totalPages ? 'disabled' : ''} data-page="${pagination.page + 1}">
        Next →
    </button>`;
    
    elements.pagination.innerHTML = html;
    
    // Add click handlers
    elements.pagination.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page && page !== state.currentPage && !btn.disabled) {
                state.currentPage = page;
                performSearch();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    });
}

function updateResultsCount(pagination) {
    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = Math.min(pagination.page * pagination.limit, pagination.total);

    if (pagination.total === 0) {
        elements.resultsCount.textContent = '0 results';
    } else {
        elements.resultsCount.textContent = `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${pagination.total.toLocaleString()} results`;
    }

    elements.totalRecords.textContent = `${pagination.total.toLocaleString()} total records`;

    // Update blur overlay record count (for non-logged-in users)
    if (elements.blurRecordCount && pagination.total) {
        const total = pagination.total;
        let displayText;

        if (total >= 1000000) {
            const millions = (total / 1000000).toFixed(1);
            displayText = `${millions}M+`;
        } else if (total >= 1000) {
            const thousands = Math.floor(total / 1000);
            displayText = `${thousands}K+`;
        } else {
            displayText = `${total}+`;
        }

        elements.blurRecordCount.textContent = displayText;
    }
}

// ============================================
// MODAL
// ============================================

function openModal(record) {
    const brandSlug = makeSlug(record.brand_name);

    // Get user info for Pro check FIRST (before rendering anything)
    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = null;
    let isPro = false;
    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            userEmail = user.email;
            isPro = user.isPro || false;
        } catch (e) {}
    }

    // Pro users have full access to everything
    let hasRecordAccess = isPro;

    // Signal badge - only show actual signal if user has access
    let signalBadge = '';
    if (hasRecordAccess) {
        signalBadge = record.signal
            ? `<span class="signal-badge signal-${record.signal.toLowerCase().replace(/_/g, '-')}" style="margin-left: 12px; font-size: 0.7rem; vertical-align: middle;">${record.signal.replace('_', ' ')}</span>`
            : `<span style="margin-left: 12px; font-size: 0.65rem; color: #94a3b8; font-style: italic;">Data enrichment in progress</span>`;
    } else {
        // Blurred signal for users without access
        signalBadge = `<span class="signal-badge signal-blurred" style="margin-left: 12px; font-size: 0.7rem; vertical-align: middle; cursor: pointer;" onclick="showProUpgradePrompt(); event.stopPropagation();" title="Upgrade to view">X</span>`;
    }

    // Set modal title with brand name and signal badge
    if (brandSlug) {
        elements.modalTitle.innerHTML = `<a href="/brand/${brandSlug}" target="_blank" rel="noopener" style="color: inherit; text-decoration: none; border-bottom: 2px solid var(--color-primary);">${escapeHtml(record.brand_name)}</a>${signalBadge}`;
    } else {
        elements.modalTitle.innerHTML = `${escapeHtml(record.brand_name || 'Unknown Brand')}${signalBadge}`;
    }

    // TTB ID - blur for users without access
    if (hasRecordAccess) {
        elements.modalSubtitle.innerHTML = `TTB ID: ${escapeHtml(record.ttb_id)}`;
    } else {
        elements.modalSubtitle.innerHTML = `TTB ID: <span class="detail-blur" style="cursor: pointer;" onclick="showProUpgradePrompt()">••••••••••</span>`;
    }

    // Build TRACK section
    const trackHtml = buildTrackSection(record, userEmail, hasRecordAccess);

    // Build TTB Images link for Product Details
    const ttbUrl = `https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=${record.ttb_id}`;
    const labelImagesHtml = buildLabelImagesField(ttbUrl, hasRecordAccess);
    
    const sections = [
        {
            title: 'Label Information',
            fields: [
                { label: 'Status', value: record.status },
                { label: 'Approval Date', value: record.approval_date },
                { label: 'Fanciful Name', value: record.fanciful_name },
                { label: 'Subcategory', value: record.class_type_code },
                { label: 'Origin', value: record.origin_code },
                { label: 'Type of Application', value: record.type_of_application },
            ]
        },
        {
            title: 'Product Details',
            fields: [
                { label: 'Vendor Code', value: record.vendor_code },
                { label: 'Serial Number', value: record.serial_number },
                { label: 'Total Bottle Capacity', value: record.total_bottle_capacity },
                { label: 'For Sale In', value: record.for_sale_in },
                { label: 'Qualifications', value: record.qualifications },
                { label: 'Plant Registry', value: record.plant_registry, isPro: true },
                { label: 'Label Images', value: '__LABEL_IMAGES__', isSpecial: true },
            ]
        },
        {
            title: 'Company Information',
            fields: [
                { label: 'Company Name', value: record.company_name, isCompanyLink: true, isPro: true },
                { label: 'Street', value: record.street, isPro: true },
                { label: 'State', value: record.state },
                { label: 'Contact Person', value: record.contact_person, isPro: true },
                { label: 'Phone Number', value: record.phone_number, isPro: true },
                { label: 'Federal Permits', value: record.permits, isPermits: true, isPro: true },
            ]
        }
    ];
    
    // Check for wine fields
    const wineFields = [
        { label: 'Grape Varietal', value: record.grape_varietal },
        { label: 'Vintage', value: record.wine_vintage },
        { label: 'Appellation', value: record.appellation },
        { label: 'Alcohol Content', value: record.alcohol_content },
        { label: 'pH Level', value: record.ph_level },
    ].filter(f => f.value);
    
    if (wineFields.length > 0) {
        sections.push({
            title: '🍷 Wine Details',
            fields: wineFields,
            className: 'wine-section'
        });
    }
    
    let html = '';
    
    // Add TRACK section first
    html += trackHtml;

    // Full profile link
    html += `<div style="text-align: right; margin-bottom: 12px;">
      <a href="/cola/${encodeURIComponent(record.ttb_id)}/" target="_blank" rel="noopener"
         style="color: var(--color-primary); font-weight: 600; font-size: 0.85rem; text-decoration: none;">
         Open Full Profile &rarr;
      </a>
    </div>`;

    sections.forEach((section, idx) => {
        html += `
            <div class="modal-section ${section.className || ''}">
                <h4>${section.title}</h4>
                <div class="detail-grid">
                    ${section.fields.map(f => {
                        if (f.isSpecial && f.value === '__LABEL_IMAGES__') {
                            return labelImagesHtml;
                        }
                        
                        // Handle Pro-only fields
                        if (f.isPro) {
                            if (hasRecordAccess) {
                                // Pro user: show field with teal label
                                // Handle company link specially
                                if (f.isCompanyLink && f.value) {
                                    const companySlug = makeSlug(f.value);
                                    return `
                                        <div class="detail-item">
                                            <span class="detail-label detail-label-pro">${f.label}</span>
                                            <span class="detail-value">
                                                <a href="/company/${companySlug}" target="_blank" rel="noopener" style="color: var(--color-primary);">${escapeHtml(f.value)}</a>
                                            </span>
                                        </div>
                                    `;
                                }
                                // Handle website field specially
                                if (f.isWebsite) {
                                    if (f.value && f.value !== 'NOT_FOUND') {
                                        // Has website - show clickable link
                                        const displayUrl = f.value.replace(/^https?:\/\//, '').replace(/\/$/, '');
                                        return `
                                            <div class="detail-item">
                                                <span class="detail-label detail-label-pro">${f.label}</span>
                                                <span class="detail-value">
                                                    <a href="${escapeHtml(f.value)}" target="_blank" rel="noopener" style="color: var(--color-primary);">🔗 ${escapeHtml(displayUrl)}</a>
                                                </span>
                                            </div>
                                        `;
                                    } else if (f.value === 'NOT_FOUND') {
                                        // Searched but not found - ask user for help
                                        const mailtoSubject = encodeURIComponent(`Website for ${f.brandName || 'brand'}`);
                                        const mailtoBody = encodeURIComponent(`Hi,\n\nI know the website for ${f.brandName || 'this brand'}:\n\n`);
                                        return `
                                            <div class="detail-item">
                                                <span class="detail-label detail-label-pro">${f.label}</span>
                                                <span class="detail-value">
                                                    <a href="mailto:hello@bevalcintel.com?subject=${mailtoSubject}&body=${mailtoBody}" style="color: #94a3b8;">N/A - Know the site?</a>
                                                </span>
                                            </div>
                                        `;
                                    } else {
                                        // No website yet - show backfill in progress message
                                        return `
                                            <div class="detail-item">
                                                <span class="detail-label detail-label-pro">${f.label}</span>
                                                <span class="detail-value" style="color: #94a3b8; font-style: italic;">Data enrichment in progress</span>
                                            </div>
                                        `;
                                    }
                                }
                                // Handle permits field
                                if (f.isPermits) {
                                    if (f.value && Array.isArray(f.value) && f.value.length > 0) {
                                        // Group permits by type
                                        const permitCounts = {};
                                        for (const p of f.value) {
                                            if (!permitCounts[p.industry_type]) {
                                                permitCounts[p.industry_type] = { count: 0, hasNew: false };
                                            }
                                            permitCounts[p.industry_type].count++;
                                            if (p.is_new) permitCounts[p.industry_type].hasNew = true;
                                        }
                                        const badges = Object.entries(permitCounts).map(([type, data]) => {
                                            const label = type === 'Distilled Spirits Plant' ? 'Distillery' : type === 'Wine Producer' ? 'Winery' : type === 'Importer (Alcohol)' ? 'Importer' : type === 'Wholesaler (Alcohol)' ? 'Wholesaler' : type;
                                            const bg = type === 'Distilled Spirits Plant' ? '#fef3c7' : type === 'Wine Producer' ? '#fce7f3' : type === 'Importer (Alcohol)' ? '#dbeafe' : '#e2e8f0';
                                            const color = type === 'Distilled Spirits Plant' ? '#92400e' : type === 'Wine Producer' ? '#9d174d' : type === 'Importer (Alcohol)' ? '#1e40af' : '#475569';
                                            return `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: ${bg}; color: ${color}; border-radius: 4px; font-size: 0.75rem; font-weight: 500;">${label}${data.count > 1 ? ` (${data.count})` : ''}${data.hasNew ? '<span style="margin-left: 4px; padding: 1px 3px; background: #22c55e; color: white; border-radius: 2px; font-size: 0.6rem;">NEW</span>' : ''}</span>`;
                                        }).join(' ');
                                        return `
                                            <div class="detail-item">
                                                <span class="detail-label detail-label-pro">${f.label}</span>
                                                <span class="detail-value" style="display: flex; flex-wrap: wrap; gap: 6px;">${badges}</span>
                                            </div>
                                        `;
                                    } else {
                                        return `
                                            <div class="detail-item">
                                                <span class="detail-label detail-label-pro">${f.label}</span>
                                                <span class="detail-value" style="color: #94a3b8;">None on file</span>
                                            </div>
                                        `;
                                    }
                                }
                                return `
                                    <div class="detail-item">
                                        <span class="detail-label detail-label-pro">${f.label}</span>
                                        <span class="detail-value">${escapeHtml(f.value || '-')}</span>
                                    </div>
                                `;
                            } else {
                                // Free user: show locked field with upgrade text link (matches Label Images style)
                                return `
                                    <div class="detail-item detail-item-locked">
                                        <span class="detail-label detail-label-pro">${f.label}</span>
                                        <span class="detail-value detail-value-locked">
                                            <span class="detail-blur">${f.value ? '••••••••' : '-'}</span>
                                            <a href="#" class="detail-upgrade-link" onclick="showProUpgradePrompt(); return false;">Upgrade</a>
                                        </span>
                                    </div>
                                `;
                            }
                        }

                        // Company link field (opens in new tab) - for non-Pro company links
                        if (f.isCompanyLink && f.value) {
                            const companySlug = makeSlug(f.value);
                            return `
                                <div class="detail-item">
                                    <span class="detail-label">${f.label}</span>
                                    <span class="detail-value">
                                        <a href="/company/${companySlug}" target="_blank" rel="noopener" style="color: var(--color-primary);">${escapeHtml(f.value)}</a>
                                    </span>
                                </div>
                            `;
                        }

                        // Free field: normal rendering
                        return `
                            <div class="detail-item">
                                <span class="detail-label">${f.label}</span>
                                <span class="detail-value">${escapeHtml(f.value || '-')}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    // Add footer with contact link
    const mailtoSubject = encodeURIComponent('Data correction: ' + (record.ttb_id || ''));
    const mailtoBody = encodeURIComponent('TTB ID: ' + (record.ttb_id || '') + '\nBrand: ' + (record.brand_name || '') + '\n\nCorrection:\n');
    html += `
        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center;">
            <a href="mailto:hello@bevalcintel.com?subject=${mailtoSubject}&body=${mailtoBody}" style="color: #94a3b8; font-size: 0.75em; text-decoration: none;">
                Report a data issue
            </a>
        </div>
    `;

    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Load watchlist states and counts after modal is rendered
    if (userEmail) {
        loadWatchlistStates(record, userEmail, hasRecordAccess);
        loadCreditBalance(userEmail);
    }
    loadWatchlistCounts(record);
}

function buildTrackSection(record, userEmail, isPro) {
    const brandName = record.brand_name || '';
    const companyName = record.company_name || '';
    const fancifulName = record.fanciful_name || '';
    const subcategory = record.class_type_code || '';
    
    const lockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    const starIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    const checkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    
    const createPill = (type, value, displayValue, countId) => {
        if (!value) return '';
        
        const truncatedDisplay = displayValue.length > 25 ? displayValue.substring(0, 25) + '...' : displayValue;
        const dataAttrs = `data-type="${type}" data-value="${escapeHtml(value)}"`;
        
        if (!isPro) {
            return `
                <button class="track-pill track-pill-locked" ${dataAttrs} onclick="showProUpgradePrompt()">
                    ${lockIcon}
                    <span>Follow ${type === 'subcategory' ? 'Subcategory' : type.charAt(0).toUpperCase() + type.slice(1)}</span>
                    <span class="track-pill-value" title="${escapeHtml(displayValue)}">${escapeHtml(truncatedDisplay)}</span>
                    <span class="track-pill-count" id="${countId}">...</span>
                </button>
            `;
        }
        
        return `
            <button class="track-pill" ${dataAttrs} id="pill-${type}" onclick="toggleWatchlist('${type}', '${escapeHtml(value).replace(/'/g, "\\'")}')">
                <span class="track-pill-icon">${starIcon}</span>
                <span>Follow ${type === 'subcategory' ? 'Subcategory' : type.charAt(0).toUpperCase() + type.slice(1)}</span>
                <span class="track-pill-value" title="${escapeHtml(displayValue)}">${escapeHtml(truncatedDisplay)}</span>
                <span class="track-pill-count" id="${countId}">...</span>
            </button>
        `;
    };
    
    return `
        <div class="modal-section track-section">
            <h4>Track</h4>
            <div class="track-pills">
                ${createPill('brand', brandName, brandName, 'count-brand')}
                ${createPill('company', companyName, companyName, 'count-company')}
            </div>
        </div>
    `;
}

function buildLabelImagesField(ttbUrl, isPro) {
    const externalIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-left:4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
    
    if (isPro) {
        return `
            <div class="detail-item">
                <span class="detail-label detail-label-teal">Label Images</span>
                <span class="detail-value">
                    <a href="${ttbUrl}" target="_blank" rel="noopener" class="label-images-link">
                        View on TTB (images at bottom)${externalIcon}
                    </a>
                </span>
            </div>
        `;
    }
    
    return `
        <div class="detail-item">
            <span class="detail-label detail-label-teal">Label Images</span>
            <span class="detail-value">
                <button class="label-images-locked" onclick="showProUpgradePrompt()">
                    <span class="label-images-blur">View on TTB</span>
                    <span class="label-images-upgrade">Upgrade</span>
                </button>
            </span>
        </div>
    `;
}

async function loadWatchlistStates(record, userEmail, isPro) {
    if (!isPro) return;
    const userToken = getUserToken();
    if (!userToken) return;
    
    const types = [
        { type: 'brand', value: record.brand_name },
        { type: 'company', value: record.company_name }
    ];
    
    for (const item of types) {
        if (!item.value) continue;
        
        try {
            const response = await fetch(
                `${API_BASE}/api/watchlist/check?email=${encodeURIComponent(userEmail)}&type=${item.type}&value=${encodeURIComponent(item.value)}`,
                { headers: { 'Authorization': `Bearer ${userToken}` } }
            );
            const data = await response.json();
            
            if (data.success && data.isWatching) {
                const pill = document.getElementById(`pill-${item.type}`);
                if (pill) {
                    pill.classList.add('track-pill-active');
                    const iconSpan = pill.querySelector('.track-pill-icon');
                    if (iconSpan) {
                        iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    }
                }
            }
        } catch (e) {
            console.error('Error checking watchlist:', e);
        }
    }
}

async function loadWatchlistCounts(record) {
    const params = new URLSearchParams();
    if (record.brand_name) params.append('brand', record.brand_name);
    if (record.company_name) params.append('company', record.company_name);
    if (record.fanciful_name && record.fanciful_name.length >= 3) params.append('keyword', record.fanciful_name);
    if (record.class_type_code) params.append('subcategory', record.class_type_code);
    
    try {
        const response = await fetch(`${API_BASE}/api/watchlist/counts?${params.toString()}`);
        const data = await response.json();
        
        if (data.success && data.counts) {
            if (data.counts.brand !== undefined) {
                const el = document.getElementById('count-brand');
                if (el) el.textContent = `${data.counts.brand.toLocaleString()} labels`;
            }
            if (data.counts.company !== undefined) {
                const el = document.getElementById('count-company');
                if (el) el.textContent = `${data.counts.company.toLocaleString()} labels`;
            }
            if (data.counts.keyword !== undefined) {
                const el = document.getElementById('count-keyword');
                if (el) el.textContent = `${data.counts.keyword.toLocaleString()} matches`;
            }
            if (data.counts.subcategory !== undefined) {
                const el = document.getElementById('count-subcategory');
                if (el) el.textContent = `${data.counts.subcategory.toLocaleString()} labels`;
            }
        }
    } catch (e) {
        console.error('Error loading counts:', e);
    }
}

async function toggleWatchlist(type, value) {
    const userInfo = localStorage.getItem('bevalc_user');
    if (!userInfo) {
        showProUpgradePrompt();
        return;
    }
    
    let userEmail;
    try {
        const user = JSON.parse(userInfo);
        userEmail = user.email;
    } catch (e) {
        showProUpgradePrompt();
        return;
    }
    const userToken = getUserToken();
    if (!userToken) {
        showProUpgradePrompt();
        return;
    }
    
    const pill = document.getElementById(`pill-${type}`);
    if (!pill) return;
    
    const isCurrentlyActive = pill.classList.contains('track-pill-active');
    const endpoint = isCurrentlyActive ? 'remove' : 'add';
    
    // Optimistic UI update
    pill.classList.toggle('track-pill-active');
    const iconSpan = pill.querySelector('.track-pill-icon');
    if (iconSpan) {
        if (isCurrentlyActive) {
            iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        } else {
            iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/watchlist/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({ email: userEmail, type, value })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            // Revert on failure
            pill.classList.toggle('track-pill-active');
            if (iconSpan) {
                if (!isCurrentlyActive) {
                    iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
                } else {
                    iconSpan.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                }
            }
            console.error('Watchlist error:', data.error);
        }
    } catch (e) {
        // Revert on error
        pill.classList.toggle('track-pill-active');
        console.error('Watchlist request failed:', e);
    }
}

function showProUpgradePrompt() {
    // Create a simple modal prompt
    const existingPrompt = document.getElementById('pro-upgrade-prompt');
    if (existingPrompt) existingPrompt.remove();

    const prompt = document.createElement('div');
    prompt.id = 'pro-upgrade-prompt';
    prompt.innerHTML = `
        <div class="pro-prompt-overlay">
            <div class="pro-prompt-content">
                <button class="pro-prompt-close" onclick="this.closest('#pro-upgrade-prompt').remove()">&times;</button>
                <h3>Pro Feature</h3>
                <a href="/#pricing" class="btn btn-primary" onclick="this.closest('#pro-upgrade-prompt').remove()">Upgrade to Pro</a>
            </div>
        </div>
    `;
    document.body.appendChild(prompt);
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Enhancement removed from modal — enrichment lives on company pages only

function showCreditPurchaseModal(isPro) {
    const existing = document.getElementById('credit-purchase-modal');
    if (existing) existing.remove();

    // Pro users get better rates
    const packs = isPro ? [
        { id: 'pack_10', credits: 10, price: '$20', perCredit: '$2.00/credit' },
        { id: 'pack_25', credits: 25, price: '$40', perCredit: '$1.60/credit', best: true }
    ] : [
        { id: 'pack_10', credits: 10, price: '$20', perCredit: '$2.00/credit' },
        { id: 'pack_25', credits: 25, price: '$40', perCredit: '$1.60/credit', best: true }
    ];

    const modal = document.createElement('div');
    modal.id = 'credit-purchase-modal';
    modal.className = 'pro-upgrade-prompt';
    modal.innerHTML = `
        <div class="pro-prompt-content" style="max-width: 400px;">
            <button class="pro-prompt-close" onclick="this.closest('#credit-purchase-modal').remove()">&times;</button>
            <h3>Enhancement Credits</h3>
            <p style="margin-bottom: 16px;">Get detailed company intelligence with enhancement credits.</p>

            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${packs.map(p => `
                    <button onclick="purchaseCredits('${p.id}')" class="credit-pack-btn ${p.best ? 'credit-pack-best' : ''}" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 12px 16px;
                        border: 2px solid ${p.best ? 'var(--color-primary)' : '#e2e8f0'};
                        border-radius: 8px;
                        background: ${p.best ? 'rgba(26, 188, 156, 0.1)' : '#fff'};
                        cursor: pointer;
                        transition: all 0.2s;
                    ">
                        <div style="text-align: left;">
                            <div style="font-weight: 600;">${p.credits} credits</div>
                            <div style="font-size: 0.8rem; color: #64748b;">${p.perCredit} each</div>
                        </div>
                        <div style="font-weight: 600; font-size: 1.1rem;">${p.price}</div>
                        ${p.best ? '<span style="position: absolute; top: -8px; right: 12px; background: var(--color-primary); color: white; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px;">BEST VALUE</span>' : ''}
                    </button>
                `).join('')}
            </div>

        </div>
    `;
    document.body.appendChild(modal);
}

async function purchaseCredits(packId) {
    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = '';
    try {
        if (userInfo) {
            const user = JSON.parse(userInfo);
            userEmail = user.email || '';
        }
    } catch (e) {}

    if (!userEmail) {
        alert('Please sign in first');
        return;
    }

    const token = getUserToken();
    if (!token) {
        alert('Please verify your email from account settings before purchasing credits.');
        window.location.href = '/account.html';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/credits/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                email: userEmail,
                pack: packId,
                successUrl: window.location.origin + '/account.html?credits=success#credits',
                cancelUrl: window.location.origin + '/account.html#credits',
                token
            })
        });
        const data = await response.json();
        if (data.success && data.url) {
            window.location.href = data.url;
            return;
        }
        alert(data.error || 'Could not create checkout');
    } catch (e) {
        alert('Could not connect to server');
    }
}

// Load user's credit balance when modal opens
async function loadCreditBalance(email) {
    if (!email) return;
    const balanceEl = document.getElementById('credit-balance');

    try {
        const token = getUserToken();
        if (!token) {
            if (balanceEl) {
                balanceEl.innerHTML = `<a href="/account.html" style="color: var(--color-primary);">Check email to enable credits</a>`;
            }
            return;
        }
        const response = await fetch(`${API_BASE}/api/credits?email=${encodeURIComponent(email)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.success && balanceEl) {
            if (data.credits > 0) {
                balanceEl.innerHTML = `You have ${data.credits} credit${data.credits !== 1 ? 's' : ''} � <a href="/account.html#credits" style="color: var(--color-primary);">Get more</a>`;
            } else {
                balanceEl.innerHTML = `<a href="/account.html#credits" style="color: var(--color-primary);">Get credits</a>`;
            }
        }
    } catch (e) {
        console.error('Error loading credit balance:', e);
    }
}
// ============================================
// UTILITIES
// ============================================

function clearAllFilters() {
    elements.searchInput.value = '';
    elements.filterOrigin.value = '';
    elements.filterCategory.value = '';
    // Reset subcategory dropdown (cascading - will be empty until category selected)
    elements.filterClass.innerHTML = '<option value="">All Subcategories</option>';
    elements.filterStatus.value = '';
    if (elements.filterSignal) elements.filterSignal.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
    state.signalFilter = null;  // Clear signal filter too
    state.currentPage = 1;
    performSearch();
}

function showLoading() {
    elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
    elements.loadingOverlay.classList.remove('active');
}

function showError(message) {
    elements.resultsBody.innerHTML = `
        <tr>
            <td colspan="7" class="no-results">
                <div class="no-results-content error">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 8v4M12 16h.01"></path>
                    </svg>
                    <h3>Error</h3>
                    <p>${escapeHtml(message)}</p>
                    <button class="btn btn-primary" onclick="performSearch()">Try Again</button>
                </div>
            </td>
        </tr>
    `;
}

// ============================================
// CSV EXPORT
// ============================================

async function exportCSV() {
    // Check if user is Pro
    const userInfo = localStorage.getItem('bevalc_user');
    let isPro = false;
    let userEmail = '';

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            isPro = user.isPro === true;
            userEmail = user.email || '';
        } catch (e) {}
    }

    if (!isPro) {
        showProUpgradePrompt();
        return;
    }

    if (!userEmail) {
        alert('Please log in to export data.');
        return;
    }
    
    // Show loading state on button
    const csvBtn = document.getElementById('csv-export-btn');
    const originalHTML = csvBtn.innerHTML;
    csvBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"></circle>
        </svg>
        <span>Exporting...</span>
    `;
    csvBtn.disabled = true;
    
    try {
        // Build export URL with same filters as current search
        const params = new URLSearchParams({
            email: userEmail,
            sort: state.sortColumn,
            order: state.sortDirection
        });
        
        const query = elements.searchInput.value.trim();
        if (query) params.append('q', query);
        
        const origin = elements.filterOrigin.value;
        if (origin) params.append('origin', origin);

        const category = elements.filterCategory.value;
        if (category) params.append('category', category);

        // Subcategory filter
        const subcategory = elements.filterClass.value;
        if (subcategory) params.append('subcategory', subcategory);

        const status = elements.filterStatus.value;
        if (status) params.append('status', status);

        // Signal filter
        const signal = elements.filterSignal?.value || state.signalFilter;
        if (signal) params.append('signal', signal);

        const dateFrom = elements.filterDateFrom.value;
        if (dateFrom) params.append('date_from', dateFrom);

        const dateTo = elements.filterDateTo.value;
        if (dateTo) params.append('date_to', dateTo);

        const token = getUserToken();
        if (!token) {
            alert('Please verify your email to enable exports.');
            return;
        }

        const response = await fetch(`${API_BASE}/api/export?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (!data.success) {
            alert(data.error || 'Export failed. Please try again.');
            return;
        }
        
        if (!data.data || data.data.length === 0) {
            alert('No data to export with current filters.');
            return;
        }
        
        // Define columns to export (matches detail card - all fields)
        const columns = [
            'ttb_id',
            'brand_name',
            'fanciful_name',
            'signal',
            'status',
            'approval_date',
            'class_type_code',
            'origin_code',
            'type_of_application',
            'vendor_code',
            'serial_number',
            'total_bottle_capacity',
            'for_sale_in',
            'qualifications',
            'plant_registry',
            'company_name',
            'street',
            'state',
            'contact_person',
            'phone_number',
            'grape_varietal',
            'wine_vintage',
            'appellation',
            'alcohol_content',
            'ph_level'
        ];

        const headers = [
            'TTB ID',
            'Brand Name',
            'Fanciful Name',
            'Signal',
            'Status',
            'Approval Date',
            'Subcategory',
            'Origin',
            'Type of Application',
            'Vendor Code',
            'Serial Number',
            'Total Bottle Capacity',
            'For Sale In',
            'Qualifications',
            'Plant Registry',
            'Company Name',
            'Street',
            'State',
            'Contact Person',
            'Phone Number',
            'Grape Varietal',
            'Wine Vintage',
            'Appellation',
            'Alcohol Content',
            'pH Level'
        ];
        
        // Build CSV content
        const csvRows = [];
        
        // Header row
        csvRows.push(headers.join(','));
        
        // Data rows
        data.data.forEach(row => {
            const values = columns.map(col => {
                let val = row[col] || '';
                // Escape quotes and wrap in quotes if contains comma, quote, or newline
                val = String(val).replace(/"/g, '""');
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    val = `"${val}"`;
                }
                return val;
            });
            csvRows.push(values.join(','));
        });
        
        const csvContent = csvRows.join('\n');
        
        // Create and trigger download (BOM ensures Excel reads UTF-8 correctly)
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        
        // Generate filename with date
        const today = new Date().toISOString().split('T')[0];
        link.setAttribute('download', `bevalc_export_${today}.csv`);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Show success message with count
        const exportedCount = data.exported;
        const totalCount = data.total;
        if (exportedCount < totalCount) {
            alert(`Exported ${exportedCount.toLocaleString()} of ${totalCount.toLocaleString()} matching records (max 1,000 per export).`);
        }
        
    } catch (e) {
        console.error('Export failed:', e);
        alert('Export failed. Please try again.');
    } finally {
        // Restore button
        csvBtn.innerHTML = originalHTML;
        csvBtn.disabled = false;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function makeSlug(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ============================================
// SAVED SEARCHES (Pro Feature)
// ============================================

function setupSavedSearches() {
    // Check if Pro user
    const userInfo = localStorage.getItem('bevalc_user');
    let isPro = false;
    let userEmail = '';
    let userToken = '';

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            isPro = user.isPro === true;
            userEmail = user.email || '';
            userToken = user.token || '';
        } catch (e) {}
    }

    // Show saved searches UI only for Pro users
    if (isPro && elements.savedSearchesWrapper) {
        elements.savedSearchesWrapper.style.display = 'block';
        loadSavedSearches();
        setupSavedSearchListeners();
    }
}

function setupSavedSearchListeners() {
    // Toggle dropdown
    if (elements.savedSearchesBtn) {
        elements.savedSearchesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.savedSearchesMenu.classList.toggle('open');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (elements.savedSearchesMenu && !elements.savedSearchesMenu.contains(e.target) &&
            !elements.savedSearchesBtn.contains(e.target)) {
            elements.savedSearchesMenu.classList.remove('open');
        }
    });

    // Open save modal
    if (elements.saveCurrentSearch) {
        elements.saveCurrentSearch.addEventListener('click', () => {
            elements.savedSearchesMenu.classList.remove('open');
            openSaveSearchModal();
        });
    }

    // Cancel save
    if (elements.saveSearchCancel) {
        elements.saveSearchCancel.addEventListener('click', closeSaveSearchModal);
    }

    // Confirm save
    if (elements.saveSearchConfirm) {
        elements.saveSearchConfirm.addEventListener('click', saveCurrentSearch);
    }

    // Enter key in save input
    if (elements.saveSearchName) {
        elements.saveSearchName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveCurrentSearch();
        });
    }

    // Close modal on outside click
    if (elements.saveSearchModal) {
        elements.saveSearchModal.addEventListener('click', (e) => {
            if (e.target === elements.saveSearchModal) closeSaveSearchModal();
        });
    }
}

function openSaveSearchModal() {
    if (elements.saveSearchModal) {
        elements.saveSearchModal.classList.add('open');
        elements.saveSearchName.value = '';
        elements.saveSearchName.focus();
    }
}

function closeSaveSearchModal() {
    if (elements.saveSearchModal) {
        elements.saveSearchModal.classList.remove('open');
    }
}

function getCurrentSearchParams() {
    const params = {};

    const query = elements.searchInput?.value?.trim();
    if (query) params.q = query;

    const origin = elements.filterOrigin?.value;
    if (origin) params.origin = origin;

    const category = elements.filterCategory?.value;
    if (category) params.category = category;

    const subcategory = elements.filterClass?.value;
    if (subcategory) params.subcategory = subcategory;

    const status = elements.filterStatus?.value;
    if (status) params.status = status;

    const signal = elements.filterSignal?.value || state.signalFilter;
    if (signal) params.signal = signal;

    const dateFrom = elements.filterDateFrom?.value;
    if (dateFrom) params.date_from = dateFrom;

    const dateTo = elements.filterDateTo?.value;
    if (dateTo) params.date_to = dateTo;

    return params;
}

async function saveCurrentSearch() {
    const name = elements.saveSearchName?.value?.trim();
    if (!name) {
        alert('Please enter a name for this search');
        return;
    }

    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = '';
    let userToken = '';

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            userEmail = user.email || '';
            userToken = user.token || '';
        } catch (e) {}
    }

    if (!userEmail) {
        alert('Please log in to save searches');
        return;
    }

    const searchParams = getCurrentSearchParams();
    if (!userToken) userToken = getUserToken();
    if (!userToken) {
        alert('Please open your preferences link from email to enable saved searches.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/saved-searches`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userToken}`
            },
            body: JSON.stringify({
                email: userEmail,
                name: name,
                search_params: searchParams
            })
        });

        const data = await response.json();

        if (data.success) {
            closeSaveSearchModal();
            loadSavedSearches();
        } else {
            alert(data.error || 'Failed to save search');
        }
    } catch (e) {
        console.error('Save search failed:', e);
        alert('Failed to save search. Please try again.');
    }
}

async function loadSavedSearches() {
    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = '';
    let userToken = '';

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            userEmail = user.email || '';
            userToken = user.token || '';
        } catch (e) {}
    }

    if (!userEmail || !elements.savedSearchesList) return;
    if (!userToken) userToken = getUserToken();
    if (!userToken) return;

    try {
        const response = await fetch(`${API_BASE}/api/saved-searches?email=${encodeURIComponent(userEmail)}`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const data = await response.json();

        if (data.success && data.searches) {
            renderSavedSearches(data.searches);
        }
    } catch (e) {
        console.error('Load saved searches failed:', e);
    }
}

function renderSavedSearches(searches) {
    if (!elements.savedSearchesList) return;

    if (searches.length === 0) {
        elements.savedSearchesList.innerHTML = '<div class="saved-searches-empty">No saved searches</div>';
        return;
    }

    const html = searches.map(search => {
        const date = new Date(search.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        return `
            <div class="saved-search-item" data-id="${search.id}" data-params='${escapeHtml(search.search_params)}'>
                <div class="saved-search-info">
                    <div class="saved-search-name">${escapeHtml(search.name)}</div>
                    <div class="saved-search-date">${date}</div>
                </div>
                <button class="saved-search-delete" data-id="${search.id}" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    }).join('');

    elements.savedSearchesList.innerHTML = html;

    // Add click handlers for loading searches
    elements.savedSearchesList.querySelectorAll('.saved-search-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger load if clicking delete button
            if (e.target.closest('.saved-search-delete')) return;

            const paramsJson = item.dataset.params;
            try {
                const params = JSON.parse(paramsJson);
                applySavedSearch(params);
                elements.savedSearchesMenu.classList.remove('open');
            } catch (e) {
                console.error('Failed to parse search params:', e);
            }
        });
    });

    // Add click handlers for delete buttons
    elements.savedSearchesList.querySelectorAll('.saved-search-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (confirm('Delete this saved search?')) {
                await deleteSavedSearch(id);
            }
        });
    });
}

function applySavedSearch(params) {
    // Clear all filters first
    elements.searchInput.value = '';
    elements.filterOrigin.value = '';
    elements.filterCategory.value = '';
    elements.filterClass.innerHTML = '<option value="">All Subcategories</option>';
    elements.filterStatus.value = '';
    if (elements.filterSignal) elements.filterSignal.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
    state.signalFilter = null;

    // Apply saved params
    if (params.q) elements.searchInput.value = params.q;
    if (params.origin) elements.filterOrigin.value = params.origin;
    if (params.category) {
        elements.filterCategory.value = params.category;
        updateSubcategoryDropdown();
    }
    if (params.subcategory) elements.filterClass.value = params.subcategory;
    if (params.status) elements.filterStatus.value = params.status;
    if (params.signal && elements.filterSignal) {
        elements.filterSignal.value = params.signal;
    }
    if (params.date_from) elements.filterDateFrom.value = params.date_from;
    if (params.date_to) elements.filterDateTo.value = params.date_to;

    // Execute search
    state.currentPage = 1;
    performSearch();
}

async function deleteSavedSearch(id) {
    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = '';
    let userToken = '';

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            userEmail = user.email || '';
            userToken = user.token || '';
        } catch (e) {}
    }

    if (!userEmail) return;
    if (!userToken) userToken = getUserToken();
    if (!userToken) return;

    try {
        const response = await fetch(`${API_BASE}/api/saved-searches?email=${encodeURIComponent(userEmail)}&id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${userToken}` }
        });

        const data = await response.json();

        if (data.success) {
            loadSavedSearches();
        } else {
            alert(data.error || 'Failed to delete search');
        }
    } catch (e) {
        console.error('Delete search failed:', e);
        alert('Failed to delete search. Please try again.');
    }
}

// ============================================
// SEARCH HISTORY (localStorage-based)
// ============================================

const SEARCH_HISTORY_KEY = 'bevalc_search_history';
const MAX_SEARCH_HISTORY = 15;

function setupSearchHistory() {
    const dropdown = document.getElementById('search-history-dropdown');
    const clearBtn = document.getElementById('search-history-clear');

    if (!dropdown || !elements.searchInput) return;

    // Show dropdown on focus
    elements.searchInput.addEventListener('focus', showSearchHistory);

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !elements.searchInput.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    // Clear history button
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSearchHistory();
        });
    }
}

function showSearchHistory() {
    const dropdown = document.getElementById('search-history-dropdown');
    const list = document.getElementById('search-history-list');

    if (!dropdown || !list) return;

    const history = getSearchHistory();

    if (history.length === 0) {
        list.innerHTML = '<div class="search-history-empty">No recent searches</div>';
    } else {
        list.innerHTML = history.map((item, index) => {
            // Count active filters
            let filterCount = 0;
            if (item.origin) filterCount++;
            if (item.category) filterCount++;
            if (item.subcategory) filterCount++;
            if (item.status) filterCount++;
            if (item.signal) filterCount++;
            if (item.date_from || item.date_to) filterCount++;

            const filterBadge = filterCount > 0
                ? `<span class="filters-badge">+${filterCount} filter${filterCount > 1 ? 's' : ''}</span>`
                : '';

            const displayQuery = item.q || '(All records)';

            return `
                <div class="search-history-item" data-index="${index}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span class="query">${escapeHtml(displayQuery)}</span>
                    ${filterBadge}
                </div>
            `;
        }).join('');

        // Add click handlers
        list.querySelectorAll('.search-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                applySearchHistoryItem(index);
                dropdown.classList.remove('open');
            });
        });
    }

    dropdown.classList.add('open');
}

function getSearchHistory() {
    try {
        const history = localStorage.getItem(SEARCH_HISTORY_KEY);
        return history ? JSON.parse(history) : [];
    } catch (e) {
        return [];
    }
}

function addToSearchHistory(searchParams) {
    // Don't save empty searches
    const hasFilters = searchParams.q || searchParams.origin || searchParams.category ||
        searchParams.subcategory || searchParams.status || searchParams.signal ||
        searchParams.date_from || searchParams.date_to;

    if (!hasFilters) return;

    let history = getSearchHistory();

    // Remove duplicate if exists (same query and filters)
    const searchKey = JSON.stringify(searchParams);
    history = history.filter(item => JSON.stringify(item) !== searchKey);

    // Add to beginning
    history.unshift(searchParams);

    // Keep only last N items
    if (history.length > MAX_SEARCH_HISTORY) {
        history = history.slice(0, MAX_SEARCH_HISTORY);
    }

    try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Failed to save search history:', e);
    }
}

function applySearchHistoryItem(index) {
    const history = getSearchHistory();
    if (index < 0 || index >= history.length) return;

    const item = history[index];

    // Clear all filters first
    elements.searchInput.value = '';
    elements.filterOrigin.value = '';
    elements.filterCategory.value = '';
    elements.filterClass.innerHTML = '<option value="">All Subcategories</option>';
    elements.filterStatus.value = '';
    if (elements.filterSignal) elements.filterSignal.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
    state.signalFilter = null;

    // Apply saved filters
    if (item.q) elements.searchInput.value = item.q;
    if (item.origin) elements.filterOrigin.value = item.origin;
    if (item.category) {
        elements.filterCategory.value = item.category;
        updateSubcategoryDropdown();
    }
    if (item.subcategory) elements.filterClass.value = item.subcategory;
    if (item.status) elements.filterStatus.value = item.status;
    if (item.signal && elements.filterSignal) elements.filterSignal.value = item.signal;
    if (item.date_from) elements.filterDateFrom.value = item.date_from;
    if (item.date_to) elements.filterDateTo.value = item.date_to;

    // Execute search
    state.currentPage = 1;
    performSearch();
}

function clearSearchHistory() {
    try {
        localStorage.removeItem(SEARCH_HISTORY_KEY);
        showSearchHistory(); // Refresh dropdown
    } catch (e) {
        console.error('Failed to clear search history:', e);
    }
}

