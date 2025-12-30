/* ============================================
   BevAlc Intelligence - Database App
   ============================================ */

// State
let allData = [];
let filteredData = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 50;

// DOM Elements
const elements = {
    searchInput: null,
    filterState: null,
    filterClass: null,
    filterStatus: null,
    filterDateFrom: null,
    filterDateTo: null,
    clearFilters: null,
    resultsCount: null,
    resultsContainer: null,
    pagination: null,
    modalOverlay: null,
    modalTitle: null,
    modalSubtitle: null,
    modalBody: null,
    modalClose: null,
    saveSearchBtn: null,
    navUser: null
};

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    // Check access
    if (!window.BevAlcAuth?.hasAccess()) {
        window.location.href = 'index.html';
        return;
    }
    
    // Cache DOM elements
    cacheElements();
    
    // Show user name
    showUserName();
    
    // Set up event listeners
    setupEventListeners();
    
    // Load data
    await loadData();
});

function cacheElements() {
    elements.searchInput = document.getElementById('search-input');
    elements.filterState = document.getElementById('filter-state');
    elements.filterClass = document.getElementById('filter-class');
    elements.filterStatus = document.getElementById('filter-status');
    elements.filterDateFrom = document.getElementById('filter-date-from');
    elements.filterDateTo = document.getElementById('filter-date-to');
    elements.clearFilters = document.getElementById('clear-filters');
    elements.resultsCount = document.getElementById('results-count');
    elements.resultsContainer = document.getElementById('results-container');
    elements.pagination = document.getElementById('pagination');
    elements.modalOverlay = document.getElementById('modal-overlay');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalSubtitle = document.getElementById('modal-subtitle');
    elements.modalBody = document.getElementById('modal-body');
    elements.modalClose = document.getElementById('modal-close');
    elements.saveSearchBtn = document.getElementById('save-search-btn');
    elements.navUser = document.getElementById('nav-user');
}

function showUserName() {
    try {
        const user = JSON.parse(localStorage.getItem('bevalc_user') || '{}');
        if (user.name) {
            elements.navUser.querySelector('.user-name').textContent = user.name;
        }
    } catch (e) {
        console.error('Failed to get user:', e);
    }
}

function setupEventListeners() {
    // Search with debounce
    let searchTimeout;
    elements.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            applyFilters();
        }, 300);
    });
    
    // Filters
    elements.filterState.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterClass.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterStatus.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterDateFrom.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterDateTo.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    
    // Clear filters
    elements.clearFilters.addEventListener('click', clearAllFilters);
    
    // Modal
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });
    
    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
    
    // Save search
    elements.saveSearchBtn.addEventListener('click', saveCurrentSearch);
}

async function loadData() {
    try {
        const response = await fetch('colas.json');
        if (!response.ok) throw new Error('Failed to load data');
        
        const data = await response.json();
        allData = data.colas || [];
        
        // Populate filter dropdowns
        populateFilters(data.filters || {});
        
        // Initial display
        applyFilters();
        
    } catch (error) {
        console.error('Failed to load data:', error);
        elements.resultsContainer.innerHTML = `
            <div class="no-results">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8v4M12 16h.01"></path>
                </svg>
                <h3>Failed to load data</h3>
                <p>Please make sure colas.json exists in the web folder.</p>
            </div>
        `;
    }
}

function populateFilters(filters) {
    // States
    if (filters.states) {
        filters.states.sort().forEach(state => {
            if (state) {
                const option = document.createElement('option');
                option.value = state;
                option.textContent = state;
                elements.filterState.appendChild(option);
            }
        });
    }
    
    // Class/Types
    if (filters.class_types) {
        filters.class_types.sort().forEach(type => {
            if (type) {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                elements.filterClass.appendChild(option);
            }
        });
    }
    
    // Statuses
    if (filters.statuses) {
        filters.statuses.sort().forEach(status => {
            if (status) {
                const option = document.createElement('option');
                option.value = status;
                option.textContent = status;
                elements.filterStatus.appendChild(option);
            }
        });
    }
}

function applyFilters() {
    const search = elements.searchInput.value.toLowerCase().trim();
    const state = elements.filterState.value;
    const classType = elements.filterClass.value;
    const status = elements.filterStatus.value;
    const dateFrom = elements.filterDateFrom.value;
    const dateTo = elements.filterDateTo.value;
    
    filteredData = allData.filter(cola => {
        // Search
        if (search) {
            const searchFields = [
                cola.brand_name,
                cola.fanciful_name,
                cola.ttb_id,
                cola.company_name,
                cola.class_type_code
            ].map(f => (f || '').toLowerCase());
            
            if (!searchFields.some(f => f.includes(search))) {
                return false;
            }
        }
        
        // State filter
        if (state && cola.state !== state) return false;
        
        // Class/Type filter
        if (classType && cola.class_type_code !== classType) return false;
        
        // Status filter
        if (status && cola.status !== status) return false;
        
        // Date filters
        if (dateFrom && cola.approval_date) {
            const approvalDate = parseDate(cola.approval_date);
            if (approvalDate && approvalDate < new Date(dateFrom)) return false;
        }
        
        if (dateTo && cola.approval_date) {
            const approvalDate = parseDate(cola.approval_date);
            if (approvalDate && approvalDate > new Date(dateTo)) return false;
        }
        
        return true;
    });
    
    renderResults();
    renderPagination();
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    
    // Try different formats
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

function renderResults() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageData = filteredData.slice(start, end);
    
    // Update count
    elements.resultsCount.textContent = `${filteredData.length.toLocaleString()} results`;
    
    if (pageData.length === 0) {
        elements.resultsContainer.innerHTML = `
            <div class="no-results">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <h3>No results found</h3>
                <p>Try adjusting your search or filters</p>
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
                <th>State</th>
                <th>Approval Date</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${pageData.map(cola => `
                <tr data-ttb-id="${cola.ttb_id}">
                    <td>${cola.ttb_id || '-'}</td>
                    <td>${cola.brand_name || '-'}</td>
                    <td>${cola.fanciful_name || '-'}</td>
                    <td>${cola.class_type_code || '-'}</td>
                    <td>${cola.state || '-'}</td>
                    <td>${cola.approval_date || '-'}</td>
                    <td class="status-${(cola.status || '').toLowerCase()}">${cola.status || '-'}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    // Add click handlers
    table.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', () => {
            const ttbId = row.dataset.ttbId;
            const cola = allData.find(c => c.ttb_id === ttbId);
            if (cola) openModal(cola);
        });
    });
    
    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(table);
}

