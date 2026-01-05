/* ============================================
   BevAlc Intelligence - Database App
   Optimized for large datasets with monthly chunking
   ============================================ */

// Configuration
const CONFIG = {
    DATA_PATH: 'data/',              // Folder containing monthly JSON files
    INDEX_FILE: 'data/index.json',   // Metadata about available data
    ITEMS_PER_PAGE: 50,
    MAX_LOADED_MONTHS: 12,           // Limit memory usage
    DEBOUNCE_MS: 300
};

// State
const state = {
    index: null,                     // Metadata: available months, filters
    loadedMonths: new Map(),         // Cache: 'YYYY-MM' -> array of records
    loadingMonths: new Set(),        // Currently loading
    allData: [],                     // Combined data from loaded months
    filteredData: [],
    currentPage: 1,
    selectedMonths: [],              // Which months user wants to view
    isInitialLoad: true
};

// DOM Elements
const elements = {};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
    // Check access
    if (!window.BevAlcAuth?.hasAccess()) {
        window.location.href = 'index.html';
        return;
    }
    
    cacheElements();
    setupEventListeners();
    await initialize();
});

function cacheElements() {
    elements.searchInput = document.getElementById('search-input');
    elements.filterOrigin = document.getElementById('filter-origin');
    elements.filterClass = document.getElementById('filter-class');
    elements.filterStatus = document.getElementById('filter-status');
    elements.monthSelector = document.getElementById('month-selector');
    elements.clearFilters = document.getElementById('clear-filters');
    elements.resultsCount = document.getElementById('results-count');
    elements.resultsContainer = document.getElementById('results-container');
    elements.pagination = document.getElementById('pagination');
    elements.modalOverlay = document.getElementById('modal-overlay');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalSubtitle = document.getElementById('modal-subtitle');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalClose = document.getElementById('modal-close');
    elements.loadingOverlay = document.getElementById('loading-overlay');
    elements.loadingText = document.getElementById('loading-text');
    elements.dataStats = document.getElementById('data-stats');
}

async function initialize() {
    showLoading('Loading database index...');
    
    try {
        // Load the index file first
        state.index = await fetchJSON(CONFIG.INDEX_FILE);
        
        // Populate month selector
        populateMonthSelector();
        
        // Populate filter dropdowns
        populateFilters();
        
        // Default: load most recent month
        const latestMonth = state.index.months[0];
        if (latestMonth) {
            state.selectedMonths = [latestMonth.key];
            await loadMonthData(latestMonth.key);
        }
        
        // Update stats display
        updateDataStats();
        
        // Initial render
        applyFilters();
        
    } catch (error) {
        console.error('Failed to initialize:', error);
        showError('Failed to load database. Please refresh the page.');
    } finally {
        hideLoading();
        state.isInitialLoad = false;
    }
}

// ============================================
// DATA LOADING
// ============================================

async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return response.json();
}

async function loadMonthData(monthKey) {
    // Already loaded?
    if (state.loadedMonths.has(monthKey)) return;
    
    // Already loading?
    if (state.loadingMonths.has(monthKey)) return;
    
    state.loadingMonths.add(monthKey);
    showLoading(`Loading ${formatMonthKey(monthKey)}...`);
    
    try {
        const data = await fetchJSON(`${CONFIG.DATA_PATH}${monthKey}.json`);
        state.loadedMonths.set(monthKey, data.colas || []);
        
        // Manage memory - remove oldest if too many loaded
        if (state.loadedMonths.size > CONFIG.MAX_LOADED_MONTHS) {
            const oldestKey = state.loadedMonths.keys().next().value;
            if (!state.selectedMonths.includes(oldestKey)) {
                state.loadedMonths.delete(oldestKey);
            }
        }
        
        rebuildAllData();
        
    } catch (error) {
        console.error(`Failed to load ${monthKey}:`, error);
        showToast(`Failed to load data for ${formatMonthKey(monthKey)}`, 'error');
    } finally {
        state.loadingMonths.delete(monthKey);
        hideLoading();
    }
}

async function loadSelectedMonths() {
    showLoading('Loading selected data...');
    
    const promises = state.selectedMonths.map(async (monthKey) => {
        if (!state.loadedMonths.has(monthKey)) {
            await loadMonthData(monthKey);
        }
    });
    
    await Promise.all(promises);
    rebuildAllData();
    applyFilters();
    hideLoading();
}

