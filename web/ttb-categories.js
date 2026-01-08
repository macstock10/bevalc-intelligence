/**
 * TTB Category/Subcategory Mapping
 *
 * Maps TTB class_type_code values to Category > Subcategory hierarchy.
 * Used by database.js (frontend filters) and worker.js (API/SEO pages).
 */

const TTB_CATEGORIES = {
  "Whiskey": {
    "Bourbon": [
      "STRAIGHT BOURBON WHISKY", "BOURBON WHISKY", "BOURBON WHISKY BIB",
      "STRAIGHT BOURBON WHISKY BLENDS", "BLENDED BOURBON WHISKY"
    ],
    "Rye": [
      "STRAIGHT RYE WHISKY", "RYE WHISKY", "RYE WHISKY BIB",
      "STRAIGHT RYE WHISKY BLENDS", "BLENDED RYE WHISKY"
    ],
    "American Single Malt": [
      "AMERICAN SINGLE MALT WHISKEY", "AMERICAN SINGLE MALT WHISKEY - BIB",
      "STRAIGHT AMERICAN SINGLE MALT"
    ],
    "Scotch": [
      "SCOTCH WHISKY", "SCOTCH WHISKY FB", "SCOTCH WHISKY USB",
      "SINGLE MALT SCOTCH WHISKY", "UNBLENDED SCOTCH WHISKY USB",
      "DILUTED SCOTCH WHISKY FB", "DILUTED SCOTCH WHISKY USB"
    ],
    "Irish Whiskey": [
      "IRISH WHISKY", "IRISH WHISKY FB", "IRISH WHISKY USB",
      "DILUTED IRISH WHISKY FB", "DILUTED IRISH WHISKY USB"
    ],
    "Canadian Whisky": [
      "CANADIAN WHISKY", "CANADIAN WHISKY FB", "CANADIAN WHISKY USB",
      "DILUTED CANADIAN WHISKY FB", "DILUTED CANADIAN WHISKY USB"
    ],
    "Corn Whiskey": [
      "STRAIGHT CORN WHISKY", "CORN WHISKY", "CORN WHISKY BIB",
      "STRAIGHT CORN WHISKY BLENDS", "BLENDED CORN WHISKY"
    ],
    "Malt Whisky": ["STRAIGHT MALT WHISKY", "MALT WHISKY"],
    "Blended Whiskey": [
      "STRAIGHT WHISKY", "STRAIGHT WHISKY BLENDS", "WHISKY BLENDS",
      "BLENDED WHISKY", "BLENDED LIGHT WHISKY", "LIGHT WHISKY",
      "DILUTED BLENDED WHISKY", "OTHER WHISKY BLENDS",
      "OTHER STRAIGHT BLENDED WHISKY", "WHISKY",
      "WHISKY BOTTLED IN BOND (BIB)", "OTHER WHISKY BIB", "OTHER STRAIGHT WHISKY"
    ],
    "Flavored Whiskey": [
      "OTHER WHISKY (FLAVORED)", "WHISKY ORANGE FLAVORED", "WHISKY GRAPE FLAVORED",
      "WHISKY LIME FLAVORED", "WHISKY LEMON FLAVORED", "WHISKY CHERRY FLAVORED",
      "WHISKY CHOCOLATE FLAVORED", "WHISKY MINT FLAVORED",
      "WHISKY PEPPERMINT FLAVORED", "WHISKY OTHER FLAVORED"
    ],
    "Other Whiskey": [
      "WHISKY PROPRIETARY", "SPIRIT WHISKY", "DILUTED WHISKY",
      "OTHER IMPORTED WHISKY", "OTHER IMPORTED WHISKY FB", "OTHER IMPORTED WHISKY USB",
      "DILUTED OTHER IMPORTED WHISKY FB", "DILUTED OTHER IMPORTED WHISKY USB",
      "WHISKY SPECIALTIES", "LIQUEURS (WHISKY)"
    ]
  },
  "Vodka": {
    "Unflavored Vodka": [
      "VODKA", "VODKA 80-89 PROOF", "VODKA 90-99 PROOF", "VODKA 100 PROOF UP",
      "VODKA 80-89 PROOF FB", "VODKA 80-89 PROOF USB",
      "VODKA 90-99 PROOF FB", "VODKA 90-99 PROOF USB",
      "VODKA 100 PROOF UP FB", "VODKA 100 PROOF UP USB",
      "OTHER VODKA", "DILUTED VODKA", "DILUTED VODKA FB", "DILUTED VODKA USB"
    ],
    "Flavored Vodka": [
      "VODKA - FLAVORED", "VODKA - ORANGE FLAVORED", "VODKA - GRAPE FLAVORED",
      "VODKA - LIME FLAVORED", "VODKA - LEMON FLAVORED", "VODKA - CHERRY FLAVORED",
      "VODKA - CHOCOLATE FLAVORED", "VODKA - MINT FLAVORED",
      "VODKA - PEPPERMINT FLAVORED", "VODKA - OTHER FLAVORED"
    ],
    "Other Vodka": ["VODKA SPECIALTIES", "LIQUEURS (VODKA)"]
  },
  "Tequila": {
    "Tequila": [
      "TEQUILA FB", "TEQUILA USB", "DILUTED TEQUILA FB", "DILUTED TEQUILA USB"
    ],
    "Mezcal": [
      "MEZCAL", "MEZCAL FB", "MEZCAL US", "DILUTED MEZCAL", "FLAVORED MEZCAL"
    ],
    "Other Tequila": ["AGAVE SPIRITS", "FLAVORED AGAVE SPIRIT", "FLAVORED TEQUILA"]
  },
  "Gin": {
    "London Dry Gin": [
      "LONDON DRY GIN", "LONDON DRY DISTILLED GIN",
      "LONDON DRY DISTILLED GIN FB", "LONDON DRY DISTILLED GIN USB",
      "LONDON DRY GIN FB", "LONDON DRY GIN USB"
    ],
    "Distilled Gin": [
      "DISTILLED GIN", "OTHER DISTILLED GIN",
      "OTHER DISTILLED GIN FB", "OTHER DISTILLED GIN USB"
    ],
    "Flavored Gin": [
      "GIN - FLAVORED", "GIN - MINT FLAVORED", "GIN - ORANGE FLAVORED",
      "GIN - LEMON FLAVORED", "GIN - CHERRY FLAVORED", "GIN - APPLE FLAVORED",
      "GIN - BLACKBERRY FLAVORED", "GIN - PEACH FLAVORED", "GIN - GRAPE FLAVORED",
      "OTHER GIN - FLAVORED"
    ],
    "Other Gin": [
      "GIN", "OTHER GIN", "OTHER GIN FB", "OTHER GIN USB",
      "DILUTED GIN", "DILUTED GIN FB", "DILUTED GIN USB",
      "GIN SPECIALTIES", "LIQUEURS (GIN)", "SLOE GIN"
    ]
  },
  "Rum": {
    "White Rum": [
      "U.S. RUM (WHITE)", "UR.S. RUM (WHITE)", "PUERTO RICAN RUM (WHITE)",
      "VIRGIN ISLANDS RUM (WHITE)", "HAWAIIAN RUM (WHITE)", "FLORIDA RUM (WHITE)",
      "OTHER RUM (WHITE)", "OTHER WHITE RUM", "CUBAN RUM WHITE FB",
      "JAMAICAN RUM WHITE FB", "JAMAICAN RUM WHITE USB",
      "GUIANAN RUM WHITE FB", "GUIANAN RUM WHITE USB",
      "MARTINICAN RUM WHITE FB", "MARTINICAN RUM WHITE USB",
      "OTHER RUM WHITE FB", "OTHER RUM WHITE USB",
      "DILUTED RUM (WHITE)", "DILUTED RUM WHITE FB", "DILUTED RUM WHITE USB"
    ],
    "Gold/Aged Rum": [
      "U.S. RUM (GOLD)", "PUERTO RICAN RUM (GOLD)", "VIRGIN ISLANDS RUM (GOLD)",
      "VIRGIN ISLANDS RUM", "HAWAIIAN RUM (GOLD)", "FLORIDA RUM (GOLD)",
      "OTHER RUM (GOLD)", "CUBAN RUM GOLD FB", "JAMAICAN RUM GOLD FB",
      "JAMICAN RUM GOLD USB", "DUTCH GUIANAN RUM GOLD FB", "DUTCH GUIANAN RUM GOLD USB",
      "MARTINICAN RUM GOLD FB", "MARTINICAN RUM GOLD USB",
      "OTHER RUM GOLD FB", "OTHER RUM GOLD USB",
      "DILUTED RUM (GOLD)", "DILUTED RUM GOLD FB", "DILUTED RUM GOLD USB"
    ],
    "Flavored Rum": [
      "RUM FLAVORED (BOLD)", "FLAVORED RUM (BOLD)", "RUM ORANGE GLAVORED",
      "RUM ORANGE FLAVORED", "RUM GRAPE FLAVORED", "RUM LIME FLAVORED",
      "RUM LEMON FLAVORED", "RUM CHERRY FLAVORED", "RUM CHOCOLATE FLAVORED",
      "RUM MINT FLAVORED", "RUM PEPPERMINT FLAVORED", "RUM OTHER FLAVORED",
      "DOMESTIC FLAVORED RUM", "IMPORTED FLAVORED RUM"
    ],
    "Other Rum": [
      "FOREIGN RUM", "OTHER FOREIGN RUM", "OTHER FORIEGN RUM",
      "FRENCH GUIANAN RUM FB", "RUM SPECIALTIES", "LIQUEURS (RUM)", "CACHACA"
    ]
  },
  "Brandy": {
    "Cognac": ["COGNAC (BRANDY) FB", "COGNAC (BRANDY) USB"],
    "Armagnac": ["ARMAGNAC (BRANDY) FB", "ARMAGNAC (BRANDY) USB"],
    "American Brandy": [
      "BRANDY", "CALIFORNIA BRANDY", "CALIFORNIA GRAPE BRANDY",
      "CALIFORNIA DRIED BRANDY", "CALIFORNIA LEES BRANDY",
      "CALIFORNIA POMACE OR MARC BRANDY", "CALIFORNIA RESIDUE BRANDY",
      "CALIFORNIA NEUTRAL BRANDY", "OTHER CALIFORNIA BRANDY",
      "NEW YORK BRANDY", "NEW YORK GRAPE BRANDY", "NEW YORK DRIED BRANDY",
      "NEW YORK LEES BRANDY", "NEW YORK POMACE OR MARC BRANDY",
      "NEW YORK RESIDUE BRANDY", "NEW YORK NEUTRAL BRANDY", "OTHER NEW YORK BRANDY",
      "OTHER DOMESTIC GRAPE BRANDY", "DRIED BRANDY", "LEES BRANDY",
      "POMACE OR MARC BRANDY", "RESIDUE BRANDY", "NEUTRAL BRANDY",
      "IMMATURE BRANDY", "OTHER BRANDY"
    ],
    "Fruit Brandy": [
      "FRUIT BRANDY", "APPLE BRANDY", "APPLE BRANDY (CALVADOS)",
      "CHERRY BRANDY", "PLUM BRANDY", "PLUM BRANDY (SLIVOVITZ)",
      "BLACKBERRY BRANDY", "BLENDED APPLE JACK BRANDY", "PEAR BRANDY",
      "APRICOT BRANDY", "OTHER FRUIT BRANDY", "FOREIGN FRUIT BRANDY"
    ],
    "Grappa & Pisco": [
      "OTHER GRAPE BRANDY (PISCO, GRAPPA) FB", "OTHER GRAPE BRANDY (GRAPPA) USB"
    ],
    "Flavored Brandy": [
      "BRANDY - FLAVORED", "BRANDY - APRICOT FLAVORED", "BRANDY - BLACKBERRY FLAVORED",
      "BRANDY - PEACH FLAVORED", "BRANDY - CHERRY FLAVORED", "BRANDY - GINGER FLAVORED",
      "BRANDY - COFFEE FLAVORED", "BRANDY APPLE FLAVORED", "BRANDY APRICOT FLAVORED",
      "BRANDY BLACKBERRY FLAVORED", "BRANDY CHERRY FLAVORED", "BRANDY COFFEE FLAVORED",
      "BRANDY GINGER FLAVORED", "BRANDY PEACH FLAVORED", "OTHER BRANDY - FLAVORED",
      "OTHER FLAVORED BRANDY", "BLACKBERRY FLAVORED BRANDY", "CHERRY FLAVORED BRANDY",
      "APRICOT FLAVORED BRANDY", "PEACH FLAVORED BRANDY", "GINGER FLAVORED BRANDY"
    ],
    "Other Brandy": [
      "FRENCH BRANDY", "OTHER FRENCH BRANDY FB", "OTHER FRENCH BRANDY USB",
      "ITALIAN GRAPE BRANDY FB", "ITALIAN GRAPE BRANDY USB",
      "SPANISH GRAPE BRANDY FB", "SPANISH GRAPE BRANDY USB",
      "PORTUGUESE GRAPE BRANDY FB", "PORTUGUESE GRAPE BRANDY USB",
      "GREEK GRAPE BRANDY FB", "GREEK GRAPE BRANDY USB",
      "GERMAN GRAPE BRANDY FB", "GERMAN GRAPE BRANDY USB",
      "AUSTRALIAN GRAPE BRANDY FB", "AUSTRALIAN GRAPE BRANDY USB",
      "SOUTH AFRICAN GRAPE BRANDY FB", "SOUTH AFRICAN GRAPE BRANDY USB",
      "OTHER FOREIGN BRANDY", "OTHER FOREIGN BRANDY (CONT.)",
      "DILUTED BRANDY FB", "DILUTED BRANDY USB", "LIQUEUR & BRANDY"
    ]
  },
  "Wine": {
    "Red Wine": ["TABLE RED WINE"],
    "White Wine": ["TABLE WHITE WINE"],
    "Rosé Wine": ["ROSE WINE"],
    "Sparkling Wine": [
      "SPARKLING WINE/CHAMPAGNE", "SPARKLING WINE/ CIDER", "SPARKLING WINE/MEAD",
      "CARBONATED WINE", "CARBONATED WINE/CIDER", "CARBONATED WINE/MEAD"
    ],
    "Dessert Wine": [
      "DESSERT /PORT/SHERRY/(COOKING) WINE", "DESSERT FLAVORED WINE",
      "DESSERT FRUIT WINE", "HONEY BASED DESSERT WINE",
      "APPLE BASED DESSERT FLAVORED WINE", "APPLE DESSERT WINE/CIDER"
    ],
    "Flavored Wine": [
      "TABLE FLAVORED WINE", "APPLE BASED FLAVORED WINE", "HONEY BASED TABLE WINE"
    ],
    "Fruit Wine": ["TABLE FRUIT WINE", "APPLE TABLE WINE/CIDER"],
    "Fortified Wine": ["VERMOUTH/MIXED TYPES"],
    "Sake": [
      "SAKE", "SAKE - IMPORTED", "SAKE - DOMESTIC FLAVORED", "SAKE - IMPORTED FLAVORED"
    ],
    "Other Wine": []
  },
  "Beer": {
    "Lager/Beer": [
      "BEER", "IRC BEER", "IRC BEER-IMPORTED",
      "OTHER MALT BEVERAGES (BEER)", "OTHER MALT BEVERAGES"
    ],
    "Ale": ["ALE"],
    "Stout": ["STOUT"],
    "Porter": ["PORTER"],
    "Malt Liquor": ["MALT LIQUOR", "MALT BEVERAGES"],
    "Flavored Malt Beverages": [
      "MALT BEVERAGES SPECIALITIES - FLAVORED", "MALT BEVERAGES SPECIALITIES"
    ],
    "Non-Alcoholic Beer": ["CEREAL BEVERAGES - NEAR BEER (NON ALCOHOLIC)"],
    "Other Beer": []
  },
  "Liqueur": {
    "Fruit Liqueurs": [
      "CORDIALS (FRUIT & PEELS)", "FRUIT FLAVORED LIQUEURS", "CURACAO",
      "TRIPLE SEC", "OTHER FRUITS & PEELS LIQUEURS", "OTHER FRUIT & PEELS LIQUEURS",
      "FRUITS & PEELS SCHNAPPS LIQUEUR"
    ],
    "Cream Liqueurs": [
      "CORDIALS (CREMES OR CREAMS)", "CREME DE CACAO WHITE", "CREME DE CACAO BROWN",
      "CREME DE MENTHE WHITE", "CREME DE MENTHE GREEN", "CREME DE ALMOND (NOYAUX)",
      "DAIRY CREAM LIQUEUR/CORDIAL", "NON DAIRY CREME LIQUEUR/CORDIAL",
      "OTHER LIQUEUR (CREME OR CREAMS)", "OTHER LIQUEUR (CREMES OR CREAMS)"
    ],
    "Herbal Liqueurs": [
      "CORDIALS (HERBS & SEEDS)", "ANISETTE, OUZO, OJEN", "KUMMEL",
      "ARACK/RAKI", "SAMBUCA", "OTHER (HERBS & SEEDS)",
      "OTHER HERB & SEED CORDIALS/LIQUEURS", "HERBS AND SEEDS SCHNAPPS LIQUEUR",
      "HERBS & SEEDS SCHNAPPS LIQUEUR"
    ],
    "Coffee Liqueurs": ["COFFEE (CAFE) LIQUEUR"],
    "Nut Liqueurs": ["AMARETTO"],
    "Schnapps": ["PEPPERMINT SCHNAPPS"],
    "Other Liqueurs": [
      "ROCK & RYE, RUM & BRANDY (ETC.)", "SPECIALTIES & PROPRIETARIES",
      "SPECIALITIES & PROPRIETARIES", "OTHER SPECIALTIES & PROPRIETARIES",
      "BITTERS - BEVERAGE", "BITTERS - BEVERAGE*"
    ]
  },
  "RTD/Cocktails": {
    "Whiskey Cocktails": [
      "WHISKY MANHATTAN (48 PROOF UP)", "WHISKY MANHATTAN (UNDER 48 PROOF)",
      "WHISKY MANHATTAN UNDER 48 PROOF", "WHISKY OLD FASHIONED (48 PROOF UP)",
      "WHISKY OLD FASHIONED (UNDER 48 PROOF)", "WHISKY OLD FASHIONED UNDER 48 PROOF",
      "WHISKY SOUR (48 PROOF UP )", "WHISKY SOUR (UNDER 48 PROOF)",
      "WHISKY SOUR UNDER 48 PROOF"
    ],
    "Vodka Cocktails": [
      "VODKA MARTINI (48 PROOF UP)", "VODKA MARTINI (UNDER 48 PROOF)",
      "VODKA MARTINI  UNDER 48 PROOF", "VODKA MARTINI 48 PROOF UP",
      "SCREW DRIVER", "BLOODY MARY"
    ],
    "Gin Cocktails": [
      "GIN MARTINI (48 PROOF UP)", "GIN MARTINI (UNDER 48 PROOF)",
      "GIN MARTINI 48 PROOF UP", "GIN MARTINI UNDER 48 PROOF",
      "GIN SOUR (UNDER 48 PROOF)", "GIN SOUR UNDER 48 PROOF", "COLLINS"
    ],
    "Rum Cocktails": [
      "DAIQUIRI (48 PROOF UP)", "DAIQUIRI (UNDER 48 PROOF)",
      "DAIQUIRI 48 PROOF UP", "DAIQUIRI UNDER 48 PROOF",
      "COLADA (48PROOF UP)", "COLADA (48 PROOF UP )",
      "COLADA (UNDER 48 PROOF)", "COLADA (UNDER 48 PROOF )"
    ],
    "Tequila Cocktails": [
      "MARGARITA (48 PROOF UP)", "MARGARITA (UNDER 48 PROOF)",
      "MARGARITA 48 PROOF UP", "MARGARITA UNDER 48 PROOF",
      "OTHER TEQUILA-BASED COCKTAILS (UNDER 48 PROOF)"
    ],
    "Brandy Cocktails": [
      "BRANDY STINGER (48 PROOF UP)", "BRANDY STINGER (UNDER 48 PROOF)",
      "BRANDY STINGER UNDER 48 PROOF", "BRANDY SIDE CAR (48 PROOF UP)",
      "BRANDY SIDE CAR (UNDER 48 PROOF)", "BRANDY SIDE CAR UNDER 48 PROOF"
    ],
    "Other Cocktails": [
      "COCKTAILS 48 PROOF UP", "COCKTAILS 48 PROOF UP (CONT)",
      "COCKTAILS UNDER 48 PROOF", "COCKTAILS UNDER 48 PROOF (CONT)",
      "COCKTAILS UNDER 48 PR(CONT)", "MIXED DRINKS-HI BALLS COCKTAILS",
      "OTHER COCKTAILS (48 PROOF UP)", "OTHER COCTAILS (48PROOF UP)",
      "OTHER COCKTAILS (UNDER 48 PROOF)", "OTHER MIXED DRINKS HI-BALLS COCKTAILS",
      "EGG NOG"
    ]
  },
  "Other": {
    "Neutral Spirits": [
      "NEUTRAL SPIRITS - GRAIN", "NEUTRAL SPIRITS - FRUIT", "NEUTRAL SPIRITS - CANE",
      "NEUTRAL SPIRITS - VEGETABLE", "NEUTRAL SPIRITS - PETROLEUM",
      "GRAIN SPIRITS", "OTHER SPIRITS"
    ],
    "Non-Alcoholic": ["NON ALCOHOLIC MIXES", "NON ALCOHOL MIXES"],
    "Administrative": ["ADMINISTRATIVE WITHDRAWAL"]
  }
};

