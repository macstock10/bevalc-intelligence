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

// TTB code to category mapping - order matters! Check specific patterns first
const TTB_CODE_CATEGORIES = [
  // Whiskey variants
  ['WHISKY', 'Whiskey'], ['WHISKEY', 'Whiskey'], ['BOURBON', 'Whiskey'], ['SCOTCH', 'Whiskey'],
  ['RYE', 'Whiskey'], ['MALT', 'Whiskey'], ['TENNESSEE', 'Whiskey'],
  // Vodka
  ['VODKA', 'Vodka'],
  // Tequila/Agave
  ['TEQUILA', 'Tequila'], ['MEZCAL', 'Tequila'], ['AGAVE', 'Tequila'],
  // Gin
  ['GIN', 'Gin'],
  // Wine - check for WINE anywhere in the string
  ['WINE', 'Wine'], ['CHAMPAGNE', 'Wine'], ['SPARKLING', 'Wine'], ['PORT', 'Wine'], ['SHERRY', 'Wine'],
  // Beer
  ['BEER', 'Beer'], ['ALE', 'Beer'], ['MALT BEVERAGE', 'Beer'], ['STOUT', 'Beer'], ['LAGER', 'Beer'],
  // RTD
  ['COCKTAIL', 'RTD'], ['MARGARITA', 'RTD'], ['SELTZER', 'RTD'], ['COOLER', 'RTD'],
  // Rum
  ['RUM', 'Rum'],
  // Brandy
  ['BRANDY', 'Brandy'], ['COGNAC', 'Brandy'],
  // Liqueur
  ['CORDIAL', 'Liqueur'], ['AMARETTO', 'Liqueur'], ['TRIPLE SEC', 'Liqueur'], ['LIQUEUR', 'Liqueur'],
];

// ============================================================================
// HELPERS
// ============================================================================

function getCategory(classTypeCode) {
  if (!classTypeCode) return 'Other';
  const code = classTypeCode.trim().toUpperCase();

  // Check each pattern - first match wins
  for (const [pattern, category] of TTB_CODE_CATEGORIES) {
    if (code.includes(pattern)) {
      return category;
    }
  }
  return 'Other';
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

  // Find biggest mover for summary
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

  let summary;
  if (biggestChange && Math.abs(biggestPct) > 10) {
    const direction = biggestPct > 0 ? 'up' : 'down';
    summary = `${biggestChange} filings ${direction} ${Math.abs(Math.round(biggestPct))}% week-over-week`;
  } else {
    summary = `${totalFilings.toLocaleString()} label approvals processed this week`;
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
    summary,
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

async function fetchProMetrics() {
  console.log('  Fetching Pro metrics from D1...');

  const baseMetrics = await fetchEmailMetrics();

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

  // Get 4-week averages for companies
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeekSql = dateRangeSql(fourWeeksAgo, new Date());

  const avgPerCompany = await d1Query(`
    SELECT company_name, ROUND(COUNT(*) / 4.0) as avg_filings
    FROM colas
    WHERE ${fourWeekSql} AND status = 'APPROVED'
    GROUP BY company_name
    HAVING COUNT(*) >= 4
  `);
  const avgLookup = {};
  for (const r of avgPerCompany) {
    avgLookup[r.company_name] = r.avg_filings;
  }

  // Top companies with change vs avg
  const topCompaniesWithChange = baseMetrics.topCompaniesList.map(comp => {
    const avg = avgLookup[comp.company] || 0;
    const change = avg > 0 ? comp.filings - avg : comp.filings;
    return {
      company: comp.company,
      filings: comp.filings,
      change: change >= 0 ? `+${change}` : String(change),
    };
  });

  // Filing spikes (companies with 2x+ their average)
  const thisWeekByCompany = await d1Query(`
    SELECT company_name, COUNT(*) as filings
    FROM colas
    WHERE ${thisWeekSql} AND status = 'APPROVED'
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

  // Notable new brands
  const notableBrands = await d1Query(`
    SELECT ttb_id, brand_name, company_name, class_type_code
    FROM colas
    WHERE ${thisWeekSql} AND signal = 'NEW_BRAND'
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

  // Full new filings list - fetch more, then limit to 7 per category with mixed signals
  const newFilingsRaw = await d1Query(`
    SELECT ttb_id, brand_name, fanciful_name, company_name, class_type_code, signal
    FROM colas
    WHERE ${thisWeekSql} AND signal IN ('NEW_BRAND', 'NEW_SKU')
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

  return {
    ...baseMetrics,
    weekOverWeekChange,
    watchlistMatches: [], // Empty for test (no user-specific watchlist)
    watchedCompaniesCount: 0,
    watchedBrandsCount: 0,
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
    console.log(`  Summary: ${metrics.summary}`);

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
    const metrics = await fetchProMetrics();
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
  pro-weekly-report  Pro weekly report email (paid subscribers)
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
