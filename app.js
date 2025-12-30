/* BevAlc Intelligence - Database App */

let allData = [];
let filteredData = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 50;

// Category mapping
const CATEGORY_MAP = {
    'Whiskey': ['BOURBON', 'RYE', 'WHISKEY', 'WHISKY', 'MALT WHISKEY', 'MALT WHISKY', 'SCOTCH', 'SINGLE MALT', 'STRAIGHT'],
    'Vodka': ['VODKA'],
    'Tequila & Mezcal': ['TEQUILA', 'MEZCAL', 'AGAVE'],
    'Rum': ['RUM'],
    'Gin': ['GIN'],
    'Brandy': ['BRANDY', 'COGNAC', 'ARMAGNAC', 'GRAPPA', 'PISCO'],
    'Liqueurs': ['LIQUEUR', 'CORDIAL', 'SCHNAPPS', 'AMARETTO', 'TRIPLE SEC', 'CREAM'],
    'Wine': ['WINE', 'CHAMPAGNE', 'SPARKLING', 'VERMOUTH', 'PORT', 'SHERRY', 'MADEIRA', 'SANGRIA', 'TABLE RED', 'TABLE WHITE', 'ROSE'],
    'Beer & Malt': ['BEER', 'ALE', 'LAGER', 'STOUT', 'PORTER', 'MALT BEVERAGE', 'HARD', 'CIDER', 'SELTZER']
};

// State abbreviation map
const STATE_MAP = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
    'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
    'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
    'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
    'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
    'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
    'DC': 'District of Columbia', 'PR': 'Puerto Rico', 'GU': 'Guam', 'VI': 'Virgin Islands'
};

const STATE_NAME_TO_ABBR = {};
Object.entries(STATE_MAP).forEach(([abbr, name]) => {
    STATE_NAME_TO_ABBR[name.toUpperCase()] = abbr;
});

const elements = {};

document.addEventListener('DOMContentLoaded', async function() {
    if (!window.BevAlcAuth?.hasAccess()) {
        window.location.href = 'index.html';
        return;
    }
    
    cacheElements();
    showUserName();
    setupEventListeners();
    await loadData();
});

function cacheElements() {
    elements.searchInput = document.getElementById('search-input');
    elements.filterCategory = document.getElementById('filter-category');
    elements.filterSubcategory = document.getElementById('filter-subcategory');
    elements.filterState = document.getElementById('filter-state');
    elements.filterStatus = document.getElementById('filter-status');
    elements.filterDateFrom = document.getElementById('filter-date-from');
    elements.filterDateTo = document.getElementById('filter-date-to');
    elements.resetFilters = document.getElementById('reset-filters');
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
    const user = window.BevAlcAuth?.getStoredUser();
    if (user?.name && elements.navUser) {
        elements.navUser.querySelector('.user-name').textContent = user.name;
    }
}

function setupEventListeners() {
    let searchTimeout;
    elements.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { currentPage = 1; applyFilters(); }, 300);
    });
    
    elements.filterCategory.addEventListener('change', () => { 
        currentPage = 1; 
        updateSubcategoryOptions();
        applyFilters(); 
    });
    elements.filterSubcategory.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterState.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterStatus.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterDateFrom.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    elements.filterDateTo.addEventListener('change', () => { currentPage = 1; applyFilters(); });
    
    elements.resetFilters.addEventListener('click', resetAllFilters);
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    elements.saveSearchBtn.addEventListener('click', saveCurrentSearch);
}