// Fallback patterns for unknown codes
const FALLBACK_PATTERNS = {
  "Whiskey": ["WHISK", "BOURBON", "SCOTCH", "RYE WHISK"],
  "Vodka": ["VODKA"],
  "Tequila": ["TEQUILA", "MEZCAL", "AGAVE"],
  "Gin": ["GIN"],
  "Rum": ["RUM", "CACHACA"],
  "Brandy": ["BRANDY", "COGNAC", "ARMAGNAC", "GRAPPA", "PISCO"],
  "Wine": ["WINE", "CHAMPAGNE", "PORT", "SHERRY", "VERMOUTH", "SAKE", "CIDER", "MEAD"],
  "Beer": ["BEER", "ALE", "MALT", "STOUT", "PORTER", "LAGER"],
  "Liqueur": ["LIQUEUR", "CORDIAL", "SCHNAPPS", "AMARETTO", "CREME DE", "BITTERS"],
  "RTD/Cocktails": ["COCKTAIL", "MARTINI", "DAIQUIRI", "MARGARITA", "COLADA", "MANHATTAN", "SOUR"]
};

// Build reverse lookup: TTB code -> { category, subcategory }
const CODE_LOOKUP = {};
for (const [category, subcategories] of Object.entries(TTB_CATEGORIES)) {
  for (const [subcategory, codes] of Object.entries(subcategories)) {
    for (const code of codes) {
      CODE_LOOKUP[code.toUpperCase()] = { category, subcategory };
    }
  }
}