function rebuildAllData() {
    // Combine all loaded months that are selected
    state.allData = [];
    
    state.selectedMonths.forEach(monthKey => {
        const monthData = state.loadedMonths.get(monthKey);
        if (monthData) {
            state.allData = state.allData.concat(monthData);
        }
    });
    
    // Sort by approval date descending (newest first)
    state.allData.sort((a, b) => {
        const dateA = parseDate(a.approval_date);
        const dateB = parseDate(b.approval_date);
        if (!dateA || !dateB) return 0;
        return dateB - dateA;
    });
    
    updateDataStats();
}

// ============================================
// UI POPULATION
// ============================================

function populateMonthSelector() {
    if (!elements.monthSelector || !state.index?.months) return;
    
    elements.monthSelector.innerHTML = '';
    
    state.index.months.forEach((month, idx) => {
        const option = document.createElement('option');
        option.value = month.key;
        option.textContent = `${formatMonthKey(month.key)} (${month.count.toLocaleString()} records)`;
        if (idx === 0) option.selected = true;
        elements.monthSelector.appendChild(option);
    });
}

function populateFilters() {
    if (!state.index?.filters) return;
    
    const { origins, class_types, statuses } = state.index.filters;
    
    // Origins
    if (origins && elements.filterOrigin) {
        origins.sort().forEach(origin => {
            if (origin) {
                const option = document.createElement('option');
                option.value = origin;
                option.textContent = origin;
                elements.filterOrigin.appendChild(option);
            }
        });
    }
    
    // Class/Types
    if (class_types && elements.filterClass) {
        class_types.sort().forEach(type => {
            if (type) {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                elements.filterClass.appendChild(option);
            }
        });
    }
    
    // Statuses
    if (statuses && elements.filterStatus) {
        statuses.sort().forEach(status => {
            if (status) {
                const option = document.createElement('option');
                option.value = status;
                option.textContent = status;
                elements.filterStatus.appendChild(option);
            }
        });
    }
}

function updateDataStats() {
    if (!elements.dataStats) return;
    
    const totalRecords = state.index?.total_records || 0;
    const loadedRecords = state.allData.length;
    const monthsLoaded = state.selectedMonths.length;
    
    elements.dataStats.innerHTML = `
        <span class="stat-item">
            <strong>${loadedRecords.toLocaleString()}</strong> records loaded
        </span>
        <span class="stat-divider">•</span>
        <span class="stat-item">
            <strong>${monthsLoaded}</strong> month${monthsLoaded !== 1 ? 's' : ''} selected
        </span>
        <span class="stat-divider">•</span>
        <span class="stat-item">
            <strong>${totalRecords.toLocaleString()}</strong> total in database
        </span>
    `;
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Search with debounce
    let searchTimeout;
    elements.searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.currentPage = 1;
            applyFilters();
        }, CONFIG.DEBOUNCE_MS);
    });
    
    // Filters
    elements.filterOrigin?.addEventListener('change', () => { state.currentPage = 1; applyFilters(); });
    elements.filterClass?.addEventListener('change', () => { state.currentPage = 1; applyFilters(); });
    elements.filterStatus?.addEventListener('change', () => { state.currentPage = 1; applyFilters(); });
    
    // Month selector (multi-select)
    elements.monthSelector?.addEventListener('change', handleMonthChange);
    
    // Clear filters
    elements.clearFilters?.addEventListener('click', clearAllFilters);
    
    // Modal
    elements.modalClose?.addEventListener('click', closeModal);
    elements.modalOverlay?.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

async function handleMonthChange() {
    const selected = Array.from(elements.monthSelector.selectedOptions).map(opt => opt.value);
    
    if (selected.length === 0) {
        showToast('Please select at least one month', 'warning');
        return;
    }
    
    if (selected.length > CONFIG.MAX_LOADED_MONTHS) {
        showToast(`Maximum ${CONFIG.MAX_LOADED_MONTHS} months can be loaded at once`, 'warning');
        return;
    }
    
    state.selectedMonths = selected;
    state.currentPage = 1;
    await loadSelectedMonths();
}

// ============================================
// FILTERING & SEARCH
// ============================================