async function loadData() {
    try {
        const response = await fetch('colas.json');
        if (!response.ok) throw new Error('Failed to load data');
        
        const data = await response.json();
        allData = (data.colas || []).map(cola => ({
            ...cola,
            category: getCategory(cola.class_type_code),
            cleanState: extractState(cola.state)
        }));
        
        populateFilters();
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
                <p>Please make sure colas.json exists.</p>
            </div>
        `;
    }
}

function getCategory(classType) {
    if (!classType) return 'Other';
    const upper = classType.toUpperCase();
    
    for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
        if (keywords.some(kw => upper.includes(kw))) {
            return category;
        }
    }
    return 'Other';
}

function extractState(stateStr) {
    if (!stateStr) return '';
    const upper = stateStr.toUpperCase();
    
    // Check for state abbreviation pattern like "City, ST 12345"
    const match = upper.match(/,\s*([A-Z]{2})\s*\d{5}/);
    if (match && STATE_MAP[match[1]]) {
        return STATE_MAP[match[1]];
    }
    
    // Check if it starts with a state name
    for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
        if (upper.startsWith(name)) {
            return STATE_MAP[abbr];
        }
    }
    
    // Check if it's just an abbreviation
    if (upper.length === 2 && STATE_MAP[upper]) {
        return STATE_MAP[upper];
    }
    
    // Try to find any state abbreviation in the string
    for (const abbr of Object.keys(STATE_MAP)) {
        const regex = new RegExp(`\\b${abbr}\\b`);
        if (regex.test(upper)) {
            return STATE_MAP[abbr];
        }
    }
    
    return stateStr;
}

function populateFilters() {
    // Categories
    const categories = [...new Set(allData.map(c => c.category))].sort();
    categories.forEach(cat => {
        if (cat) {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            elements.filterCategory.appendChild(opt);
        }
    });
    
    // States
    const states = [...new Set(allData.map(c => c.cleanState).filter(s => s && s.length > 2))].sort();
    states.forEach(state => {
        const opt = document.createElement('option');
        opt.value = state;
        opt.textContent = state;
        elements.filterState.appendChild(opt);
    });
    
    // Statuses
    const statuses = [...new Set(allData.map(c => c.status).filter(Boolean))].sort();
    statuses.forEach(status => {
        const opt = document.createElement('option');
        opt.value = status;
        opt.textContent = status;
        elements.filterStatus.appendChild(opt);
    });
    
    // Initial subcategory population
    updateSubcategoryOptions();
}

function updateSubcategoryOptions() {
    const selectedCategory = elements.filterCategory.value;
    elements.filterSubcategory.innerHTML = '<option value="">All Subcategories</option>';
    
    let subcategories;
    if (selectedCategory) {
        subcategories = [...new Set(allData.filter(c => c.category === selectedCategory).map(c => c.class_type_code).filter(Boolean))].sort();
    } else {
        subcategories = [...new Set(allData.map(c => c.class_type_code).filter(Boolean))].sort();
    }
    
    subcategories.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        elements.filterSubcategory.appendChild(opt);
    });
}

function applyFilters() {
    const search = elements.searchInput.value.toLowerCase().trim();
    const category = elements.filterCategory.value;
    const subcategory = elements.filterSubcategory.value;
    const state = elements.filterState.value;
    const status = elements.filterStatus.value;
    const dateFrom = elements.filterDateFrom.value;
    const dateTo = elements.filterDateTo.value;
    
    filteredData = allData.filter(cola => {
        // Search
        if (search) {
            const fields = [cola.brand_name, cola.fanciful_name, cola.ttb_id, cola.company_name, cola.class_type_code]
                .map(f => (f || '').toLowerCase());
            if (!fields.some(f => f.includes(search))) return false;
        }
        
        // Category
        if (category && cola.category !== category) return false;
        
        // Subcategory
        if (subcategory && cola.class_type_code !== subcategory) return false;
        
        // State
        if (state && cola.cleanState !== state) return false;
        
        // Status
        if (status && cola.status !== status) return false;
        
        // Date filters
        if (dateFrom && cola.approval_date) {
            const d = parseDate(cola.approval_date);
            if (d && d < new Date(dateFrom)) return false;
        }
        if (dateTo && cola.approval_date) {
            const d = parseDate(cola.approval_date);
            if (d && d > new Date(dateTo)) return false;
        }
        
        return true;
    });
    
    renderResults();
    renderPagination();
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    let match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) return new Date(match[3], match[1] - 1, match[2]);
    match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(match[1], match[2] - 1, match[3]);
    return new Date(dateStr);
}

function renderResults() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageData = filteredData.slice(start, start + ITEMS_PER_PAGE);
    
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
                <th>Category</th>
                <th>Subcategory</th>
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
                    <td>${cola.category || '-'}</td>
                    <td>${cola.class_type_code || '-'}</td>
                    <td>${cola.cleanState || '-'}</td>
                    <td>${cola.approval_date || '-'}</td>
                    <td class="status-${(cola.status || '').toLowerCase()}">${cola.status || '-'}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    
    table.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', () => {
            const cola = allData.find(c => c.ttb_id === row.dataset.ttbId);
            if (cola) openModal(cola);
        });
    });
    
    elements.resultsContainer.innerHTML = '';
    elements.resultsContainer.appendChild(table);
}

function renderPagination() {
    const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { elements.pagination.innerHTML = ''; return; }
    
    let html = `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">← Prev</button>`;
    
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
    
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
    
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next →</button>`;
    
    elements.pagination.innerHTML = html;
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
        { label: 'Category', value: cola.category },
        { label: 'Subcategory', value: cola.class_type_code },
        { label: 'Origin', value: cola.origin_code },
        { label: 'Type of Application', value: cola.type_of_application },
        { label: 'Approval Date', value: cola.approval_date },
        { label: 'Vendor Code', value: cola.vendor_code },
        { label: 'Serial Number', value: cola.serial_number },
        { label: 'Plant Registry', value: cola.plant_registry },
        { label: 'State', value: cola.cleanState },
    ];
    
    // Blurred fields
    const blurredFields = [
        { label: 'Company Name', value: cola.company_name },
        { label: 'Street', value: cola.street },
        { label: 'Contact Person', value: cola.contact_person },
        { label: 'Phone Number', value: cola.phone_number },
    ];
    
    let html = '<div class="detail-grid">';
    fields.forEach(f => {
        html += `<div class="detail-item"><span class="detail-label">${f.label}</span><span class="detail-value">${f.value || '-'}</span></div>`;
    });
    html += '</div>';
    
    // Blurred contact section
    html += `
        <div class="paywall-section">
            <h4>Contact Information</h4>
            <div class="detail-grid" style="margin: 1rem 0;">
                ${blurredFields.map(f => `
                    <div class="detail-item">
                        <span class="detail-label">${f.label}</span>
                        <span class="detail-value detail-blurred">${f.value || 'Contact Name Here'}</span>
                    </div>
                `).join('')}
            </div>
            <p>Upgrade to Pro to view contact information for all records.</p>
            <button class="paywall-btn">Upgrade to Pro</button>
        </div>
    `;
    
    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

function resetAllFilters() {
    elements.searchInput.value = '';
    elements.filterCategory.value = '';
    elements.filterSubcategory.value = '';
    elements.filterState.value = '';
    elements.filterStatus.value = '';
    elements.filterDateFrom.value = '';
    elements.filterDateTo.value = '';
    currentPage = 1;
    updateSubcategoryOptions();
    applyFilters();
}

function saveCurrentSearch() {
    const search = {
        query: elements.searchInput.value,
        category: elements.filterCategory.value,
        subcategory: elements.filterSubcategory.value,
        state: elements.filterState.value,
        status: elements.filterStatus.value,
        dateFrom: elements.filterDateFrom.value,
        dateTo: elements.filterDateTo.value,
        savedAt: new Date().toISOString()
    };
    
    const name = prompt('Enter a name for this saved search:');
    if (!name) return;
    search.name = name;
    
    try {
        const saved = JSON.parse(localStorage.getItem('bevalc_saved_searches') || '[]');
        saved.push(search);
        localStorage.setItem('bevalc_saved_searches', JSON.stringify(saved));
        alert('Search saved!');
    } catch (e) {
        alert('Failed to save search.');
    }
}
