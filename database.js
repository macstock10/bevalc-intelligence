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
            // Add Account link to nav for Pro users
            const navUser = document.getElementById('nav-user');
            if (navUser && !document.getElementById('nav-account-link')) {
                const accountLink = document.createElement('a');
                accountLink.id = 'nav-account-link';
                accountLink.href = 'account.html';
                accountLink.className = 'nav-link';
                accountLink.textContent = 'Account';
                navUser.insertBefore(accountLink, navUser.firstChild);
            }
            
            // Unlock CSV export button for Pro users
            updateCSVButtonState(true);
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
                <td colspan="8" class="no-results">
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
    
    elements.resultsBody.innerHTML = data.map(cola => {
        let signalHtml = '-';
        if (cola.signal) {
            const signalClass = cola.signal.toLowerCase().replace(/_/g, '-');
            signalHtml = `<span class="signal-badge signal-${signalClass}">${cola.signal.replace(/_/g, ' ')}</span>`;
        }
        return `
        <tr data-ttb-id="${escapeHtml(cola.ttb_id)}" class="clickable-row">
            <td class="cell-ttb-id">${escapeHtml(cola.ttb_id || '-')}</td>
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
    elements.modalTitle.textContent = record.brand_name || 'Unknown Brand';
    elements.modalSubtitle.textContent = `TTB ID: ${record.ttb_id}`;
    
    // Get user info for Pro check
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
    
    // Build TRACK section
    const trackHtml = buildTrackSection(record, userEmail, isPro);
    
    // Build TTB Images link for Product Details
    const ttbUrl = `https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=${record.ttb_id}`;
    const labelImagesHtml = buildLabelImagesField(ttbUrl, isPro);
    
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
                { label: 'Company Name', value: record.company_name },
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
                            if (isPro) {
                                // Pro user: show field with teal label
                                return `
                                    <div class="detail-item">
                                        <span class="detail-label detail-label-pro">${f.label}</span>
                                        <span class="detail-value">${escapeHtml(f.value || '-')}</span>
                                    </div>
                                `;
                            } else {
                                // Free user: show locked field with upgrade prompt
                                return `
                                    <div class="detail-item detail-item-locked">
                                        <span class="detail-label detail-label-pro">${f.label}</span>
                                        <span class="detail-value detail-value-locked">
                                            <span class="detail-blur">${f.value ? '••••••••' : '-'}</span>
                                            <button class="detail-upgrade-btn" onclick="showProUpgradePrompt()">Upgrade</button>
                                        </span>
                                    </div>
                                `;
                            }
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
    
    elements.modalBody.innerHTML = html;
    elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Load watchlist states and counts after modal is rendered
    if (userEmail) {
        loadWatchlistStates(record, userEmail, isPro);
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
                ${createPill('keyword', fancifulName, `"${fancifulName}"`, 'count-keyword')}
                ${createPill('subcategory', subcategory, subcategory, 'count-subcategory')}
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
        { type: 'company', value: record.company_name },
        { type: 'keyword', value: record.fanciful_name },
        { type: 'subcategory', value: record.class_type_code }
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
            <td colspan="8" class="no-results">
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
        
        const classType = elements.filterClass.value;
        if (classType) params.append('class_type', classType);
        
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