function applyFilters() {
    const search = elements.searchInput?.value.toLowerCase().trim() || '';
    const origin = elements.filterOrigin?.value || '';
    const classType = elements.filterClass?.value || '';
    const status = elements.filterStatus?.value || '';
    
    state.filteredData = state.allData.filter(cola => {
        // Search across multiple fields
        if (search) {
            const searchFields = [
                cola.brand_name,
                cola.fanciful_name,
                cola.ttb_id,
                cola.company_name,
                cola.class_type_code,
                cola.origin_code
            ].map(f => (f || '').toLowerCase());
            
            if (!searchFields.some(f => f.includes(search))) {
                return false;
            }
        }
        
        // Origin filter
        if (origin && cola.origin_code !== origin) return false;
        
        // Class/Type filter
        if (classType && cola.class_type_code !== classType) return false;
        
        // Status filter
        if (status && cola.status !== status) return false;
        
        return true;
    });
    
    renderResults();
    renderPagination();
}

function clearAllFilters() {
    if (elements.searchInput) elements.searchInput.value = '';
    if (elements.filterOrigin) elements.filterOrigin.value = '';
    if (elements.filterClass) elements.filterClass.value = '';
    if (elements.filterStatus) elements.filterStatus.value = '';
    state.currentPage = 1;
    applyFilters();
}

// ============================================
// RENDERING
// ============================================

function renderResults() {
    const start = (state.currentPage - 1) * CONFIG.ITEMS_PER_PAGE;
    const end = start + CONFIG.ITEMS_PER_PAGE;
    const pageData = state.filteredData.slice(start, end);
    
    // Update count
    elements.resultsCount.textContent = `${state.filteredData.length.toLocaleString()} results`;
    
    if (pageData.length === 0) {
        elements.resultsContainer.innerHTML = `
            <div class="no-results">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <h3>No results found</h3>
                <p>Try adjusting your search or filters, or load more months</p>
            </div>
        `;
        return;
    }
    
    const table = document.createElement('table');
    table.className = 'results-table';
    
    table.innerHTML = `
        <thead>
            <tr>
                <th>TTB ID</th>
                <th>Brand Name</th>
                <th>Fanciful Name</th>
                <th>Class/Type</th>
                <th>Origin</th>
                <th>Approval Date</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${pageData.map(cola => `
                <tr data-ttb-id="${escapeHtml(cola.ttb_id || '')}">
                    <td class="ttb-id">${escapeHtml(cola.ttb_id || '-')}</td>
                    <td class="brand-name">${escapeHtml(cola.brand_name || '-')}</td>
                    <td>${escapeHtml(cola.fanciful_name || '-')}</td>
                    <td>${escapeHtml(cola.class_type_code || '-')}</td>
                    <td>${escapeHtml(cola.origin_code || '-')}</td>
                    <td>${escapeHtml(cola.approval_date || '-')}</td>
                    <td><span class="status-badge status-${(cola.status || '').toLowerCase()}">${escapeHtml(cola.status || '-')}</span></td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    // Add click handlers for row details
    table.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', () => {
            const ttbId = row.dataset.ttbId;
            const cola = state.allData.find(c => c.ttb_id === ttbId);
            if (cola) openModal(cola);
        });
    });
    
    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(table);
}

