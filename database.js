/**
 * BevAlc Intelligence - Database Page
 * Handles search, filters, pagination, and data display
 */

// Configuration
const API_BASE = 'https://bevalc-api.mac-rowan.workers.dev';
const ITEMS_PER_PAGE = 50;

// State
const state = {
    currentPage: 1,
    totalPages: 0,
    totalRecords: 0,
    isLoading: false,
    hasAccess: false,
    filters: {
        origins: [],
        class_types: [],
        statuses: []
    }
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
    await performSearch();
});

function cacheElements() {
    elements.searchInput = document.getElementById('search-input');
    elements.searchBtn = document.getElementById('search-btn');
    elements.filterOrigin = document.getElementById('filter-origin');
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
    elements.exportBtn = document.getElementById('export-btn');
}

function checkAccess() {
    // Check for access cookie or URL parameter
    const hasAccessCookie = document.cookie.includes('bevalc_access=granted');
    const urlParams = new URLSearchParams(window.location.search);
    const accessParam = urlParams.get('access') === 'granted';
    
    // Check localStorage for user info
    const userInfo = localStorage.getItem('bevalc_user');
    
    if (accessParam) {
        // Set cookie from URL parameter
        document.cookie = 'bevalc_access=granted; path=/; max-age=31536000; SameSite=Lax';
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        state.hasAccess = true;
    } else if (hasAccessCookie) {
        state.hasAccess = true;
    }
    
    // Update UI based on access
    if (state.hasAccess) {
        elements.blurOverlay.style.display = 'none';
        elements.navSignup.style.display = 'none';
        
        // Show user greeting if we have their info
        if (userInfo) {
            try {
                const user = JSON.parse(userInfo);
                if (user.firstName) {
                    elements.userGreeting.textContent = `Hi, ${user.firstName}`;
                    elements.userGreeting.style.display = 'inline';
                }
            } catch (e) {}
        }
    } else {
        elements.blurOverlay.style.display = 'flex';
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
    
    // Filters
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
            limit: ITEMS_PER_PAGE
        });
        
        const query = elements.searchInput.value.trim();
        if (query) params.append('q', query);
        
        const origin = elements.filterOrigin.value;
        if (origin) params.append('origin', origin);
        
        const classType = elements.filterClass.value;
        if (classType) params.append('class_type', classType);
        
        const status = elements.filterStatus.value;
        if (status) params.append('status', status);
        
        const dateFrom = elements.filterDateFrom.value;
        if (dateFrom) params.append('date_from', dateFrom);
        
        const dateTo = elements.filterDateTo.value;
        if (dateTo) params.append('date_to', dateTo);
        
        const response = await fetch(`${API_BASE}/api/search?${params}`);
        const data = await response.json();
        
        if (data.success) {
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
    
    // Class/Types
    state.filters.class_types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        elements.filterClass.appendChild(option);
    });
    
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
    
    elements.resultsBody.innerHTML = data.map(cola => `
        <tr data-ttb-id="${escapeHtml(cola.ttb_id)}" class="clickable-row">
            <td class="cell-ttb-id">${escapeHtml(cola.ttb_id || '-')}</td>
            <td class="cell-brand">${escapeHtml(cola.brand_name || '-')}</td>
            <td class="cell-fanciful">${escapeHtml(cola.fanciful_name || '-')}</td>
            <td>${escapeHtml(cola.class_type_code || '-')}</td>
            <td>${escapeHtml(cola.origin_code || '-')}</td>
            <td>${escapeHtml(cola.approval_date || '-')}</td>
            <td><span class="status-badge status-${(cola.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(cola.status || '-')}</span></td>
        </tr>
    `).join('');
    
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
    elements.modalTitle.textContent = record.brand_name || 'Unknown Brand';
    elements.modalSubtitle.textContent = `TTB ID: ${record.ttb_id}`;
    
    const sections = [
        {
            title: 'Label Information',
            fields: [
                { label: 'Status', value: record.status },
                { label: 'Approval Date', value: record.approval_date },
                { label: 'Fanciful Name', value: record.fanciful_name },
                { label: 'Class/Type', value: record.class_type_code },
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
                { label: 'Formula', value: record.formula },
                { label: 'For Sale In', value: record.for_sale_in },
                { label: 'Qualifications', value: record.qualifications },
                { label: 'Plant Registry', value: record.plant_registry },
            ]
        },
        {
            title: 'Company Information',
            fields: [
                { label: 'Company Name', value: record.company_name },
                { label: 'Street', value: record.street },
                { label: 'State', value: record.state },
                { label: 'Contact Person', value: record.contact_person },
                { label: 'Phone Number', value: record.phone_number },
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
    
    sections.forEach(section => {
        html += `
            <div class="modal-section ${section.className || ''}">
                <h4>${section.title}</h4>
                <div class="detail-grid">
                    ${section.fields.map(f => `
                        <div class="detail-item">
                            <span class="detail-label">${f.label}</span>
                            <span class="detail-value">${escapeHtml(f.value || '-')}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// UTILITIES
// ============================================

function clearAllFilters() {
    elements.searchInput.value = '';
    elements.filterOrigin.value = '';
    elements.filterClass.value = '';
    elements.filterStatus.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
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

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
