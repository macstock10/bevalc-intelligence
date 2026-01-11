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

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
    cacheElements();
    checkAccess();
    setupEventListeners();
    await loadFilters();

    // Update blur overlay with actual record count
    updateTotalRecordCount();

    // Apply URL parameters to filters before initial search
    applyUrlFilters();

    await performSearch();

    // Check for ttb URL parameter to open modal directly
    await checkUrlModal();
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

    // Signal filter (stored in state for API call, no UI element)
    const signal = urlParams.get('signal');
    if (signal) {
        state.signalFilter = signal;
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
}

// Fetch total record count and update the blur overlay
async function updateTotalRecordCount() {
    try {
        // Use search with minimal params to get total count quickly
        const response = await fetch(`${API_BASE}/api/search?limit=1`);
        const data = await response.json();

        if (data.success && data.total) {
            const total = data.total;
            let displayText;

            if (total >= 1000000) {
                // Format as X.XM+
                const millions = (total / 1000000).toFixed(1);
                displayText = `${millions}M+`;
            } else if (total >= 1000) {
                // Format as XXXK+
                const thousands = Math.floor(total / 1000);
                displayText = `${thousands}K+`;
            } else {
                displayText = `${total}+`;
            }

            if (elements.blurRecordCount) {
                elements.blurRecordCount.textContent = displayText;
            }
        }
    } catch (e) {
        console.log('Could not fetch total record count');
    }
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

            // Fetch tier info from preferences API
            try {
                const prefsResponse = await fetch(`${API_BASE}/api/user/preferences?email=${encodeURIComponent(email)}`);
                const prefsData = await prefsResponse.json();
                if (prefsData.success) {
                    const userInfo = localStorage.getItem('bevalc_user');
                    if (userInfo) {
                        const user = JSON.parse(userInfo);
                        user.tier = prefsData.tier || 'premier';
                        user.tierCategory = prefsData.tier_category || null;
                        localStorage.setItem('bevalc_user', JSON.stringify(user));
                    }
                }
            } catch (e) {
                console.log('Could not fetch tier info');
            }
        } else {
            // Lock CSV export button for non-Pro users
            updateCSVButtonState(false);
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

        const dateFrom = elements.filterDateFrom.value;
        if (dateFrom) params.append('date_from', dateFrom);

        const dateTo = elements.filterDateTo.value;
        if (dateTo) params.append('date_to', dateTo);

        // Signal filter from URL parameter (e.g., NEW_BRAND,NEW_SKU)
        if (state.signalFilter) params.append('signal', state.signalFilter);

        const response = await fetch(`${API_BASE}/api/search?${params}`);
        const data = await response.json();
        
        if (data.success) {
            state.currentResults = data.data;  // Store for CSV export
            renderResults(data.data);
            renderPagination(data.pagination);
            updateResultsCount(data.pagination);
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

function renderResults(data) {
    if (!data || data.length === 0) {
        elements.resultsBody.innerHTML = `
            <tr>
                <td colspan="7" class="no-results">
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
        let signalHtml = '-';
        if (isPro) {
            // Pro users see actual signals with refile note
            if (cola.signal) {
                const signalClass = cola.signal.toLowerCase().replace(/_/g, '-');
                let noteHtml = '';

                // Show note for first-time filings (NEW_COMPANY, NEW_BRAND, NEW_SKU)
                if (cola.signal !== 'REFILE') {
                    const refileCount = cola.refile_count || 0;
                    if (refileCount > 0) {
                        noteHtml = `<span class="signal-note">(${refileCount} refile${refileCount > 1 ? 's' : ''})</span>`;
                    } else {
                        noteHtml = `<span class="signal-note signal-note-current">(current)</span>`;
                    }
                }

                signalHtml = `<span class="signal-badge signal-${signalClass}">${cola.signal.replace(/_/g, ' ')}</span>${noteHtml}`;
            } else {
                // No signal yet - data enrichment in progress
                signalHtml = `<span style="color: #94a3b8; font-style: italic; font-size: 0.75rem;">Enriching...</span>`;
            }
        } else {
            // Free users see locked state
            signalHtml = `<span class="signal-badge signal-locked" onclick="showProUpgradePrompt(); event.stopPropagation();">${lockIcon} Upgrade</span>`;
        }
        return `
        <tr data-ttb-id="${escapeHtml(cola.ttb_id)}" class="clickable-row">
            <td class="cell-brand">${escapeHtml(cola.brand_name || '-')}</td>
            <td class="cell-fanciful">${escapeHtml(cola.fanciful_name || '-')}</td>
            <td>${escapeHtml(cola.class_type_code || '-')}</td>
            <td>${escapeHtml(cola.origin_code || '-')}</td>
            <td>${escapeHtml(cola.approval_date || '-')}</td>
            <td class="cell-signal">${signalHtml}</td>
            <td><span class="status-badge status-${(cola.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(cola.status || '-')}</span></td>
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
    
    if (endPage < pagination.totalPages) {
        if (endPage < pagination.totalPages - 1) html += `<span class="page-ellipsis">...</span>`;
        html += `<button class="page-btn" data-page="${pagination.totalPages}">${pagination.totalPages}</button>`;
    }
    
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
}

// ============================================
// MODAL
// ============================================

function openModal(record) {
    // Make brand name a clickable link to brand page (opens in new tab)
    // Add signal badge next to brand name
    const brandSlug = makeSlug(record.brand_name);
    const signalBadge = record.signal
        ? `<span class="signal-badge signal-${record.signal.toLowerCase().replace(/_/g, '-')}" style="margin-left: 12px; font-size: 0.7rem; vertical-align: middle;">${record.signal.replace('_', ' ')}</span>`
        : `<span style="margin-left: 12px; font-size: 0.65rem; color: #94a3b8; font-style: italic;">Data enrichment in progress</span>`;

    if (brandSlug) {
        elements.modalTitle.innerHTML = `<a href="/brand/${brandSlug}" target="_blank" rel="noopener" style="color: inherit; text-decoration: none; border-bottom: 2px solid var(--color-primary);">${escapeHtml(record.brand_name)}</a>${signalBadge}`;
    } else {
        elements.modalTitle.innerHTML = `${escapeHtml(record.brand_name || 'Unknown Brand')}${signalBadge}`;
    }
    // Get user info for Pro check
    const userInfo = localStorage.getItem('bevalc_user');
    let userEmail = null;
    let isPro = false;
    let userTier = null;
    let userTierCategory = null;

    if (userInfo) {
        try {
            const user = JSON.parse(userInfo);
            userEmail = user.email;
            isPro = user.isPro || false;
            userTier = user.tier || null;
            userTierCategory = user.tierCategory || null;
        } catch (e) {}
    }

    // Check if user has access to this specific record based on tier
    // Premier users: full access to everything
    // Category Pro users: full access only to their category
    // Free users: no Pro access
    let hasRecordAccess = isPro;
    if (isPro && userTier === 'category_pro' && userTierCategory) {
        // Check if record's category matches user's tier category
        const recordCategory = getCategory(record.class_type_code).category;
        hasRecordAccess = (recordCategory === userTierCategory);
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

    // Add Enhancement section for Pro users
    html += buildEnhancementSection(record, userEmail, hasRecordAccess);

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
    
    const types = [
        { type: 'brand', value: record.brand_name },
        { type: 'company', value: record.company_name }
    ];
    
    for (const item of types) {
        if (!item.value) continue;
        
        try {
            const response = await fetch(
                `${API_BASE}/api/watchlist/check?email=${encodeURIComponent(userEmail)}&type=${item.type}&value=${encodeURIComponent(item.value)}`
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
            headers: { 'Content-Type': 'application/json' },
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
                <p>Pro unlocks watchlists + alerts + CSV exports.</p>
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

// ============================================
// COMPANY ENHANCEMENT
// ============================================

function buildEnhancementSection(record, userEmail, isPro) {
    const companyName = record.company_name || '';
    const brandName = record.brand_name || '';

    if (!companyName) {
        return '';
    }

    const starIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

    // Schedule check for cached enhancement after render
    setTimeout(() => checkCachedEnhancement(companyName), 100);

    return `
        <div class="modal-section enhancement-section">
            <h4>Company Intelligence</h4>
            <div id="enhancement-container" data-company-name="${escapeHtml(companyName)}" data-brand-name="${escapeHtml(brandName)}" data-email="${escapeHtml(userEmail || '')}">
                <div class="enhancement-cta" id="enhancement-cta">
                    <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 12px;">
                        Get filing analytics, brand portfolio, distribution footprint, and more.
                    </p>
                    <button onclick="enhanceCompany()" class="enhance-btn" id="enhance-btn">
                        ${starIcon}
                        <span>Enhance Company</span>
                        <span class="enhance-cost">(1 credit)</span>
                    </button>
                    <p style="color: #64748b; font-size: 0.75rem; margin-top: 8px;" id="credit-balance"></p>
                </div>
                <div id="enhancement-loading" style="display: none; text-align: center; padding: 30px;">
                    <div style="width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                    <p style="color: var(--color-dark); font-weight: 600; margin-bottom: 8px;">Researching ${escapeHtml(companyName)}...</p>
                    <p style="color: #94a3b8; font-size: 0.8rem;">Searching web for company info, news, and website</p>
                    <p style="color: #64748b; font-size: 0.75rem; margin-top: 12px;">This typically takes 15-30 seconds</p>
                </div>
                <div id="enhancement-tearsheet" style="display: none;"></div>
            </div>
        </div>
    `;
}

async function checkCachedEnhancement(companyName) {
    try {
        // Look up company_id first
        const lookupResp = await fetch(`${API_BASE}/api/company-lookup?name=${encodeURIComponent(companyName)}`);
        const lookupData = await lookupResp.json();

        if (!lookupData.success || !lookupData.company_id) {
            return; // No company found, show enhance button
        }

        // Check for cached enhancement
        const statusResp = await fetch(`${API_BASE}/api/enhance/status?company_id=${lookupData.company_id}`);
        const statusData = await statusResp.json();

        if (statusData.success && statusData.status === 'complete' && statusData.tearsheet) {
            // Show cached tearsheet
            const ctaEl = document.getElementById('enhancement-cta');
            const tearsheetEl = document.getElementById('enhancement-tearsheet');
            if (ctaEl && tearsheetEl) {
                ctaEl.style.display = 'none';
                tearsheetEl.style.display = 'block';
                tearsheetEl.innerHTML = renderTearsheet(statusData.tearsheet, true);
            }
        }
    } catch (e) {
        console.error('Error checking cached enhancement:', e);
    }
}

async function enhanceCompany() {
    const container = document.getElementById('enhancement-container');
    const companyName = container.dataset.companyName;
    const brandName = container.dataset.brandName;
    const email = container.dataset.email;

    if (!email) {
        showProUpgradePrompt();
        return;
    }

    // Show loading state
    document.getElementById('enhance-btn').parentElement.style.display = 'none';
    document.getElementById('enhancement-loading').style.display = 'block';

    try {
        // First, get the company_id from company name
        const lookupResp = await fetch(`${API_BASE}/api/company-lookup?name=${encodeURIComponent(companyName)}`);
        const lookupData = await lookupResp.json();

        if (!lookupData.success || !lookupData.company_id) {
            throw new Error('Company not found in database');
        }

        const companyId = lookupData.company_id;

        // Now call enhance
        const response = await fetch(`${API_BASE}/api/enhance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                company_id: companyId,
                company_name: companyName,
                brand_name: brandName,
                email: email
            })
        });

        const data = await response.json();

        if (!data.success) {
            if (data.error === 'payment_required') {
                showCreditPurchaseModal(data.is_pro);
                // Reset to CTA state
                document.getElementById('enhancement-loading').style.display = 'none';
                document.getElementById('enhance-btn').parentElement.style.display = 'block';
                return;
            }
            throw new Error(data.error || 'Enhancement failed');
        }

        // Show tearsheet
        document.getElementById('enhancement-loading').style.display = 'none';
        document.getElementById('enhancement-tearsheet').style.display = 'block';
        document.getElementById('enhancement-tearsheet').innerHTML = renderTearsheet(data.tearsheet, data.cached);

    } catch (error) {
        console.error('Enhancement error:', error);
        document.getElementById('enhancement-loading').style.display = 'none';
        document.getElementById('enhance-btn').parentElement.style.display = 'block';
        alert('Enhancement failed: ' + error.message);
    }
}

// Store tearsheet data for PDF generation
let currentTearsheetData = null;

function renderTearsheet(tearsheet, cached) {
    // Store for PDF generation
    currentTearsheetData = tearsheet;

    const news = tearsheet.news || [];

    // Format news items
    const newsHtml = news.length > 0 ? news.slice(0, 3).map(n => `
        <div style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
            <div style="font-size: 0.85rem; color: var(--color-dark);">${escapeHtml(n.title || '')}</div>
            <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">${escapeHtml(n.source || '')} ${n.date ? '· ' + escapeHtml(n.date) : ''}</div>
        </div>
    `).join('') : '';

    // Stats summary for preview
    const stats = tearsheet.filing_stats || {};
    const brandCount = (tearsheet.brands || []).length;

    return `
        <div class="tearsheet">
            <div class="tearsheet-header">
                <h3 style="margin: 0 0 4px 0; font-size: 1.1rem; color: var(--color-dark);">${escapeHtml(tearsheet.company_name || 'Company')}</h3>
                ${tearsheet.website?.url ? `<a href="${escapeHtml(tearsheet.website.url)}" target="_blank" rel="noopener" style="font-size: 0.85rem; color: var(--color-primary);">${escapeHtml(tearsheet.website.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '<span style="font-size: 0.8rem; color: #94a3b8;">No website found</span>'}
                ${cached ? '<span style="font-size: 0.65rem; color: #94a3b8; margin-left: 8px;">(cached)</span>' : ''}
            </div>

            ${tearsheet.summary ? `
                <div class="tearsheet-summary" style="margin: 12px 0; padding: 12px; background: #f8fafc; border-radius: 6px;">
                    <p style="font-size: 0.9rem; color: var(--color-dark); line-height: 1.5; margin: 0;">${escapeHtml(tearsheet.summary)}</p>
                </div>
            ` : `
                <div style="margin: 12px 0; padding: 12px; background: #fef3c7; border-radius: 6px;">
                    <p style="font-size: 0.85rem; color: #92400e; margin: 0;">Limited information found for this company.</p>
                </div>
            `}

            ${newsHtml ? `
                <div class="tearsheet-field">
                    <span class="tearsheet-field-label">Recent News</span>
                    <div style="margin-top: 4px;">${newsHtml}</div>
                </div>
            ` : ''}

            <!-- Quick Stats Preview (3 metrics) -->
            <div style="display: flex; gap: 20px; margin: 16px 0; justify-content: center;">
                <div style="text-align: center; padding: 12px 16px; background: #f8fafc; border-radius: 8px; min-width: 70px;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-primary);">${stats.total_filings || 0}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">Total Filings</div>
                </div>
                <div style="text-align: center; padding: 12px 16px; background: #f8fafc; border-radius: 8px; min-width: 70px;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-primary);">${brandCount}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">Brands</div>
                </div>
                <div style="text-align: center; padding: 12px 16px; background: #f8fafc; border-radius: 8px; min-width: 70px;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--color-primary);">${stats.last_12_months || 0}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">Last 12 Mo</div>
                </div>
            </div>

            <!-- Download PDF Button -->
            <button onclick="generateCompanyPDF()" style="
                width: 100%;
                padding: 12px 16px;
                background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-top: 12px;
                transition: transform 0.2s, box-shadow 0.2s;
            " onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(13,148,136,0.3)';" onmouseout="this.style.transform='';this.style.boxShadow='';">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download Company Report (PDF)
            </button>

            <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: center;">
                <a href="mailto:hello@bevalcintel.com?subject=Contact%20info%20request:%20${encodeURIComponent(tearsheet.company_name || '')}&body=I'd%20like%20contact%20information%20for%20${encodeURIComponent(tearsheet.company_name || '')}%0A%0ASpecifically%20looking%20for:%0A"
                   style="color: #64748b; font-size: 0.8rem; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    Want contact info? Let us know
                </a>
            </div>
        </div>
    `;
}

// ============================================
// PDF GENERATION WITH jsPDF
// ============================================

// Main PDF generation function using jsPDF with precise positioning
function generateCompanyPDF() {
    if (!currentTearsheetData) {
        alert('No data available for PDF generation');
        return;
    }

    if (typeof window.jspdf === 'undefined') {
        console.error('jsPDF not available');
        alert('PDF library not loaded. Please refresh the page and try again.');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: 'letter'  // 612 x 792 points
        });

        const tearsheet = currentTearsheetData;
        const stats = tearsheet.filing_stats || {};
        const brands = tearsheet.brands || [];
        const categories = tearsheet.categories || {};
        const news = tearsheet.news || [];
        const recentFilings = tearsheet.recent_filings || [];

        // Page dimensions and margins (0.5 inch = 36pt)
        const pageWidth = 612;
        const pageHeight = 792;
        const margin = 36;
        const marginLeft = margin;
        const marginRight = margin;
        const marginTop = margin;
        const marginBottom = margin;
        const contentWidth = pageWidth - marginLeft - marginRight;

        // Colors (RGB 0-255)
        const teal = [13, 148, 136];
        const darkGray = [55, 65, 81];
        const mediumGray = [107, 114, 128];
        const lightGray = [156, 163, 175];
        const black = [26, 26, 26];
        const bgGray = [248, 250, 250];
        const borderGray = [229, 231, 235];

        // Track Y position
        let y = marginTop;

        // Helper: Check if we need a new page
        function checkPageBreak(neededHeight) {
            if (y + neededHeight > pageHeight - marginBottom) {
                doc.addPage();
                y = marginTop;
                return true;
            }
            return false;
        }

        // Helper: Draw section label (uppercase, gray, small)
        function drawSectionLabel(text) {
            doc.setFontSize(9);
            doc.setTextColor(...mediumGray);
            doc.setFont('helvetica', 'bold');
            doc.text(text.toUpperCase(), marginLeft, y);
            y += 16;
        }

        // Helper: Truncate text with ellipsis
        function truncateText(text, maxWidth, fontSize) {
            if (!text) return '';
            doc.setFontSize(fontSize);
            const fullWidth = doc.getTextWidth(text);
            if (fullWidth <= maxWidth) return text;
            let truncated = text;
            while (doc.getTextWidth(truncated + '...') > maxWidth && truncated.length > 0) {
                truncated = truncated.slice(0, -1);
            }
            return truncated + '...';
        }

        // Helper: Draw rounded rectangle
        function roundedRect(x, y, w, h, r, style) {
            doc.roundedRect(x, y, w, h, r, r, style);
        }

        // ========== HEADER ==========
        // Teal accent bar at top (8px = ~6pt)
        doc.setFillColor(...teal);
        doc.rect(marginLeft, y, contentWidth, 6, 'F');
        y += 20;

        // "BevAlc Intelligence" on left
        doc.setFontSize(11);
        doc.setTextColor(...teal);
        doc.setFont('helvetica', 'bold');
        doc.text('BevAlc Intelligence', marginLeft, y);

        // "COMPANY REPORT" on right
        doc.setFontSize(9);
        doc.setTextColor(...lightGray);
        doc.setFont('helvetica', 'normal');
        doc.text('COMPANY REPORT', pageWidth - marginRight, y, { align: 'right' });
        y += 24;

        // Company name (large, bold, wraps if needed)
        doc.setFontSize(22);
        doc.setTextColor(...black);
        doc.setFont('helvetica', 'bold');
        const companyName = tearsheet.company_name || 'Company';
        const companyNameLines = doc.splitTextToSize(companyName, contentWidth);
        doc.text(companyNameLines, marginLeft, y);
        y += companyNameLines.length * 26 + 10;

        // Website (clickable link) on left
        const websiteUrl = tearsheet.website?.url || '';
        const websiteDisplay = websiteUrl
            ? websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
            : 'No website found';

        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        if (websiteUrl) {
            doc.setTextColor(...teal);
            const linkWidth = doc.getTextWidth(websiteDisplay);
            doc.textWithLink(websiteDisplay, marginLeft, y, { url: websiteUrl });
            // Add underline for link appearance
            doc.setDrawColor(...teal);
            doc.setLineWidth(0.5);
            doc.line(marginLeft, y + 2, marginLeft + linkWidth, y + 2);
        } else {
            doc.setTextColor(...lightGray);
            doc.text(websiteDisplay, marginLeft, y);
        }

        // Filing range on right
        const filingRange = stats.first_filing ? `Filing since ${stats.first_filing}` : '';
        if (filingRange) {
            doc.setTextColor(...mediumGray);
            doc.setFontSize(10);
            doc.text(filingRange, pageWidth - marginRight, y, { align: 'right' });
        }
        y += 28;

        // ========== SUMMARY ==========
        if (tearsheet.summary) {
            checkPageBreak(120);

            // Calculate text lines first to determine box height
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            const summaryLines = doc.splitTextToSize(tearsheet.summary, contentWidth - 40);
            const boxPadding = 16;
            const labelHeight = 20;
            const textLineHeight = 15;
            const boxHeight = boxPadding + labelHeight + (summaryLines.length * textLineHeight) + boxPadding;

            // Background box with border
            doc.setFillColor(...bgGray);
            doc.setDrawColor(...borderGray);
            doc.setLineWidth(1);
            roundedRect(marginLeft, y, contentWidth, boxHeight, 6, 'FD');

            // "SUMMARY" label inside box
            doc.setFontSize(9);
            doc.setTextColor(...mediumGray);
            doc.setFont('helvetica', 'bold');
            doc.text('SUMMARY', marginLeft + boxPadding, y + boxPadding + 10);

            // Summary text
            doc.setFontSize(11);
            doc.setTextColor(...darkGray);
            doc.setFont('helvetica', 'normal');
            doc.text(summaryLines, marginLeft + boxPadding, y + boxPadding + labelHeight + 10);

            y += boxHeight + 20;
        }

        // ========== RECENT NEWS ==========
        if (news.length > 0) {
            checkPageBreak(80);
            drawSectionLabel('Recent News');

            // Sort news by date (most recent first)
            const sortedNews = [...news].sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date(0);
                const dateB = b.date ? new Date(b.date) : new Date(0);
                return dateB - dateA;
            });

            sortedNews.slice(0, 3).forEach(n => {
                checkPageBreak(40);

                // News headline in teal with quotes (clickable if URL exists)
                doc.setFontSize(11);
                doc.setFont('helvetica', 'normal');
                const headline = `"${n.title || ''}"`;
                const truncatedHeadline = truncateText(headline, contentWidth - 20, 11);

                if (n.url) {
                    doc.setTextColor(...teal);
                    const linkWidth = doc.getTextWidth(truncatedHeadline);
                    doc.textWithLink(truncatedHeadline, marginLeft, y, { url: n.url });
                } else {
                    doc.setTextColor(...teal);
                    doc.text(truncatedHeadline, marginLeft, y);
                }
                y += 14;

                // Source and date in smaller gray text
                doc.setFontSize(9);
                doc.setTextColor(...lightGray);
                const sourceDate = `${n.source || ''} \u2022 ${n.date || ''}`;
                doc.text(sourceDate, marginLeft, y);
                y += 16;
            });
            y += 8;
        }

        // ========== KEY METRICS ==========
        checkPageBreak(100);
        drawSectionLabel('Key Metrics');

        const metricBoxWidth = (contentWidth - 24) / 3;  // 3 boxes with 12pt gaps
        const metricBoxHeight = 70;
        const metrics = [
            { value: stats.total_filings || 0, label: 'TOTAL FILINGS' },
            { value: brands.length, label: 'BRANDS' },
            { value: stats.last_12_months || 0, label: 'LAST 12 MO' }
        ];

        metrics.forEach((m, i) => {
            const boxX = marginLeft + i * (metricBoxWidth + 12);

            // Box with border
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(...borderGray);
            doc.setLineWidth(1);
            roundedRect(boxX, y, metricBoxWidth, metricBoxHeight, 6, 'FD');

            // Large number centered
            doc.setFontSize(32);
            doc.setTextColor(...teal);
            doc.setFont('helvetica', 'bold');
            const valueStr = String(m.value);
            const valueWidth = doc.getTextWidth(valueStr);
            doc.text(valueStr, boxX + (metricBoxWidth - valueWidth) / 2, y + 38);

            // Label centered below
            doc.setFontSize(8);
            doc.setTextColor(...mediumGray);
            doc.setFont('helvetica', 'normal');
            const labelWidth = doc.getTextWidth(m.label);
            doc.text(m.label, boxX + (metricBoxWidth - labelWidth) / 2, y + 55);
        });
        y += metricBoxHeight + 24;

        // ========== CATEGORY MIX ==========
        // Group subcategories into parent categories using getCategoryName
        const categoryGroups = {};
        for (const [code, count] of Object.entries(categories)) {
            const parentCategory = (typeof getCategoryName === 'function')
                ? getCategoryName(code)
                : code;
            categoryGroups[parentCategory] = (categoryGroups[parentCategory] || 0) + count;
        }
        const catEntries = Object.entries(categoryGroups).sort((a, b) => b[1] - a[1]);

        if (catEntries.length > 0) {
            checkPageBreak(120);
            drawSectionLabel('Category Mix');

            const totalCat = catEntries.reduce((sum, [, count]) => sum + count, 0);
            const labelWidth = 110;
            const pctWidth = 40;
            const barMaxWidth = contentWidth - labelWidth - pctWidth - 10;

            catEntries.slice(0, 5).forEach(([categoryName, count]) => {
                checkPageBreak(20);
                const pct = Math.round((count / totalCat) * 100);

                // Category label (left-aligned)
                doc.setFontSize(10);
                doc.setTextColor(...darkGray);
                doc.setFont('helvetica', 'normal');
                const label = truncateText(categoryName, labelWidth - 10, 10);
                doc.text(label, marginLeft, y);

                // Progress bar background
                const barX = marginLeft + labelWidth;
                const barY = y - 9;
                const barHeight = 14;
                doc.setFillColor(...borderGray);
                roundedRect(barX, barY, barMaxWidth, barHeight, 3, 'F');

                // Progress bar fill
                const fillWidth = Math.max((pct / 100) * barMaxWidth, 4);
                doc.setFillColor(...teal);
                roundedRect(barX, barY, fillWidth, barHeight, 3, 'F');

                // Percentage on right
                doc.setTextColor(...mediumGray);
                doc.text(`${pct}%`, pageWidth - marginRight, y, { align: 'right' });

                y += 20;
            });
            y += 8;
        }

        // ========== TOP BRANDS ==========
        if (brands.length > 0) {
            checkPageBreak(80);
            drawSectionLabel('Top Brands');

            let pillX = marginLeft;
            const pillHeight = 20;
            const pillPaddingH = 10;
            const pillGap = 6;
            const pillRowGap = 8;  // Vertical gap between rows
            y += 4;  // Extra space after section label
            let currentRowY = y;

            brands.slice(0, 10).forEach(b => {
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                const pillText = `${b.name} (${b.filings})`;
                const truncatedPill = truncateText(pillText, 140, 9);
                const textWidth = doc.getTextWidth(truncatedPill);
                const pillWidth = textWidth + pillPaddingH * 2;

                // Check if pill fits on current line
                if (pillX + pillWidth > pageWidth - marginRight) {
                    pillX = marginLeft;
                    currentRowY += pillHeight + pillRowGap;
                    checkPageBreak(pillHeight + pillRowGap);
                }

                // Pill background (light teal)
                doc.setFillColor(240, 253, 250);
                doc.setDrawColor(153, 246, 228);
                doc.setLineWidth(1);
                roundedRect(pillX, currentRowY, pillWidth, pillHeight, 10, 'FD');

                // Pill text (vertically centered in pill)
                doc.setTextColor(...teal);
                doc.text(truncatedPill, pillX + pillPaddingH, currentRowY + 13);

                pillX += pillWidth + pillGap;
            });
            y = currentRowY + pillHeight + 16;
        }

        // ========== RECENT FILINGS TABLE ==========
        if (recentFilings.length > 0) {
            checkPageBreak(200);
            drawSectionLabel('Recent Filings');

            // Table dimensions
            const colWidths = [
                contentWidth * 0.30,  // Brand
                contentWidth * 0.28,  // Product
                contentWidth * 0.20,  // Date
                contentWidth * 0.22   // Signal
            ];
            const rowHeight = 26;
            const headerHeight = 28;
            const numRows = Math.min(recentFilings.length, 8);
            const tableHeight = headerHeight + (numRows * rowHeight);

            // Table border
            doc.setDrawColor(...borderGray);
            doc.setLineWidth(1);
            roundedRect(marginLeft, y, contentWidth, tableHeight, 6, 'S');

            // Header row background
            doc.setFillColor(249, 250, 251);
            // Draw header with rounded top corners only
            doc.roundedRect(marginLeft + 0.5, y + 0.5, contentWidth - 1, headerHeight - 0.5, 5, 5, 'F');
            doc.setFillColor(249, 250, 251);
            doc.rect(marginLeft + 0.5, y + headerHeight - 6, contentWidth - 1, 6, 'F');

            // Header text
            const headers = ['BRAND', 'PRODUCT', 'DATE', 'SIGNAL'];
            let headerX = marginLeft + 10;
            doc.setFontSize(8);
            doc.setTextColor(...mediumGray);
            doc.setFont('helvetica', 'bold');
            headers.forEach((h, i) => {
                doc.text(h, headerX, y + 18);
                headerX += colWidths[i];
            });

            // Header bottom border
            doc.setDrawColor(...borderGray);
            doc.line(marginLeft, y + headerHeight, marginLeft + contentWidth, y + headerHeight);

            let tableY = y + headerHeight;

            // Data rows
            recentFilings.slice(0, 8).forEach((f, rowIndex) => {
                // Alternating row background
                if (rowIndex % 2 === 1) {
                    doc.setFillColor(249, 250, 251);
                    doc.rect(marginLeft + 1, tableY, contentWidth - 2, rowHeight, 'F');
                }

                let cellX = marginLeft + 10;
                const cellY = tableY + 17;

                // Brand
                doc.setFontSize(10);
                doc.setTextColor(...darkGray);
                doc.setFont('helvetica', 'normal');
                const brandText = truncateText(f.brand || '', colWidths[0] - 15, 10);
                doc.text(brandText, cellX, cellY);
                cellX += colWidths[0];

                // Product (em dash if empty)
                const productText = f.product && f.product.trim()
                    ? truncateText(f.product, colWidths[1] - 15, 10)
                    : '\u2014';
                if (productText === '\u2014') {
                    doc.setTextColor(...lightGray);
                } else {
                    doc.setTextColor(...darkGray);
                }
                doc.text(productText, cellX, cellY);
                cellX += colWidths[1];

                // Date
                doc.setTextColor(...darkGray);
                doc.text(f.date || '', cellX, cellY);
                cellX += colWidths[2];

                // Signal badge
                const signal = f.signal || 'REFILE';
                const signalText = signal.replace('_', ' ');
                let badgeBg, badgeText;
                switch (signal) {
                    case 'NEW_COMPANY':
                        badgeBg = [220, 252, 231]; badgeText = [22, 101, 52]; break;
                    case 'NEW_BRAND':
                        badgeBg = [219, 234, 254]; badgeText = [30, 64, 175]; break;
                    case 'NEW_SKU':
                        badgeBg = [240, 253, 250]; badgeText = [13, 148, 136]; break;
                    default:
                        badgeBg = [243, 244, 246]; badgeText = [107, 114, 128];
                }

                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');
                const badgeTextWidth = doc.getTextWidth(signalText);
                const badgeWidth = badgeTextWidth + 12;
                const badgeHeight = 16;
                const badgeY = tableY + 6;

                doc.setFillColor(...badgeBg);
                roundedRect(cellX, badgeY, badgeWidth, badgeHeight, 3, 'F');
                doc.setTextColor(...badgeText);
                doc.text(signalText, cellX + 6, badgeY + 11);

                // Row bottom border (except last row)
                if (rowIndex < numRows - 1) {
                    doc.setDrawColor(...borderGray);
                    doc.line(marginLeft, tableY + rowHeight, marginLeft + contentWidth, tableY + rowHeight);
                }

                tableY += rowHeight;
            });

            y = tableY + 20;
        }

        // ========== FOOTER ==========
        // Position footer at bottom of page or after content
        const footerY = Math.max(y + 30, pageHeight - marginBottom - 20);

        // If footer would go past page, it's already on content - just use current y
        const actualFooterY = footerY > pageHeight - marginBottom ? y + 30 : footerY;

        // Separator line
        doc.setDrawColor(...borderGray);
        doc.setLineWidth(1);
        doc.line(marginLeft, actualFooterY, pageWidth - marginRight, actualFooterY);

        // Footer text
        doc.setFontSize(9);
        doc.setTextColor(...lightGray);
        doc.setFont('helvetica', 'normal');
        doc.text('BevAlc Intelligence \u2022 bevalcintel.com', marginLeft, actualFooterY + 16);

        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        doc.text(`Generated ${today}`, pageWidth - marginRight, actualFooterY + 16, { align: 'right' });

        // Save the PDF
        const filename = `${(tearsheet.company_name || 'company').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_report.pdf`;
        doc.save(filename);
        console.log('PDF: Download complete for', tearsheet.company_name);

    } catch (error) {
        console.error('PDF generation error:', error);
        alert('Failed to generate PDF: ' + error.message);
    }
}

function showCreditPurchaseModal(isPro) {
    const existing = document.getElementById('credit-purchase-modal');
    if (existing) existing.remove();

    // Pro users get better rates
    const packs = isPro ? [
        { id: 'pro_8_credits', credits: 8, price: '$10', perCredit: '$1.25' },
        { id: 'pro_20_credits', credits: 20, price: '$25', perCredit: '$1.25', best: true }
    ] : [
        { id: 'free_5_credits', credits: 5, price: '$10', perCredit: '$2.00' },
        { id: 'free_15_credits', credits: 15, price: '$25', perCredit: '$1.67', best: true }
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

            ${!isPro ? `
                <p style="margin-top: 16px; font-size: 0.8rem; color: #64748b; text-align: center;">
                    <a href="/#pricing" style="color: var(--color-primary);">Upgrade to Pro ($79/mo)</a> for 25% off credits
                </p>
            ` : ''}
        </div>
    `;
    document.body.appendChild(modal);
}

async function purchaseCredits(packId) {
    // TODO: Implement Stripe checkout for credit packs
    alert('Credit purchase coming soon! Pack: ' + packId);
}

// Load user's credit balance when modal opens
async function loadCreditBalance(email) {
    if (!email) return;

    try {
        const response = await fetch(`${API_BASE}/api/credits?email=${encodeURIComponent(email)}`);
        const data = await response.json();

        if (data.success) {
            const balanceEl = document.getElementById('credit-balance');
            if (balanceEl) {
                if (data.credits > 0) {
                    balanceEl.textContent = `You have ${data.credits} credit${data.credits !== 1 ? 's' : ''}`;
                } else {
                    balanceEl.innerHTML = `<a href="#" onclick="showCreditPurchaseModal(${data.is_pro}); return false;" style="color: var(--color-primary);">Get credits</a>`;
                }
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

        const dateFrom = elements.filterDateFrom.value;
        if (dateFrom) params.append('date_from', dateFrom);

        const dateTo = elements.filterDateTo.value;
        if (dateTo) params.append('date_to', dateTo);

        const response = await fetch(`${API_BASE}/api/export?${params}`);
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