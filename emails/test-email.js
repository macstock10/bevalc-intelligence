/**
 * Test Email Script for BevAlc Intelligence
 *
 * Sends test emails with REAL DATA from D1 database.
 *
 * Usage:
 *   node test-email.js --email you@example.com --template weekly-report
 *   node test-email.js --email you@example.com --template pro-weekly-report
 *   node test-email.js --email you@example.com --template welcome
 *   node test-email.js --email you@example.com --all
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

import { sendTestEmail } from './send.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const D1_API_URL = CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_D1_DATABASE_ID
  ? `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`
  : null;

// Comprehensive TTB code to category lookup - all 420+ codes explicitly mapped
const TTB_CODE_TO_CATEGORY = {
  // Whiskey (70 codes)
  "STRAIGHT BOURBON WHISKY": "Whiskey", "BOURBON WHISKY": "Whiskey", "BOURBON WHISKY BIB": "Whiskey",
  "STRAIGHT BOURBON WHISKY BLENDS": "Whiskey", "BLENDED BOURBON WHISKY": "Whiskey",
  "STRAIGHT RYE WHISKY": "Whiskey", "RYE WHISKY": "Whiskey", "RYE WHISKY BIB": "Whiskey",
  "STRAIGHT RYE WHISKY BLENDS": "Whiskey", "BLENDED RYE WHISKY": "Whiskey",
  "AMERICAN SINGLE MALT WHISKEY": "Whiskey", "AMERICAN SINGLE MALT WHISKEY - BIB": "Whiskey",
  "STRAIGHT AMERICAN SINGLE MALT": "Whiskey", "SCOTCH WHISKY": "Whiskey", "SCOTCH WHISKY FB": "Whiskey",
  "SCOTCH WHISKY USB": "Whiskey", "SINGLE MALT SCOTCH WHISKY": "Whiskey", "UNBLENDED SCOTCH WHISKY USB": "Whiskey",
  "DILUTED SCOTCH WHISKY FB": "Whiskey", "DILUTED SCOTCH WHISKY USB": "Whiskey",
  "IRISH WHISKY": "Whiskey", "IRISH WHISKY FB": "Whiskey", "IRISH WHISKY USB": "Whiskey",
  "DILUTED IRISH WHISKY FB": "Whiskey", "DILUTED IRISH WHISKY USB": "Whiskey",
  "CANADIAN WHISKY": "Whiskey", "CANADIAN WHISKY FB": "Whiskey", "CANADIAN WHISKY USB": "Whiskey",
  "DILUTED CANADIAN WHISKY FB": "Whiskey", "DILUTED CANADIAN WHISKY USB": "Whiskey",
  "STRAIGHT CORN WHISKY": "Whiskey", "CORN WHISKY": "Whiskey", "CORN WHISKY BIB": "Whiskey",
  "STRAIGHT CORN WHISKY BLENDS": "Whiskey", "BLENDED CORN WHISKY": "Whiskey",
  "STRAIGHT MALT WHISKY": "Whiskey", "MALT WHISKY": "Whiskey",
  "STRAIGHT WHISKY": "Whiskey", "STRAIGHT WHISKY BLENDS": "Whiskey", "WHISKY BLENDS": "Whiskey",
  "BLENDED WHISKY": "Whiskey", "BLENDED LIGHT WHISKY": "Whiskey", "LIGHT WHISKY": "Whiskey",
  "DILUTED BLENDED WHISKY": "Whiskey", "OTHER WHISKY BLENDS": "Whiskey", "OTHER STRAIGHT BLENDED WHISKY": "Whiskey",
  "WHISKY": "Whiskey", "WHISKY BOTTLED IN BOND (BIB)": "Whiskey", "OTHER WHISKY BIB": "Whiskey",
  "OTHER STRAIGHT WHISKY": "Whiskey", "OTHER WHISKY (FLAVORED)": "Whiskey",
  "WHISKY ORANGE FLAVORED": "Whiskey", "WHISKY GRAPE FLAVORED": "Whiskey", "WHISKY LIME FLAVORED": "Whiskey",
  "WHISKY LEMON FLAVORED": "Whiskey", "WHISKY CHERRY FLAVORED": "Whiskey", "WHISKY CHOCOLATE FLAVORED": "Whiskey",
  "WHISKY MINT FLAVORED": "Whiskey", "WHISKY PEPPERMINT FLAVORED": "Whiskey", "WHISKY OTHER FLAVORED": "Whiskey",
  "WHISKY PROPRIETARY": "Whiskey", "SPIRIT WHISKY": "Whiskey", "DILUTED WHISKY": "Whiskey",
  "OTHER IMPORTED WHISKY": "Whiskey", "OTHER IMPORTED WHISKY FB": "Whiskey", "OTHER IMPORTED WHISKY USB": "Whiskey",
  "DILUTED OTHER IMPORTED WHISKY FB": "Whiskey", "DILUTED OTHER IMPORTED WHISKY USB": "Whiskey",
  "WHISKY SPECIALTIES": "Whiskey", "LIQUEURS (WHISKY)": "Whiskey",
  // Vodka (26 codes)
  "VODKA": "Vodka", "VODKA 80-89 PROOF": "Vodka", "VODKA 90-99 PROOF": "Vodka", "VODKA 100 PROOF UP": "Vodka",
  "VODKA 80-89 PROOF FB": "Vodka", "VODKA 80-89 PROOF USB": "Vodka", "VODKA 90-99 PROOF FB": "Vodka",
  "VODKA 90-99 PROOF USB": "Vodka", "VODKA 100 PROOF UP FB": "Vodka", "VODKA 100 PROOF UP USB": "Vodka",
  "OTHER VODKA": "Vodka", "DILUTED VODKA": "Vodka", "DILUTED VODKA FB": "Vodka", "DILUTED VODKA USB": "Vodka",
  "VODKA - FLAVORED": "Vodka", "VODKA - ORANGE FLAVORED": "Vodka", "VODKA - GRAPE FLAVORED": "Vodka",
  "VODKA - LIME FLAVORED": "Vodka", "VODKA - LEMON FLAVORED": "Vodka", "VODKA - CHERRY FLAVORED": "Vodka",
  "VODKA - CHOCOLATE FLAVORED": "Vodka", "VODKA - MINT FLAVORED": "Vodka", "VODKA - PEPPERMINT FLAVORED": "Vodka",
  "VODKA - OTHER FLAVORED": "Vodka", "VODKA SPECIALTIES": "Vodka", "LIQUEURS (VODKA)": "Vodka",
  // Tequila (12 codes)
  "TEQUILA FB": "Tequila", "TEQUILA USB": "Tequila", "DILUTED TEQUILA FB": "Tequila", "DILUTED TEQUILA USB": "Tequila",
  "MEZCAL": "Tequila", "MEZCAL FB": "Tequila", "MEZCAL US": "Tequila", "DILUTED MEZCAL": "Tequila",
  "FLAVORED MEZCAL": "Tequila", "AGAVE SPIRITS": "Tequila", "FLAVORED AGAVE SPIRIT": "Tequila", "FLAVORED TEQUILA": "Tequila",
  // Gin (30 codes)
  "LONDON DRY GIN": "Gin", "LONDON DRY DISTILLED GIN": "Gin", "LONDON DRY DISTILLED GIN FB": "Gin",
  "LONDON DRY DISTILLED GIN USB": "Gin", "LONDON DRY GIN FB": "Gin", "LONDON DRY GIN USB": "Gin",
  "DISTILLED GIN": "Gin", "OTHER DISTILLED GIN": "Gin", "OTHER DISTILLED GIN FB": "Gin", "OTHER DISTILLED GIN USB": "Gin",
  "GIN - FLAVORED": "Gin", "GIN - MINT FLAVORED": "Gin", "GIN - ORANGE FLAVORED": "Gin", "GIN - LEMON FLAVORED": "Gin",
  "GIN - CHERRY FLAVORED": "Gin", "GIN - APPLE FLAVORED": "Gin", "GIN - BLACKBERRY FLAVORED": "Gin",
  "GIN - PEACH FLAVORED": "Gin", "GIN - GRAPE FLAVORED": "Gin", "OTHER GIN - FLAVORED": "Gin",
  "GIN": "Gin", "OTHER GIN": "Gin", "OTHER GIN FB": "Gin", "OTHER GIN USB": "Gin",
  "DILUTED GIN": "Gin", "DILUTED GIN FB": "Gin", "DILUTED GIN USB": "Gin",
  "GIN SPECIALTIES": "Gin", "LIQUEURS (GIN)": "Gin", "SLOE GIN": "Gin",
  // Rum (60 codes)
  "U.S. RUM (WHITE)": "Rum", "UR.S. RUM (WHITE)": "Rum", "PUERTO RICAN RUM (WHITE)": "Rum",
  "VIRGIN ISLANDS RUM (WHITE)": "Rum", "HAWAIIAN RUM (WHITE)": "Rum", "FLORIDA RUM (WHITE)": "Rum",
  "OTHER RUM (WHITE)": "Rum", "OTHER WHITE RUM": "Rum", "CUBAN RUM WHITE FB": "Rum",
  "JAMAICAN RUM WHITE FB": "Rum", "JAMAICAN RUM WHITE USB": "Rum", "GUIANAN RUM WHITE FB": "Rum",
  "GUIANAN RUM WHITE USB": "Rum", "MARTINICAN RUM WHITE FB": "Rum", "MARTINICAN RUM WHITE USB": "Rum",
  "OTHER RUM WHITE FB": "Rum", "OTHER RUM WHITE USB": "Rum", "DILUTED RUM (WHITE)": "Rum",
  "DILUTED RUM WHITE FB": "Rum", "DILUTED RUM WHITE USB": "Rum", "U.S. RUM (GOLD)": "Rum",
  "PUERTO RICAN RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM (GOLD)": "Rum", "VIRGIN ISLANDS RUM": "Rum",
  "HAWAIIAN RUM (GOLD)": "Rum", "FLORIDA RUM (GOLD)": "Rum", "OTHER RUM (GOLD)": "Rum",
  "CUBAN RUM GOLD FB": "Rum", "JAMAICAN RUM GOLD FB": "Rum", "JAMICAN RUM GOLD USB": "Rum",
  "DUTCH GUIANAN RUM GOLD FB": "Rum", "DUTCH GUIANAN RUM GOLD USB": "Rum", "MARTINICAN RUM GOLD FB": "Rum",
  "MARTINICAN RUM GOLD USB": "Rum", "OTHER RUM GOLD FB": "Rum", "OTHER RUM GOLD USB": "Rum",
  "DILUTED RUM (GOLD)": "Rum", "DILUTED RUM GOLD FB": "Rum", "DILUTED RUM GOLD USB": "Rum",
  "RUM FLAVORED (BOLD)": "Rum", "FLAVORED RUM (BOLD)": "Rum", "RUM ORANGE GLAVORED": "Rum",
  "RUM ORANGE FLAVORED": "Rum", "RUM GRAPE FLAVORED": "Rum", "RUM LIME FLAVORED": "Rum",
  "RUM LEMON FLAVORED": "Rum", "RUM CHERRY FLAVORED": "Rum", "RUM CHOCOLATE FLAVORED": "Rum",
  "RUM MINT FLAVORED": "Rum", "RUM PEPPERMINT FLAVORED": "Rum", "RUM OTHER FLAVORED": "Rum",
  "DOMESTIC FLAVORED RUM": "Rum", "IMPORTED FLAVORED RUM": "Rum", "FOREIGN RUM": "Rum",
  "OTHER FOREIGN RUM": "Rum", "OTHER FORIEGN RUM": "Rum", "FRENCH GUIANAN RUM FB": "Rum",
  "RUM SPECIALTIES": "Rum", "LIQUEURS (RUM)": "Rum", "CACHACA": "Rum",
  // Brandy (70 codes)
  "COGNAC (BRANDY) FB": "Brandy", "COGNAC (BRANDY) USB": "Brandy", "ARMAGNAC (BRANDY) FB": "Brandy",
  "ARMAGNAC (BRANDY) USB": "Brandy", "BRANDY": "Brandy", "CALIFORNIA BRANDY": "Brandy",
  "CALIFORNIA GRAPE BRANDY": "Brandy", "CALIFORNIA DRIED BRANDY": "Brandy", "CALIFORNIA LEES BRANDY": "Brandy",
  "CALIFORNIA POMACE OR MARC BRANDY": "Brandy", "CALIFORNIA RESIDUE BRANDY": "Brandy",
  "CALIFORNIA NEUTRAL BRANDY": "Brandy", "OTHER CALIFORNIA BRANDY": "Brandy", "NEW YORK BRANDY": "Brandy",
  "NEW YORK GRAPE BRANDY": "Brandy", "NEW YORK DRIED BRANDY": "Brandy", "NEW YORK LEES BRANDY": "Brandy",
  "NEW YORK POMACE OR MARC BRANDY": "Brandy", "NEW YORK RESIDUE BRANDY": "Brandy",
  "NEW YORK NEUTRAL BRANDY": "Brandy", "OTHER NEW YORK BRANDY": "Brandy", "OTHER DOMESTIC GRAPE BRANDY": "Brandy",
  "DRIED BRANDY": "Brandy", "LEES BRANDY": "Brandy", "POMACE OR MARC BRANDY": "Brandy",
  "RESIDUE BRANDY": "Brandy", "NEUTRAL BRANDY": "Brandy", "IMMATURE BRANDY": "Brandy", "OTHER BRANDY": "Brandy",
  "FRUIT BRANDY": "Brandy", "APPLE BRANDY": "Brandy", "APPLE BRANDY (CALVADOS)": "Brandy",
  "CHERRY BRANDY": "Brandy", "PLUM BRANDY": "Brandy", "PLUM BRANDY (SLIVOVITZ)": "Brandy",
  "BLACKBERRY BRANDY": "Brandy", "BLENDED APPLE JACK BRANDY": "Brandy", "PEAR BRANDY": "Brandy",
  "APRICOT BRANDY": "Brandy", "OTHER FRUIT BRANDY": "Brandy", "FOREIGN FRUIT BRANDY": "Brandy",
  "OTHER GRAPE BRANDY (PISCO, GRAPPA) FB": "Brandy", "OTHER GRAPE BRANDY (GRAPPA) USB": "Brandy",
  "BRANDY - FLAVORED": "Brandy", "BRANDY - APRICOT FLAVORED": "Brandy", "BRANDY - BLACKBERRY FLAVORED": "Brandy",
  "BRANDY - PEACH FLAVORED": "Brandy", "BRANDY - CHERRY FLAVORED": "Brandy", "BRANDY - GINGER FLAVORED": "Brandy",
  "BRANDY - COFFEE FLAVORED": "Brandy", "BRANDY APPLE FLAVORED": "Brandy", "BRANDY APRICOT FLAVORED": "Brandy",
  "BRANDY BLACKBERRY FLAVORED": "Brandy", "BRANDY CHERRY FLAVORED": "Brandy", "BRANDY COFFEE FLAVORED": "Brandy",
  "BRANDY GINGER FLAVORED": "Brandy", "BRANDY PEACH FLAVORED": "Brandy", "OTHER BRANDY - FLAVORED": "Brandy",
  "OTHER FLAVORED BRANDY": "Brandy", "BLACKBERRY FLAVORED BRANDY": "Brandy", "CHERRY FLAVORED BRANDY": "Brandy",
  "APRICOT FLAVORED BRANDY": "Brandy", "PEACH FLAVORED BRANDY": "Brandy", "GINGER FLAVORED BRANDY": "Brandy",
  "FRENCH BRANDY": "Brandy", "OTHER FRENCH BRANDY FB": "Brandy", "OTHER FRENCH BRANDY USB": "Brandy",
  "ITALIAN GRAPE BRANDY FB": "Brandy", "ITALIAN GRAPE BRANDY USB": "Brandy", "SPANISH GRAPE BRANDY FB": "Brandy",
  "SPANISH GRAPE BRANDY USB": "Brandy", "PORTUGUESE GRAPE BRANDY FB": "Brandy", "PORTUGUESE GRAPE BRANDY USB": "Brandy",
  "GREEK GRAPE BRANDY FB": "Brandy", "GREEK GRAPE BRANDY USB": "Brandy", "GERMAN GRAPE BRANDY FB": "Brandy",
  "GERMAN GRAPE BRANDY USB": "Brandy", "AUSTRALIAN GRAPE BRANDY FB": "Brandy", "AUSTRALIAN GRAPE BRANDY USB": "Brandy",
  "SOUTH AFRICAN GRAPE BRANDY FB": "Brandy", "SOUTH AFRICAN GRAPE BRANDY USB": "Brandy",
  "OTHER FOREIGN BRANDY": "Brandy", "OTHER FOREIGN BRANDY (CONT.)": "Brandy",
  "DILUTED BRANDY FB": "Brandy", "DILUTED BRANDY USB": "Brandy", "LIQUEUR & BRANDY": "Brandy",
  // Wine (28 codes)
  "TABLE RED WINE": "Wine", "TABLE WHITE WINE": "Wine", "ROSE WINE": "Wine",
  "SPARKLING WINE/CHAMPAGNE": "Wine", "SPARKLING WINE/ CIDER": "Wine", "SPARKLING WINE/MEAD": "Wine",
  "CARBONATED WINE": "Wine", "CARBONATED WINE/CIDER": "Wine", "CARBONATED WINE/MEAD": "Wine",
  "DESSERT /PORT/SHERRY/(COOKING) WINE": "Wine", "DESSERT FLAVORED WINE": "Wine", "DESSERT FRUIT WINE": "Wine",
  "HONEY BASED DESSERT WINE": "Wine", "APPLE BASED DESSERT FLAVORED WINE": "Wine", "APPLE DESSERT WINE/CIDER": "Wine",
  "TABLE FLAVORED WINE": "Wine", "APPLE BASED FLAVORED WINE": "Wine", "HONEY BASED TABLE WINE": "Wine",
  "TABLE FRUIT WINE": "Wine", "APPLE TABLE WINE/CIDER": "Wine", "VERMOUTH/MIXED TYPES": "Wine",
  "SAKE": "Wine", "SAKE - IMPORTED": "Wine", "SAKE - DOMESTIC FLAVORED": "Wine", "SAKE - IMPORTED FLAVORED": "Wine",
  // Beer (14 codes)
  "BEER": "Beer", "IRC BEER": "Beer", "IRC BEER-IMPORTED": "Beer",
  "OTHER MALT BEVERAGES (BEER)": "Beer", "OTHER MALT BEVERAGES": "Beer", "ALE": "Beer", "STOUT": "Beer",
  "PORTER": "Beer", "MALT LIQUOR": "Beer", "MALT BEVERAGES": "Beer",
  "MALT BEVERAGES SPECIALITIES - FLAVORED": "Beer", "MALT BEVERAGES SPECIALITIES": "Beer",
  "CEREAL BEVERAGES - NEAR BEER (NON ALCOHOLIC)": "Beer",
  // Liqueur (35 codes)
  "CORDIALS (FRUIT & PEELS)": "Liqueur", "FRUIT FLAVORED LIQUEURS": "Liqueur", "CURACAO": "Liqueur",
  "TRIPLE SEC": "Liqueur", "OTHER FRUITS & PEELS LIQUEURS": "Liqueur", "OTHER FRUIT & PEELS LIQUEURS": "Liqueur",
  "FRUITS & PEELS SCHNAPPS LIQUEUR": "Liqueur", "CORDIALS (CREMES OR CREAMS)": "Liqueur",
  "CREME DE CACAO WHITE": "Liqueur", "CREME DE CACAO BROWN": "Liqueur", "CREME DE MENTHE WHITE": "Liqueur",
  "CREME DE MENTHE GREEN": "Liqueur", "CREME DE ALMOND (NOYAUX)": "Liqueur", "DAIRY CREAM LIQUEUR/CORDIAL": "Liqueur",
  "NON DAIRY CREME LIQUEUR/CORDIAL": "Liqueur", "OTHER LIQUEUR (CREME OR CREAMS)": "Liqueur",
  "OTHER LIQUEUR (CREMES OR CREAMS)": "Liqueur", "CORDIALS (HERBS & SEEDS)": "Liqueur",
  "ANISETTE, OUZO, OJEN": "Liqueur", "KUMMEL": "Liqueur", "ARACK/RAKI": "Liqueur", "SAMBUCA": "Liqueur",
  "OTHER (HERBS & SEEDS)": "Liqueur", "OTHER HERB & SEED CORDIALS/LIQUEURS": "Liqueur",
  "HERBS AND SEEDS SCHNAPPS LIQUEUR": "Liqueur", "HERBS & SEEDS SCHNAPPS LIQUEUR": "Liqueur",
  "COFFEE (CAFE) LIQUEUR": "Liqueur", "AMARETTO": "Liqueur", "PEPPERMINT SCHNAPPS": "Liqueur",
  "ROCK & RYE, RUM & BRANDY (ETC.)": "Liqueur", "SPECIALTIES & PROPRIETARIES": "Liqueur",
  "SPECIALITIES & PROPRIETARIES": "Liqueur", "OTHER SPECIALTIES & PROPRIETARIES": "Liqueur",
  "BITTERS - BEVERAGE": "Liqueur", "BITTERS - BEVERAGE*": "Liqueur",
  // RTD/Cocktails (45 codes)
  "WHISKY MANHATTAN (48 PROOF UP)": "RTD", "WHISKY MANHATTAN (UNDER 48 PROOF)": "RTD",
  "WHISKY MANHATTAN UNDER 48 PROOF": "RTD", "WHISKY OLD FASHIONED (48 PROOF UP)": "RTD",
  "WHISKY OLD FASHIONED (UNDER 48 PROOF)": "RTD", "WHISKY OLD FASHIONED UNDER 48 PROOF": "RTD",
  "WHISKY SOUR (48 PROOF UP )": "RTD", "WHISKY SOUR (UNDER 48 PROOF)": "RTD", "WHISKY SOUR UNDER 48 PROOF": "RTD",
  "VODKA MARTINI (48 PROOF UP)": "RTD", "VODKA MARTINI (UNDER 48 PROOF)": "RTD",
  "VODKA MARTINI  UNDER 48 PROOF": "RTD", "VODKA MARTINI 48 PROOF UP": "RTD",
  "SCREW DRIVER": "RTD", "BLOODY MARY": "RTD",
  "GIN MARTINI (48 PROOF UP)": "RTD", "GIN MARTINI (UNDER 48 PROOF)": "RTD",
  "GIN MARTINI 48 PROOF UP": "RTD", "GIN MARTINI UNDER 48 PROOF": "RTD",
  "GIN SOUR (UNDER 48 PROOF)": "RTD", "GIN SOUR UNDER 48 PROOF": "RTD", "COLLINS": "RTD",
  "DAIQUIRI (48 PROOF UP)": "RTD", "DAIQUIRI (UNDER 48 PROOF)": "RTD",
  "DAIQUIRI 48 PROOF UP": "RTD", "DAIQUIRI UNDER 48 PROOF": "RTD",
  "COLADA (48PROOF UP)": "RTD", "COLADA (48 PROOF UP )": "RTD",
  "COLADA (UNDER 48 PROOF)": "RTD", "COLADA (UNDER 48 PROOF )": "RTD",
  "MARGARITA (48 PROOF UP)": "RTD", "MARGARITA (UNDER 48 PROOF)": "RTD",
  "MARGARITA 48 PROOF UP": "RTD", "MARGARITA UNDER 48 PROOF": "RTD",
  "OTHER TEQUILA-BASED COCKTAILS (UNDER 48 PROOF)": "RTD",
  "BRANDY STINGER (48 PROOF UP)": "RTD", "BRANDY STINGER (UNDER 48 PROOF)": "RTD",
  "BRANDY STINGER UNDER 48 PROOF": "RTD", "BRANDY SIDE CAR (48 PROOF UP)": "RTD",
  "BRANDY SIDE CAR (UNDER 48 PROOF)": "RTD", "BRANDY SIDE CAR UNDER 48 PROOF": "RTD",
  "COCKTAILS 48 PROOF UP": "RTD", "COCKTAILS 48 PROOF UP (CONT)": "RTD",
  "COCKTAILS UNDER 48 PROOF": "RTD", "COCKTAILS UNDER 48 PROOF (CONT)": "RTD",
  "COCKTAILS UNDER 48 PR(CONT)": "RTD", "MIXED DRINKS-HI BALLS COCKTAILS": "RTD",
  "OTHER COCKTAILS (48 PROOF UP)": "RTD", "OTHER COCTAILS (48PROOF UP)": "RTD",
  "OTHER COCKTAILS (UNDER 48 PROOF)": "RTD", "OTHER MIXED DRINKS HI-BALLS COCKTAILS": "RTD", "EGG NOG": "RTD",
  // Other (10 codes)
  "NEUTRAL SPIRITS - GRAIN": "Other", "NEUTRAL SPIRITS - FRUIT": "Other", "NEUTRAL SPIRITS - CANE": "Other",
  "NEUTRAL SPIRITS - VEGETABLE": "Other", "NEUTRAL SPIRITS - PETROLEUM": "Other",
  "GRAIN SPIRITS": "Other", "OTHER SPIRITS": "Other",
  "NON ALCOHOLIC MIXES": "Other", "NON ALCOHOL MIXES": "Other", "ADMINISTRATIVE WITHDRAWAL": "Other"
};

// Fallback patterns for unknown codes (used only when exact match fails)
const FALLBACK_PATTERNS = [
  // Beer first to catch MALT BEVERAGE before MALT WHISKY
  ['MALT BEVER', 'Beer'], ['MALT LIQ', 'Beer'], ['BEER', 'Beer'], ['ALE', 'Beer'],
  ['STOUT', 'Beer'], ['LAGER', 'Beer'], ['PORTER', 'Beer'],
  // Whiskey - WHISK catches both WHISKY and WHISKEY
  ['WHISK', 'Whiskey'], ['BOURBON', 'Whiskey'], ['SCOTCH', 'Whiskey'], ['TENNESSEE', 'Whiskey'],
  ['VODKA', 'Vodka'],
  ['TEQUILA', 'Tequila'], ['MEZCAL', 'Tequila'], ['AGAVE', 'Tequila'],
  ['GIN', 'Gin'],
  ['RUM', 'Rum'], ['CACHACA', 'Rum'],
  ['BRANDY', 'Brandy'], ['COGNAC', 'Brandy'], ['ARMAGNAC', 'Brandy'], ['GRAPPA', 'Brandy'], ['PISCO', 'Brandy'],
  ['WINE', 'Wine'], ['CHAMPAGNE', 'Wine'], ['SHERRY', 'Wine'], ['VERMOUTH', 'Wine'], ['SAKE', 'Wine'],
  ['LIQUEUR', 'Liqueur'], ['CORDIAL', 'Liqueur'], ['SCHNAPPS', 'Liqueur'], ['AMARETTO', 'Liqueur'],
  ['COCKTAIL', 'RTD'], ['MARGARITA', 'RTD'], ['DAIQUIRI', 'RTD'], ['MARTINI', 'RTD'], ['COLADA', 'RTD'],
];

// ============================================================================
// HELPERS
// ============================================================================

// Get category for a TTB code - uses exact lookup first, then fallback patterns
function getCategory(classTypeCode) {
  if (!classTypeCode) return 'Other';
  const code = classTypeCode.trim().toUpperCase();

  // Try exact lookup first
  if (TTB_CODE_TO_CATEGORY[code]) {
    return TTB_CODE_TO_CATEGORY[code];
  }

  // Fallback: pattern matching for unknown codes
  for (const [pattern, category] of FALLBACK_PATTERNS) {
    if (code.includes(pattern)) {
      return category;
    }
  }

  return 'Other';
}

// Get all TTB codes that belong to a category
function getCodesForCategory(category) {
  const codes = [];
  for (const [code, cat] of Object.entries(TTB_CODE_TO_CATEGORY)) {
    if (cat === category) {
      codes.push(code);
    }
  }
  return codes;
}

// Build SQL WHERE clause for filtering by categories
function buildCategoryFilter(categories) {
  if (!categories || categories.length === 0) return '';

  const allCodes = [];
  for (const category of categories) {
    const codes = getCodesForCategory(category);
    allCodes.push(...codes);
  }

  if (allCodes.length === 0) return '';

  // Use exact matches with IN clause for better performance
  const escapedCodes = allCodes.map(code => `'${code.replace(/'/g, "''")}'`);
  return `AND class_type_code IN (${escapedCodes.join(', ')})`;
}

function makeSlug(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ============================================================================
// D1 QUERIES
// ============================================================================

async function d1Query(sql) {
  if (!D1_API_URL) {
    console.error('D1 API not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN');
    return [];
  }

  const response = await fetch(D1_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (!response.ok) {
    console.error(`D1 API error: ${response.status}`);
    return [];
  }

  const data = await response.json();
  if (data.success && data.result) {
    return data.result[0]?.results || [];
  }
  return [];
}

function getWeekDates() {
  const today = new Date();

  // Find last Sunday (end of last complete week)
  let daysSinceSunday = (today.getDay() + 0) % 7;
  if (daysSinceSunday === 0) daysSinceSunday = 7;

  const thisWeekEnd = new Date(today);
  thisWeekEnd.setDate(today.getDate() - daysSinceSunday);

  const thisWeekStart = new Date(thisWeekEnd);
  thisWeekStart.setDate(thisWeekEnd.getDate() - 6);

  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(thisWeekStart.getDate() - 1);

  const lastWeekStart = new Date(lastWeekEnd);
  lastWeekStart.setDate(lastWeekEnd.getDate() - 6);

  return { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd };
}

function dateRangeSql(start, end) {
  const conditions = [];

  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      conditions.push(`(year = ${start.getFullYear()} AND month = ${start.getMonth() + 1} AND day >= ${start.getDate()} AND day <= ${end.getDate()})`);
    } else {
      conditions.push(`(year = ${start.getFullYear()} AND ((month = ${start.getMonth() + 1} AND day >= ${start.getDate()}) OR (month > ${start.getMonth() + 1} AND month < ${end.getMonth() + 1}) OR (month = ${end.getMonth() + 1} AND day <= ${end.getDate()})))`);
    }
  } else {
    conditions.push(`(year = ${start.getFullYear()} AND month = ${start.getMonth() + 1} AND day >= ${start.getDate()})`);
    conditions.push(`(year = ${end.getFullYear()} AND month = ${end.getMonth() + 1} AND day <= ${end.getDate()})`);
  }

  return '(' + conditions.join(' OR ') + ')';
}

// ============================================================================
// FETCH REAL METRICS FROM D1
// ============================================================================

async function fetchEmailMetrics() {
  console.log('  Fetching real data from D1...');

  const { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd } = getWeekDates();
  const thisWeekSql = dateRangeSql(thisWeekStart, thisWeekEnd);
  const lastWeekSql = dateRangeSql(lastWeekStart, lastWeekEnd);

  console.log(`  Week: ${thisWeekStart.toLocaleDateString()} - ${thisWeekEnd.toLocaleDateString()}`);

  // 1. Total filings this week
  const totalThisWeek = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED'
  `);
  const totalFilings = totalThisWeek[0]?.count || 0;

  // 2. Total filings last week
  const totalLastWeek = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${lastWeekSql} AND status = 'APPROVED'
  `);
  const lastWeekCount = totalLastWeek[0]?.count || 0;

  // 3. New brands this week
  const newBrandsResult = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_BRAND'
  `);
  const newBrands = newBrandsResult[0]?.count || 0;

  // 4. New SKUs this week
  const newSkusResult = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_SKU'
  `);
  const newSkus = newSkusResult[0]?.count || 0;

  // 5. New companies this week
  const newCompaniesResult = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_COMPANY'
  `);
  const newCompanies = newCompaniesResult[0]?.count || 0;

  // 6. Top filing companies this week
  const topCompanies = await d1Query(`
    SELECT company_name, class_type_code, COUNT(*) as filings
    FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED'
    GROUP BY company_name
    ORDER BY filings DESC
    LIMIT 5
  `);

  const topCompaniesList = topCompanies.map(row => ({
    company: row.company_name,
    category: getCategory(row.class_type_code || ''),
    filings: row.filings,
  }));

  const topFiler = topCompaniesList[0]?.company || 'N/A';
  const topFilerCount = topCompaniesList[0]?.filings || 0;

  // 7. Top brand extensions
  const topExtensions = await d1Query(`
    SELECT brand_name, company_name, class_type_code, COUNT(*) as new_skus
    FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_SKU'
    GROUP BY brand_name, company_name
    ORDER BY new_skus DESC
    LIMIT 5
  `);

  const topExtensionsList = topExtensions.map(row => ({
    brand: row.brand_name,
    company: row.company_name,
    category: getCategory(row.class_type_code || ''),
    newSkus: row.new_skus,
  }));

  // 8. Category breakdown
  const categoryData = await d1Query(`
    SELECT class_type_code, COUNT(*) as count
    FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED'
    GROUP BY class_type_code
  `);

  const categoryTotals = {};
  for (const row of categoryData) {
    const cat = getCategory(row.class_type_code || '');
    categoryTotals[cat] = (categoryTotals[cat] || 0) + row.count;
  }

  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const categoryList = sortedCategories.map(([label, value]) => ({ label, value }));

  // 9. Last week categories for trend
  const lastWeekCategories = await d1Query(`
    SELECT class_type_code, COUNT(*) as count
    FROM colas
    WHERE ${lastWeekSql} AND status = 'APPROVED'
    GROUP BY class_type_code
  `);

  const lastWeekTotals = {};
  for (const row of lastWeekCategories) {
    const cat = getCategory(row.class_type_code || '');
    lastWeekTotals[cat] = (lastWeekTotals[cat] || 0) + row.count;
  }

  // Find biggest mover category
  let biggestChange = null;
  let biggestPct = 0;
  for (const [cat, thisCount] of Object.entries(categoryTotals)) {
    const lastCount = lastWeekTotals[cat] || 0;
    if (lastCount > 10) {
      const pctChange = ((thisCount - lastCount) / lastCount) * 100;
      if (Math.abs(pctChange) > Math.abs(biggestPct)) {
        biggestPct = pctChange;
        biggestChange = cat;
      }
    }
  }

  // Calculate week-over-week change for total filings
  const wowChange = lastWeekCount > 0
    ? Math.round(((totalFilings - lastWeekCount) / lastWeekCount) * 100)
    : 0;
  const wowDirection = wowChange >= 0 ? 'up' : 'down';

  // Build summary bullets array
  const summaryBullets = [
    `${totalFilings.toLocaleString()} total filings (${wowChange >= 0 ? '+' : ''}${wowChange}% vs last week)`,
    `${newBrands} new brands, ${newSkus} new SKUs`,
  ];

  // Add biggest category mover if significant
  if (biggestChange && Math.abs(biggestPct) > 10) {
    const direction = biggestPct > 0 ? 'up' : 'down';
    summaryBullets.push(`${biggestChange} ${direction} ${Math.abs(Math.round(biggestPct))}% week-over-week`);
  }

  // Add top filer
  if (topCompaniesList.length > 0) {
    summaryBullets.push(`Top filer: ${topFiler} (${topFilerCount} filings)`);
  }

  // 10. Notable new brands preview
  const notablePreview = await d1Query(`
    SELECT ttb_id, brand_name, company_name, class_type_code
    FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_BRAND'
    ORDER BY approval_date DESC
    LIMIT 3
  `);

  const notableNewBrandsPreview = notablePreview.map(row => ({
    brand: row.brand_name,
    company: row.company_name,
    category: getCategory(row.class_type_code || ''),
  }));

  // Format week ending date
  const weekEnding = thisWeekEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return {
    weekEnding,
    summaryBullets,
    totalFilings: totalFilings.toLocaleString(),
    newBrands: String(newBrands),
    newSkus: String(newSkus),
    newCompanies: String(newCompanies),
    topFiler,
    topFilerCount: String(topFilerCount),
    categoryData: categoryList,
    topCompaniesList,
    topExtensionsList,
    notableNewBrandsPreview,
    databaseUrl: 'https://bevalcintel.com/database',
  };
}

async function fetchProMetrics(email) {
  console.log('  Fetching Pro metrics from D1...');

  const baseMetrics = await fetchEmailMetrics();

  // Get user's watchlist counts
  const watchlistCounts = await d1Query(`
    SELECT type, COUNT(*) as count FROM watchlist
    WHERE email = '${email.replace(/'/g, "''")}'
    GROUP BY type
  `);
  const watchedCompaniesCount = watchlistCounts.find(r => r.type === 'company')?.count || 0;
  const watchedBrandsCount = watchlistCounts.find(r => r.type === 'brand')?.count || 0;
  console.log(`  Watchlist: ${watchedCompaniesCount} companies, ${watchedBrandsCount} brands`);

  // Get user's category preferences
  const userPrefs = await d1Query(`
    SELECT categories FROM user_preferences
    WHERE email = '${email.replace(/'/g, "''")}'
  `);
  let subscribedCategories = [];
  if (userPrefs.length > 0 && userPrefs[0].categories) {
    try {
      subscribedCategories = JSON.parse(userPrefs[0].categories);
    } catch (e) {
      subscribedCategories = [];
    }
  }
  const categoryFilter = buildCategoryFilter(subscribedCategories);
  const hasCategories = subscribedCategories.length > 0;
  console.log(`  Categories: ${hasCategories ? subscribedCategories.join(', ') : 'All (no filter)'}`);

  const { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd } = getWeekDates();
  const thisWeekSql = dateRangeSql(thisWeekStart, thisWeekEnd);
  const lastWeekSql = dateRangeSql(lastWeekStart, lastWeekEnd);

  // Week-over-week change
  const totalThis = parseInt(baseMetrics.totalFilings.replace(/,/g, ''));
  const totalLastResult = await d1Query(`
    SELECT COUNT(*) as count FROM colas
    WHERE ${lastWeekSql} AND status = 'APPROVED'
  `);
  const totalLast = totalLastResult[0]?.count || 0;

  let weekOverWeekChange = '+0%';
  if (totalLast > 0) {
    const pctChange = Math.round(((totalThis - totalLast) / totalLast) * 100);
    weekOverWeekChange = pctChange >= 0 ? `+${pctChange}%` : `${pctChange}%`;
  }

  // Get 4-week averages for companies (filtered by user's categories if set)
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeekSql = dateRangeSql(fourWeeksAgo, new Date());

  const avgPerCompany = await d1Query(`
    SELECT company_name, ROUND(COUNT(*) / 4.0) as avg_filings
    FROM colas
    WHERE ${fourWeekSql} AND status = 'APPROVED' ${categoryFilter}
    GROUP BY company_name
    HAVING COUNT(*) >= 4
  `);
  const avgLookup = {};
  for (const r of avgPerCompany) {
    avgLookup[r.company_name] = r.avg_filings;
  }

  // Top companies this week (filtered by user's categories if set)
  const topCompaniesFiltered = await d1Query(`
    SELECT company_name, COUNT(*) as filings
    FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED' ${categoryFilter}
    GROUP BY company_name
    ORDER BY filings DESC
    LIMIT 5
  `);

  const topCompaniesWithChange = topCompaniesFiltered.map(comp => {
    const avg = avgLookup[comp.company_name] || 0;
    const change = avg > 0 ? comp.filings - avg : comp.filings;
    return {
      company: comp.company_name,
      filings: comp.filings,
      change: change >= 0 ? `+${change}` : String(change),
    };
  });

  // Filing spikes (companies with 2x+ their average, filtered by categories)
  const thisWeekByCompany = await d1Query(`
    SELECT company_name, COUNT(*) as filings
    FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED' ${categoryFilter}
    GROUP BY company_name
    HAVING COUNT(*) >= 10
    ORDER BY filings DESC
  `);

  const filingSpikes = [];
  for (const row of thisWeekByCompany) {
    const avg = avgLookup[row.company_name] || 0;
    if (avg > 0 && row.filings >= avg * 2) {
      const pctIncrease = Math.round(((row.filings - avg) / avg) * 100);
      if (pctIncrease >= 100) {
        filingSpikes.push({
          company: row.company_name,
          thisWeek: row.filings,
          avgWeek: Math.round(avg),
          percentIncrease: pctIncrease,
        });
      }
    }
  }
  filingSpikes.sort((a, b) => b.percentIncrease - a.percentIncrease);
  const topSpikes = filingSpikes.slice(0, 3);

  // Notable new brands (filtered by user's categories if set)
  const notableBrands = await d1Query(`
    SELECT ttb_id, brand_name, company_name, class_type_code
    FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_BRAND' ${categoryFilter}
    ORDER BY approval_date DESC
    LIMIT 5
  `);

  const notableNewBrands = notableBrands.map(row => ({
    brand: row.brand_name,
    company: row.company_name,
    category: getCategory(row.class_type_code || ''),
    ttbId: row.ttb_id,
    ttbLink: `https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=${row.ttb_id}`,
  }));

  // Full new filings list - filtered by user's categories if set
  const newFilingsRaw = await d1Query(`
    SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
    FROM colas
    WHERE ${thisWeekSql} AND signal IN ('NEW_BRAND', 'NEW_SKU') ${categoryFilter}
    ORDER BY approval_date DESC
    LIMIT 500
  `);

  // Group by category and limit to 7 per category (mix of brands and SKUs)
  const categoryFilings = {};
  for (const row of newFilingsRaw) {
    const category = getCategory(row.class_type_code || '');
    if (!categoryFilings[category]) {
      categoryFilings[category] = { NEW_BRAND: [], NEW_SKU: [] };
    }
    if (categoryFilings[category][row.signal].length < 4) {
      categoryFilings[category][row.signal].push(row);
    }
  }

  // Build final list: up to 7 per category (alternating brands and SKUs)
  const newFilingsList = [];
  for (const [category, signals] of Object.entries(categoryFilings)) {
    const brands = signals.NEW_BRAND || [];
    const skus = signals.NEW_SKU || [];
    let count = 0;
    let bi = 0, si = 0;
    // Alternate between brands and SKUs
    while (count < 7 && (bi < brands.length || si < skus.length)) {
      if (bi < brands.length && (count % 2 === 0 || si >= skus.length)) {
        const row = brands[bi++];
        newFilingsList.push({
          brand: row.brand_name,
          fancifulName: row.fanciful_name || row.brand_name,
          company: row.company_name,
          signal: row.signal,
          category,
          ttbId: row.ttb_id,
          ttbLink: `https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=${row.ttb_id}`,
        });
        count++;
      } else if (si < skus.length) {
        const row = skus[si++];
        newFilingsList.push({
          brand: row.brand_name,
          fancifulName: row.fanciful_name || row.brand_name,
          company: row.company_name,
          signal: row.signal,
          category,
          ttbId: row.ttb_id,
          ttbLink: `https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=${row.ttb_id}`,
        });
        count++;
      }
    }
  }

  // Format dates for database link
  const weekStartDate = thisWeekStart.toISOString().split('T')[0];
  const weekEndDate = thisWeekEnd.toISOString().split('T')[0];

  // Filter category data to only show user's subscribed categories
  let filteredCategoryData = baseMetrics.categoryData;
  if (hasCategories) {
    filteredCategoryData = baseMetrics.categoryData.filter(
      cat => subscribedCategories.includes(cat.label)
    );
  }

  // Get filtered top filer from the category-filtered results
  const filteredTopFiler = topCompaniesWithChange.length > 0 ? topCompaniesWithChange[0].company : baseMetrics.topFiler;
  const filteredTopFilerCount = topCompaniesWithChange.length > 0 ? String(topCompaniesWithChange[0].filings) : baseMetrics.topFilerCount;

  // Rebuild summary bullets with filtered top filer
  const filteredSummaryBullets = [
    baseMetrics.summaryBullets[0], // Total filings + WoW change
    baseMetrics.summaryBullets[1], // New brands and SKUs
  ];
  // Add biggest category mover if it was in the original bullets and is in user's categories
  if (baseMetrics.summaryBullets[2] && (!hasCategories || subscribedCategories.some(cat => baseMetrics.summaryBullets[2].includes(cat)))) {
    filteredSummaryBullets.push(baseMetrics.summaryBullets[2]);
  }
  // Add filtered top filer
  if (topCompaniesWithChange.length > 0) {
    filteredSummaryBullets.push(`Top filer: ${filteredTopFiler} (${filteredTopFilerCount} filings)`);
  }

  return {
    ...baseMetrics,
    summaryBullets: filteredSummaryBullets,
    categoryData: filteredCategoryData,
    topFiler: filteredTopFiler,
    topFilerCount: filteredTopFilerCount,
    weekOverWeekChange,
    watchlistMatches: [], // TODO: fetch actual watchlist matches
    watchedCompaniesCount,
    watchedBrandsCount,
    topCompaniesList: topCompaniesWithChange,
    notableNewBrands,
    filingSpikes: topSpikes,
    newFilingsList,
    categoryReports: [],
    weekStartDate,
    weekEndDate,
    accountUrl: 'https://bevalcintel.com/account.html',
    preferencesUrl: 'https://bevalcintel.com/preferences.html',
  };
}

// ============================================================================
// SEND EMAILS
// ============================================================================

async function sendTestWeeklyReport(email) {
  console.log('\nSending weekly report with REAL data...');
  try {
    const metrics = await fetchEmailMetrics();
    console.log(`  Stats: ${metrics.totalFilings} filings, ${metrics.newBrands} new brands, ${metrics.newSkus} new SKUs`);
    console.log(`  Summary: ${metrics.summaryBullets?.length || 0} bullets`);

    const result = await sendTestEmail({
      to: email,
      template: 'weekly-report',
      props: metrics,
    });

    if (result.error) {
      console.error('  Failed:', result.error.message);
      return false;
    }

    console.log('  Success! Message ID:', result.data?.id);
    return true;
  } catch (error) {
    console.error('  Error:', error.message);
    return false;
  }
}

async function sendTestProWeeklyReport(email) {
  console.log('\nSending Pro weekly report with REAL data...');
  try {
    const metrics = await fetchProMetrics(email);
    console.log(`  Stats: ${metrics.totalFilings} filings, ${metrics.newBrands} new brands`);
    console.log(`  Week-over-week: ${metrics.weekOverWeekChange}`);
    console.log(`  Filing spikes: ${metrics.filingSpikes.length}`);
    console.log(`  New filings in list: ${metrics.newFilingsList.length}`);

    const result = await sendTestEmail({
      to: email,
      template: 'pro-weekly-report',
      props: metrics,
    });

    if (result.error) {
      console.error('  Failed:', result.error.message);
      return false;
    }

    console.log('  Success! Message ID:', result.data?.id);
    return true;
  } catch (error) {
    console.error('  Error:', error.message);
    return false;
  }
}

async function sendTestWelcome(email) {
  console.log('\nSending welcome email...');
  try {
    const result = await sendTestEmail({
      to: email,
      template: 'welcome',
      props: { email },
    });

    if (result.error) {
      console.error('  Failed:', result.error.message);
      return false;
    }

    console.log('  Success! Message ID:', result.data?.id);
    return true;
  } catch (error) {
    console.error('  Error:', error.message);
    return false;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let email = null;
  let template = null;
  let sendAll = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === '--template' && args[i + 1]) {
      template = args[++i];
    } else if (args[i] === '--all') {
      sendAll = true;
    } else if (args[i] === '--help') {
      console.log(`
BevAlc Email Test Tool

Sends test emails with REAL DATA from the D1 database.

Usage:
  node test-email.js --email <addr> --template <name>
  node test-email.js --email <addr> --all

Templates:
  weekly-report      Weekly report email (free users)
  pro-weekly-report  Pro weekly report email (Pro subscribers)
  welcome            New subscriber welcome email

Examples:
  node test-email.js --email you@example.com --template weekly-report
  node test-email.js --email you@example.com --template pro-weekly-report
  node test-email.js --email you@example.com --all

Required environment variables:
  RESEND_API_KEY
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_D1_DATABASE_ID
  CLOUDFLARE_API_TOKEN
`);
      process.exit(0);
    }
  }

  // Validate config
  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY not found in environment.');
    process.exit(1);
  }

  if (!D1_API_URL) {
    console.error('Error: D1 API not configured.');
    console.error('Required: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  if (!email) {
    console.error('Error: --email is required');
    console.error('Usage: node test-email.js --email you@example.com --template weekly-report');
    process.exit(1);
  }

  console.log('\n=== BevAlc Email Test ===\n');
  console.log('Sending to:', email);

  let success = true;

  if (sendAll) {
    const r1 = await sendTestWeeklyReport(email);
    const r2 = await sendTestProWeeklyReport(email);
    const r3 = await sendTestWelcome(email);
    success = r1 && r2 && r3;
  } else if (template === 'weekly-report') {
    success = await sendTestWeeklyReport(email);
  } else if (template === 'pro-weekly-report') {
    success = await sendTestProWeeklyReport(email);
  } else if (template === 'welcome') {
    success = await sendTestWelcome(email);
  } else {
    console.error('Error: --template is required');
    console.error('Options: weekly-report, pro-weekly-report, welcome, or --all');
    process.exit(1);
  }

  console.log('\n' + (success ? 'Done!' : 'Some emails failed to send.'));
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
