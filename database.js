/**
 * BevAlc Intelligence - Database Page
 * Handles search, filters, pagination, and data display
 */

// Configuration
const API_BASE = 'https://bevalc-api.mac-rowan.workers.dev';
const ITEMS_PER_PAGE = 20;

// Complete TTB Class/Type Code to Category Mapping
// Based on official TTB documentation - every code manually assigned
const TTB_CODE_CATEGORIES = {
    // WHISKEY
    'STRAIGHT WHISKY': 'Whiskey', 'STRAIGHT BOURBON WHISKY': 'Whiskey', 'STRAIGHT RYE WHISKY': 'Whiskey',
    'STRAIGHT CORN WHISKY': 'Whiskey', 'OTHER STRAIGHT WHISKY': 'Whiskey', 'WHISKY BOTTLED IN BOND (BIB)': 'Whiskey',
    'BOURBON WHISKY BIB': 'Whiskey', 'RYE WHISKY BIB': 'Whiskey', 'CORN WHISKY BIB': 'Whiskey',
    'STRAIGHT MALT WHISKY': 'Whiskey', 'MALT WHISKY': 'Whiskey', 'OTHER WHISKY BIB': 'Whiskey',
    'STRAIGHT WHISKY BLENDS': 'Whiskey', 'STRAIGHT BOURBON WHISKY BLENDS': 'Whiskey',
    'STRAIGHT RYE WHISKY BLENDS': 'Whiskey', 'STRAIGHT CORN WHISKY BLENDS': 'Whiskey',
    'OTHER STRAIGHT BLENDED WHISKY': 'Whiskey', 'WHISKY BLENDS': 'Whiskey', 'BLENDED BOURBON WHISKY': 'Whiskey',
    'BLENDED RYE WHISKY': 'Whiskey', 'BLENDED CORN WHISKY': 'Whiskey', 'BLENDED LIGHT WHISKY': 'Whiskey',
    'BLENDED WHISKY': 'Whiskey', 'DILUTED BLENDED WHISKY': 'Whiskey', 'OTHER WHISKY BLENDS': 'Whiskey',
    'WHISKY': 'Whiskey', 'BOURBON WHISKY': 'Whiskey', 'RYE WHISKY': 'Whiskey', 'CORN WHISKY': 'Whiskey',
    'LIGHT WHISKY': 'Whiskey', 'WHISKY PROPRIETARY': 'Whiskey', 'SPIRIT WHISKY': 'Whiskey',
    'DILUTED WHISKY': 'Whiskey', 'OTHER WHISKY (FLAVORED)': 'Whiskey', 'SCOTCH WHISKY': 'Whiskey',
    'SCOTCH WHISKY FB': 'Whiskey', 'SCOTCH WHISKY USB': 'Whiskey', 'SINGLE MALT SCOTCH WHISKY': 'Whiskey',
    'UNBLENDED SCOTCH WHISKY USB': 'Whiskey', 'DILUTED SCOTCH WHISKY FB': 'Whiskey',
    'DILUTED SCOTCH WHISKY USB': 'Whiskey', 'CANADIAN WHISKY': 'Whiskey', 'CANADIAN WHISKY FB': 'Whiskey',
    'CANADIAN WHISKY USB': 'Whiskey', 'STRAIGHT AMERICAN SINGLE MALT': 'Whiskey',
    'AMERICAN SINGLE MALT WHISKEY': 'Whiskey', 'DILUTED CANADIAN WHISKY FB': 'Whiskey',
    'DILUTED CANADIAN WHISKY USB': 'Whiskey', 'IRISH WHISKY': 'Whiskey', 'IRISH WHISKY FB': 'Whiskey',
    'IRISH WHISKY USB': 'Whiskey', 'DILUTED IRISH WHISKY FB': 'Whiskey', 'DILUTED IRISH WHISKY USB': 'Whiskey',
    'WHISKY ORANGE FLAVORED': 'Whiskey', 'WHISKY GRAPE FLAVORED': 'Whiskey', 'WHISKY LIME FLAVORED': 'Whiskey',
    'WHISKY LEMON FLAVORED': 'Whiskey', 'WHISKY CHERRY FLAVORED': 'Whiskey', 'WHISKY CHOCOLATE FLAVORED': 'Whiskey',
    'WHISKY MINT FLAVORED': 'Whiskey', 'WHISKY PEPPERMINT FLAVORED': 'Whiskey', 'WHISKY OTHER FLAVORED': 'Whiskey',
    'OTHER IMPORTED WHISKY': 'Whiskey', 'OTHER IMPORTED WHISKY FB': 'Whiskey', 'OTHER IMPORTED WHISKY USB': 'Whiskey',
    'DILUTED OTHER IMPORTED WHISKY FB': 'Whiskey', 'DILUTED OTHER IMPORTED WHISKY USB': 'Whiskey',
    'AMERICAN SINGLE MALT WHISKEY - BIB': 'Whiskey', 'WHISKY SPECIALTIES': 'Whiskey',
    'LIQUEURS (WHISKY)': 'Whiskey', 'TENNESSEE WHISKY': 'Whiskey',
    // GIN
    'DISTILLED GIN': 'Gin', 'LONDON DRY DISTILLED GIN': 'Gin', 'OTHER DISTILLED GIN': 'Gin',
    'GIN': 'Gin', 'LONDON DRY GIN': 'Gin', 'OTHER GIN': 'Gin', 'GIN - FLAVORED': 'Gin',
    'GIN - MINT FLAVORED': 'Gin', 'GIN - ORANGE FLAVORED': 'Gin', 'GIN - LEMON FLAVORED': 'Gin',
    'OTHER GIN - FLAVORED': 'Gin', 'DILUTED GIN': 'Gin', 'LONDON DRY DISTILLED GIN FB': 'Gin',
    'LONDON DRY DISTILLED GIN USB': 'Gin', 'OTHER DISTILLED GIN FB': 'Gin', 'OTHER DISTILLED GIN USB': 'Gin',
    'LONDON DRY GIN FB': 'Gin', 'LONDON DRY GIN USB': 'Gin', 'OTHER GIN FB': 'Gin', 'OTHER GIN USB': 'Gin',
    'GIN - CHERRY FLAVORED': 'Gin', 'GIN - APPLE FLAVORED': 'Gin', 'GIN - BLACKBERRY FLAVORED': 'Gin',
    'GIN - PEACH FLAVORED': 'Gin', 'GIN - GRAPE FLAVORED': 'Gin', 'DILUTED GIN FB': 'Gin',
    'DILUTED GIN USB': 'Gin', 'GIN SPECIALTIES': 'Gin', 'LIQUEURS (GIN)': 'Gin', 'SLOE GIN': 'Gin',
    // VODKA
    'VODKA': 'Vodka', 'VODKA 80-89 PROOF': 'Vodka', 'VODKA 90-99 PROOF': 'Vodka', 'VODKA 100 PROOF UP': 'Vodka',
    'VODKA - FLAVORED': 'Vodka', 'VODKA - ORANGE FLAVORED': 'Vodka', 'VODKA - GRAPE FLAVORED': 'Vodka',
    'VODKA - LIME FLAVORED': 'Vodka', 'VODKA - LEMON FLAVORED': 'Vodka', 'VODKA - CHERRY FLAVORED': 'Vodka',
    'VODKA - CHOCOLATE FLAVORED': 'Vodka', 'VODKA - MINT FLAVORED': 'Vodka', 'VODKA - PEPPERMINT FLAVORED': 'Vodka',
    'VODKA - OTHER FLAVORED': 'Vodka', 'OTHER VODKA': 'Vodka', 'DILUTED VODKA': 'Vodka',
    'VODKA 80-89 PROOF FB': 'Vodka', 'VODKA 80-89 PROOF USB': 'Vodka', 'VODKA 90-99 PROOF FB': 'Vodka',
    'VODKA 90-99 PROOF USB': 'Vodka', 'VODKA 100 PROOF UP FB': 'Vodka', 'VODKA 100 PROOF UP USB': 'Vodka',
    'DILUTED VODKA FB': 'Vodka', 'DILUTED VODKA USB': 'Vodka', 'VODKA SPECIALTIES': 'Vodka', 'LIQUEURS (VODKA)': 'Vodka',
    // RUM
    'U.S. RUM (WHITE)': 'Rum', 'UR.S. RUM (WHITE)': 'Rum', 'PUERTO RICAN RUM (WHITE)': 'Rum',
    'VIRGIN ISLANDS RUM (WHITE)': 'Rum', 'HAWAIIAN RUM (WHITE)': 'Rum', 'FLORIDA RUM (WHITE)': 'Rum',
    'OTHER RUM (WHITE)': 'Rum', 'U.S. RUM (GOLD)': 'Rum', 'PUERTO RICAN RUM (GOLD)': 'Rum',
    'VIRGIN ISLANDS RUM (GOLD)': 'Rum', 'VIRGIN ISLANDS RUM': 'Rum', 'HAWAIIAN RUM (GOLD)': 'Rum',
    'FLORIDA RUM (GOLD)': 'Rum', 'OTHER RUM (GOLD)': 'Rum', 'RUM FLAVORED (BOLD)': 'Rum',
    'RUM ORANGE GLAVORED': 'Rum', 'RUM GRAPE FLAVORED': 'Rum', 'RUM LIME FLAVORED': 'Rum',
    'RUM LEMON FLAVORED': 'Rum', 'RUM CHERRY FLAVORED': 'Rum', 'RUM CHOCOLATE FLAVORED': 'Rum',
    'RUM MINT FLAVORED': 'Rum', 'RUM PEPPERMINT FLAVORED': 'Rum', 'RUM OTHER FLAVORED': 'Rum',
    'OTHER WHITE RUM': 'Rum', 'FLAVORED RUM (BOLD)': 'Rum', 'RUM ORANGE FLAVORED': 'Rum',
    'DILUTED RUM (WHITE)': 'Rum', 'DILUTED RUM (GOLD)': 'Rum', 'DOMESTIC FLAVORED RUM': 'Rum',
    'FOREIGN RUM': 'Rum', 'OTHER FOREIGN RUM': 'Rum', 'RUM SPECIALTIES': 'Rum', 'LIQUEURS (RUM)': 'Rum', 'CACHACA': 'Rum',
    // BRANDY
    'BRANDY': 'Brandy', 'CALIFORNIA BRANDY': 'Brandy', 'NEW YORK BRANDY': 'Brandy', 'FRUIT BRANDY': 'Brandy',
    'APPLE BRANDY': 'Brandy', 'CHERRY BRANDY': 'Brandy', 'PLUM BRANDY': 'Brandy', 'BLACKBERRY BRANDY': 'Brandy',
    'APRICOT BRANDY': 'Brandy', 'PEAR BRANDY': 'Brandy', 'COGNAC (BRANDY) FB': 'Brandy', 'COGNAC (BRANDY) USB': 'Brandy',
    'ARMAGNAC (BRANDY) FB': 'Brandy', 'ARMAGNAC (BRANDY) USB': 'Brandy', 'GRAPPA BRANDY': 'Brandy', 'PISCO': 'Brandy',
    'APPLE BRANDY (CALVADOS)': 'Brandy', 'PLUM BRANDY (SLIVOVITZ)': 'Brandy', 'BRANDY - FLAVORED': 'Brandy',
    'FLAVORED BRANDY': 'Brandy', 'BLACKBERRY FLAVORED BRANDY': 'Brandy', 'LIQUEUR & BRANDY': 'Brandy',
    // LIQUEUR
    'CORDIALS (FRUIT & PEELS)': 'Liqueur', 'FRUIT FLAVORED LIQUEURS': 'Liqueur', 'CURACAO': 'Liqueur',
    'TRIPLE SEC': 'Liqueur', 'SLOE GIN': 'Liqueur', 'CORDIALS (HERBS & SEEDS)': 'Liqueur',
    'ANISETTE, OUZO, OJEN': 'Liqueur', 'COFFEE (CAFE) LIQUEUR': 'Liqueur', 'KUMMEL': 'Liqueur',
    'PEPPERMINT SCHNAPPS': 'Liqueur', 'AMARETTO': 'Liqueur', 'SAMBUCA': 'Liqueur', 'ARACK/RAKI': 'Liqueur',
    'CORDIALS (CREMES OR CREAMS)': 'Liqueur', 'CREME DE CACAO WHITE': 'Liqueur', 'CREME DE CACAO BROWN': 'Liqueur',
    'CREME DE MENTHE WHITE': 'Liqueur', 'CREME DE MENTHE GREEN': 'Liqueur', 'CREME DE ALMOND (NOYAUX)': 'Liqueur',
    'DAIRY CREAM LIQUEUR/CORDIAL': 'Liqueur', 'NON DAIRY CREME LIQUEUR/CORDIAL': 'Liqueur',
    'SPECIALTIES & PROPRIETARIES': 'Liqueur', 'OTHER SPECIALTIES & PROPRIETARIES': 'Liqueur',
    // COCKTAILS
    'COCKTAILS 48 PROOF UP': 'Cocktails', 'COCKTAILS UNDER 48 PROOF': 'Cocktails',
    'MIXED DRINKS-HI BALLS COCKTAILS': 'Cocktails', 'SCREW DRIVER': 'Cocktails', 'COLLINS': 'Cocktails',
    'BLOODY MARY': 'Cocktails', 'EGG NOG': 'Cocktails', 'DAIQUIRI (48 PROOF UP)': 'Cocktails',
    'DAIQUIRI (UNDER 48 PROOF)': 'Cocktails', 'MARGARITA (48 PROOF UP)': 'Cocktails',
    'MARGARITA (UNDER 48 PROOF)': 'Cocktails', 'COLADA (48 PROOF UP)': 'Cocktails', 'COLADA (UNDER 48 PROOF)': 'Cocktails',
    // WINE
    'TABLE RED WINE': 'Wine', 'ROSE WINE': 'Wine', 'TABLE WHITE WINE': 'Wine', 'TABLE FLAVORED WINE': 'Wine',
    'TABLE FRUIT WINE': 'Wine', 'SPARKLING WINE/CHAMPAGNE': 'Wine', 'SPARKLING WINE': 'Wine', 'CHAMPAGNE': 'Wine',
    'CARBONATED WINE': 'Wine', 'VERMOUTH/MIXED TYPES': 'Wine', 'DESSERT FLAVORED WINE': 'Wine',
    'DESSERT /PORT/SHERRY/(COOKING) WINE': 'Wine', 'DESSERT FRUIT WINE': 'Wine', 'WINE': 'Wine',
    'PORT': 'Wine', 'SHERRY': 'Wine', 'VERMOUTH': 'Wine', 'SANGRIA': 'Wine', 'MEAD': 'Wine', 'CIDER': 'Wine',
    'SAKE': 'Wine', 'SAKE - IMPORTED': 'Wine', 'SAKE - DOMESTIC FLAVORED': 'Wine', 'SAKE - IMPORTED FLAVORED': 'Wine',
    // BEER
    'MALT BEVERAGES': 'Beer', 'BEER': 'Beer', 'ALE': 'Beer', 'MALT LIQUOR': 'Beer', 'STOUT': 'Beer', 'PORTER': 'Beer',
    'MALT BEVERAGES SPECIALITIES - FLAVORED': 'Beer', 'OTHER MALT BEVERAGES': 'Beer',
    // TEQUILA
    'TEQUILA': 'Tequila', 'TEQUILA FB': 'Tequila', 'TEQUILA USB': 'Tequila', 'MEZCAL': 'Tequila',
    'MEZCAL FB': 'Tequila', 'AGAVE SPIRITS': 'Tequila', 'FLAVORED TEQUILA': 'Tequila', 'FLAVORED MEZCAL': 'Tequila',
    // OTHER SPIRITS
    'OTHER SPIRITS': 'Other Spirits', 'NEUTRAL SPIRITS - GRAIN': 'Other Spirits', 'BITTERS - BEVERAGE': 'Other Spirits',
    'BITTERS - BEVERAGE*': 'Other Spirits', 'GRAIN SPIRITS': 'Other Spirits',
    // OTHER
    'NON ALCOHOLIC MIXES': 'Other', 'ADMINISTRATIVE WITHDRAWAL': 'Other'
};