/**
 * Get category and subcategory for a TTB class_type_code
 * @param {string} classTypeCode - The TTB code
 * @returns {{ category: string, subcategory: string }}
 */
function getCategory(classTypeCode) {
  if (!classTypeCode) return { category: 'Other', subcategory: 'Other' };

  const upper = classTypeCode.toUpperCase();

  // Try exact lookup first
  if (CODE_LOOKUP[upper]) {
    return CODE_LOOKUP[upper];
  }

  // Fallback: pattern matching for unknown codes
  for (const [category, patterns] of Object.entries(FALLBACK_PATTERNS)) {
    for (const pattern of patterns) {
      if (upper.includes(pattern)) {
        return { category, subcategory: `Other ${category}` };
      }
    }
  }

  return { category: 'Other', subcategory: 'Other' };
}

/**
 * Get just the category name (for backwards compatibility)
 * @param {string} classTypeCode - The TTB code
 * @returns {string}
 */
function getCategoryName(classTypeCode) {
  return getCategory(classTypeCode).category;
}

/**
 * Get list of all categories
 * @returns {string[]}
 */
function getCategories() {
  return Object.keys(TTB_CATEGORIES);
}

/**
 * Get subcategories for a category
 * @param {string} category - The category name
 * @returns {string[]}
 */
function getSubcategories(category) {
  if (!TTB_CATEGORIES[category]) return [];
  return Object.keys(TTB_CATEGORIES[category]);
}

/**
 * Get all TTB codes for a subcategory
 * @param {string} category - The category name
 * @param {string} subcategory - The subcategory name
 * @returns {string[]}
 */
function getCodesForSubcategory(category, subcategory) {
  if (!TTB_CATEGORIES[category]) return [];
  return TTB_CATEGORIES[category][subcategory] || [];
}

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
  // Node.js / Worker
  module.exports = {
    TTB_CATEGORIES,
    FALLBACK_PATTERNS,
    CODE_LOOKUP,
    getCategory,
    getCategoryName,
    getCategories,
    getSubcategories,
    getCodesForSubcategory
  };
}