function renderPagination() {
    const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
    
    if (totalPages <= 1) {
        elements.pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    html += `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">← Prev</button>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<button data-page="1">1</button>`;
        if (startPage > 2) html += `<span>...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span>...</span>`;
        html += `<button data-page="${totalPages}">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next →</button>`;
    
    elements.pagination.innerHTML = html;
    
    // Add click handlers
    elements.pagination.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page && page !== currentPage) {
                currentPage = page;
                applyFilters();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    });
}

function openModal(cola) {
    elements.modalTitle.textContent = cola.brand_name || 'Unknown Brand';
    elements.modalSubtitle.textContent = `TTB ID: ${cola.ttb_id}`;
    
    const fields = [
        { label: 'Status', value: cola.status },
        { label: 'Fanciful Name', value: cola.fanciful_name },
        { label: 'Class/Type Code', value: cola.class_type_code },
        { label: 'Origin Code', value: cola.origin_code },
        { label: 'Type of Application', value: cola.type_of_application },
        { label: 'Approval Date', value: cola.approval_date },
        { label: 'Vendor Code', value: cola.vendor_code },
        { label: 'Serial Number', value: cola.serial_number },
        { label: 'Total Bottle Capacity', value: cola.total_bottle_capacity },
        { label: 'Formula', value: cola.formula },
        { label: 'For Sale In', value: cola.for_sale_in },
        { label: 'Qualifications', value: cola.qualifications },
        { label: 'Plant Registry', value: cola.plant_registry },
        { label: 'Company Name', value: cola.company_name },
        { label: 'Street', value: cola.street },
        { label: 'State', value: cola.state },
        { label: 'Contact Person', value: cola.contact_person },
        { label: 'Phone Number', value: cola.phone_number },
    ];
    
    let html = '<div class="detail-grid">';
    
    fields.forEach(field => {
        html += `
            <div class="detail-item">
                <span class="detail-label">${field.label}</span>
                <span class="detail-value">${field.value || '-'}</span>
            </div>
        `;
    });
    
    html += '</div>';
    
    // Add images if available
    if (cola.image_paths) {
        try {
            const paths = typeof cola.image_paths === 'string' 
                ? JSON.parse(cola.image_paths) 
                : cola.image_paths;
            
            if (paths && paths.length > 0) {
                html += `
                    <div class="detail-images">
                        <h4>Label Images</h4>
                        <div class="images-grid">
                            ${paths.map(path => `<img src="${path}" alt="Label image">`).join('')}
                        </div>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Failed to parse image paths:', e);
        }
    }
    
    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

function clearAllFilters() {
    elements.searchInput.value = '';
    elements.filterState.value = '';
    elements.filterClass.value = '';
    elements.filterStatus.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
    currentPage = 1;
    applyFilters();
}

function saveCurrentSearch() {
    const search = {
        query: elements.searchInput.value,
        state: elements.filterState.value,
        classType: elements.filterClass.value,
        status: elements.filterStatus.value,
        dateFrom: elements.filterDateFrom.value,
        dateTo: elements.filterDateTo.value,
        savedAt: new Date().toISOString()
    };
    
    // Prompt for name
    const name = prompt('Enter a name for this saved search:');
    if (!name) return;
    
    search.name = name;
    
    // Store in localStorage
    try {
        const saved = JSON.parse(localStorage.getItem('bevalc_saved_searches') || '[]');
        saved.push(search);
        localStorage.setItem('bevalc_saved_searches', JSON.stringify(saved));
        alert('Search saved!');
    } catch (e) {
        console.error('Failed to save search:', e);
        alert('Failed to save search. Please try again.');
    }
}

// Load saved search from URL params if present
function loadFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    if (params.has('q')) elements.searchInput.value = params.get('q');
    if (params.has('state')) elements.filterState.value = params.get('state');
    if (params.has('class')) elements.filterClass.value = params.get('class');
    if (params.has('status')) elements.filterStatus.value = params.get('status');
    if (params.has('from')) elements.filterDateFrom.value = params.get('from');
    if (params.has('to')) elements.filterDateTo.value = params.get('to');
}