// Categories list for dropdown
const CATEGORIES = ['Whiskey', 'Vodka', 'Tequila', 'Rum', 'Gin', 'Brandy', 'Wine', 'Beer', 'Liqueur', 'Cocktails', 'Other Spirits', 'Other'];

// Function to get category from class_type_code - uses lookup, falls back to pattern matching for unknown codes
function getCategory(classTypeCode) {
    if (!classTypeCode) return 'Other';
    // Try exact lookup first
    if (TTB_CODE_CATEGORIES[classTypeCode]) return TTB_CODE_CATEGORIES[classTypeCode];
    // Fallback: pattern matching for any codes not in lookup table
    const upper = classTypeCode.toUpperCase();
    if (upper.includes('WHISK') || upper.includes('BOURBON') || upper.includes('SCOTCH')) return 'Whiskey';
    if (upper.includes('VODKA')) return 'Vodka';
    if (upper.includes('TEQUILA') || upper.includes('MEZCAL') || upper.includes('AGAVE')) return 'Tequila';
    if (upper.includes('RUM') || upper.includes('CACHACA')) return 'Rum';
    if (upper.includes('GIN')) return 'Gin';
    if (upper.includes('BRANDY') || upper.includes('COGNAC') || upper.includes('ARMAGNAC') || upper.includes('GRAPPA') || upper.includes('PISCO')) return 'Brandy';
    if (upper.includes('WINE') || upper.includes('CHAMPAGNE') || upper.includes('PORT') || upper.includes('SHERRY') || upper.includes('VERMOUTH') || upper.includes('SAKE') || upper.includes('CIDER') || upper.includes('MEAD')) return 'Wine';
    if (upper.includes('BEER') || upper.includes('ALE') || upper.includes('MALT') || upper.includes('STOUT') || upper.includes('PORTER')) return 'Beer';
    if (upper.includes('LIQUEUR') || upper.includes('CORDIAL') || upper.includes('SCHNAPPS') || upper.includes('AMARETTO') || upper.includes('CREME DE')) return 'Liqueur';
    if (upper.includes('COCKTAIL') || upper.includes('MARTINI') || upper.includes('DAIQUIRI') || upper.includes('MARGARITA') || upper.includes('COLADA')) return 'Cocktails';
    return 'Other';
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
            } catch (e) {}
        }
    } else {
        if (elements.blurOverlay) elements.blurOverlay.style.display = 'flex';
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
    
    if (selectedCategory) {
        // Filter subcategories by looking up each one's category
        const matchingSubcats = state.filters.class_types.filter(type => {
            return getCategory(type) === selectedCategory;
        });
        
        // Add matching subcategories to dropdown
        matchingSubcats.forEach(subcat => {
            const option = document.createElement('option');
            option.value = subcat;
            option.textContent = subcat;
            elements.filterClass.appendChild(option);
        });
    } else {
        // Show all subcategories from API
        state.filters.class_types.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            elements.filterClass.appendChild(option);
        });
    }
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
        
        console.log('API Response:', data);
        if (data.success) {
            console.log('Data count:', data.data ? data.data.length : 'null');
            renderResults(data.data);
            renderPagination(data.pagination);
            updateResultsCount(data.pagination);
        } else {
            console.log('API Error:', data.error);
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
    
    // Class/Types (Subcategories) - initially show all
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
    elements.filterCategory.value = '';
    elements.filterClass.innerHTML = '<option value="">All Subcategories</option>';
    state.filters.class_types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        elements.filterClass.appendChild(option);
    });
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