function renderPagination() {
    const totalPages = Math.ceil(state.filteredData.length / CONFIG.ITEMS_PER_PAGE);
    
    if (totalPages <= 1) {
        elements.pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `<button class="page-btn" ${state.currentPage === 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
        </svg>
        Prev
    </button>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="page-btn" data-page="1">1</button>`;
        if (startPage > 2) html += `<span class="page-ellipsis">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === state.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-ellipsis">...</span>`;
        html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="page-btn" ${state.currentPage === totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">
        Next
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
        </svg>
    </button>`;
    
    // Page info
    const start = (state.currentPage - 1) * CONFIG.ITEMS_PER_PAGE + 1;
    const end = Math.min(state.currentPage * CONFIG.ITEMS_PER_PAGE, state.filteredData.length);
    html += `<span class="page-info">Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${state.filteredData.length.toLocaleString()}</span>`;
    
    elements.pagination.innerHTML = html;
    
    // Add click handlers
    elements.pagination.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page && page !== state.currentPage && !btn.disabled) {
                state.currentPage = page;
                renderResults();
                renderPagination();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    });
}

// ============================================
// MODAL
// ============================================

function openModal(cola) {
    elements.modalTitle.textContent = cola.brand_name || 'Unknown Brand';
    elements.modalSubtitle.textContent = `TTB ID: ${cola.ttb_id}`;
    
    const mainFields = [
        { label: 'Status', value: cola.status, highlight: true },
        { label: 'Approval Date', value: cola.approval_date },
        { label: 'Fanciful Name', value: cola.fanciful_name },
        { label: 'Class/Type', value: cola.class_type_code },
        { label: 'Origin', value: cola.origin_code },
        { label: 'Type of Application', value: cola.type_of_application },
    ];
    
    const detailFields = [
        { label: 'Vendor Code', value: cola.vendor_code },
        { label: 'Serial Number', value: cola.serial_number },
        { label: 'Total Bottle Capacity', value: cola.total_bottle_capacity },
        { label: 'Formula', value: cola.formula },
        { label: 'For Sale In', value: cola.for_sale_in },
        { label: 'Qualifications', value: cola.qualifications },
        { label: 'Plant Registry', value: cola.plant_registry },
    ];
    
    const companyFields = [
        { label: 'Company Name', value: cola.company_name },
        { label: 'Street', value: cola.street },
        { label: 'State', value: cola.state },
        { label: 'Contact Person', value: cola.contact_person },
        { label: 'Phone Number', value: cola.phone_number },
    ];
    
    const wineFields = [
        { label: 'Grape Varietal', value: cola.grape_varietal },
        { label: 'Vintage', value: cola.wine_vintage },
        { label: 'Appellation', value: cola.appellation },
        { label: 'Alcohol Content', value: cola.alcohol_content },
        { label: 'pH Level', value: cola.ph_level },
    ].filter(f => f.value);
    
    let html = '<div class="modal-content">';
    
    // Main info section
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">Label Information</h4>';
    html += '<div class="detail-grid">';
    mainFields.forEach(field => {
        html += renderDetailField(field);
    });
    html += '</div></div>';
    
    // Product details
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">Product Details</h4>';
    html += '<div class="detail-grid">';
    detailFields.forEach(field => {
        html += renderDetailField(field);
    });
    html += '</div></div>';
    
    // Company info
    html += '<div class="detail-section">';
    html += '<h4 class="detail-section-title">Company Information</h4>';
    html += '<div class="detail-grid">';
    companyFields.forEach(field => {
        html += renderDetailField(field);
    });
    html += '</div></div>';
    
    // Wine details (if applicable)
    if (wineFields.length > 0) {
        html += '<div class="detail-section wine-section">';
        html += '<h4 class="detail-section-title">🍷 Wine Details</h4>';
        html += '<div class="detail-grid">';
        wineFields.forEach(field => {
            html += renderDetailField(field);
        });
        html += '</div></div>';
    }
    
    html += '</div>';
    
    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function renderDetailField(field) {
    const value = field.value || '-';
    const highlightClass = field.highlight ? 'highlight' : '';
    return `
        <div class="detail-item ${highlightClass}">
            <span class="detail-label">${escapeHtml(field.label)}</span>
            <span class="detail-value">${escapeHtml(value)}</span>
        </div>
    `;
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// UTILITIES
// ============================================

function parseDate(dateStr) {
    if (!dateStr) return null;
    
    // MM/DD/YYYY
    let match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
        return new Date(match[3], match[1] - 1, match[2]);
    }
    
    // YYYY-MM-DD
    match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return new Date(match[1], match[2] - 1, match[3]);
    }
    
    return new Date(dateStr);
}

function formatMonthKey(key) {
    // Convert '2025-01' to 'January 2025'
    const [year, month] = key.split('-');
    const date = new Date(year, parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading(message = 'Loading...') {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.add('active');
        if (elements.loadingText) {
            elements.loadingText.textContent = message;
        }
    }
}

function hideLoading() {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.remove('active');
    }
}

function showError(message) {
    elements.resultsContainer.innerHTML = `
        <div class="error-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 8v4M12 16h.01"></path>
            </svg>
            <h3>Error</h3>
            <p>${escapeHtml(message)}</p>
            <button class="btn btn-primary" onclick="location.reload()">Refresh Page</button>
        </div>
    `;
}

function showToast(message, type = 'info') {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
