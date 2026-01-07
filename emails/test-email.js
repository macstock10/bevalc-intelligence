/**
 * Test Email Script for BevAlc Intelligence
 *
 * This script sends test emails to verify your Resend setup is working.
 *
 * Usage:
 *   node test-email.js                     # Interactive mode
 *   node test-email.js --email you@example.com --template weekly-report
 *   node test-email.js --email you@example.com --template welcome
 *   node test-email.js --email you@example.com --all   # Send all templates
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

// Load .env from repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

import { sendWeeklyReport, sendWelcome, sendTestEmail } from './send.js';

// Sample data for test emails
const testData = {
  weeklyReport: {
    weekEnding: 'January 5, 2026',
    summary: 'Tequila filings up 23% as brands prep for spring launches',
    totalFilings: '847',
    newBrands: '23',
    newSkus: '156',
    newCompanies: '8',
    topFiler: 'Diageo',
    topFilerCount: '34',
    categoryData: [
      { label: 'Whiskey', value: 187 },
      { label: 'Tequila', value: 156 },
      { label: 'Vodka', value: 134 },
      { label: 'Wine', value: 98 },
      { label: 'Beer', value: 76 },
      { label: 'RTD', value: 64 },
    ],
    topCompaniesList: [
      { company: 'Diageo', category: 'Whiskey', filings: 34 },
      { company: 'Constellation Brands', category: 'Beer', filings: 28 },
      { company: 'Pernod Ricard', category: 'Whiskey', filings: 22 },
      { company: 'E&J Gallo', category: 'Wine', filings: 19 },
      { company: 'Brown-Forman', category: 'Whiskey', filings: 16 },
    ],
    topExtensionsList: [
      { brand: 'Crown Royal', company: 'Diageo', category: 'Whiskey', newSkus: 14 },
      { brand: 'High Noon', company: 'E&J Gallo', category: 'RTD', newSkus: 9 },
      { brand: 'Modelo Especial', company: 'Constellation', category: 'Beer', newSkus: 8 },
      { brand: "Tito's Handmade", company: 'Fifth Generation', category: 'Vodka', newSkus: 6 },
      { brand: "Hendrick's", company: 'William Grant', category: 'Gin', newSkus: 5 },
    ],
    databaseUrl: 'https://bevalcintel.com/database',
    proPreviewLabel: {
      brand: 'Clase Azul Reposado',
      company: 'Clase Azul',
      signal: 'NEW_BRAND',
      ttbId: '24087001000453',
      ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000453',
    },
  },
  proWeeklyReport: {
    firstName: 'John',
    watchedCompaniesCount: 5,
    watchedBrandsCount: 12,
    weekEnding: 'January 5, 2026',
    summary: 'Tequila filings up 23% as brands prep for spring launches',
    totalFilings: '2,847',
    newBrands: '127',
    newSkus: '843',
    newCompanies: '34',
    topFiler: 'Diageo',
    topFilerCount: '89',
    weekOverWeekChange: '+12%',
    watchlistMatches: [
      {
        brand: 'Crown Royal',
        fancifulName: 'Crown Royal Peach',
        company: 'Diageo Americas Supply Inc',
        signal: 'NEW_SKU',
        category: 'Whiskey',
        ttbId: '24087001000453',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000453',
        matchType: 'company',
      },
      {
        brand: 'Johnnie Walker',
        fancifulName: 'Johnnie Walker Blue Label Ghost',
        company: 'Diageo Americas Supply Inc',
        signal: 'NEW_SKU',
        category: 'Whiskey',
        ttbId: '24087001000454',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000454',
        matchType: 'company',
      },
      {
        brand: 'Casamigos',
        fancifulName: 'Casamigos Cristalino',
        company: 'Casamigos Spirits Company',
        signal: 'NEW_BRAND',
        category: 'Tequila',
        ttbId: '24087001000455',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000455',
        matchType: 'brand',
      },
    ],
    categoryData: [
      { label: 'Whiskey', value: 487, change: '+15%' },
      { label: 'Tequila', value: 356, change: '+23%' },
      { label: 'Vodka', value: 234, change: '-5%' },
      { label: 'Wine', value: 198, change: '+8%' },
      { label: 'Beer', value: 176, change: '+2%' },
      { label: 'RTD', value: 164, change: '+31%' },
    ],
    topCompaniesList: [
      { company: 'Diageo Americas Supply Inc', filings: 89, change: '+34' },
      { company: 'Constellation Brands', filings: 67, change: '+12' },
      { company: 'Pernod Ricard USA', filings: 54, change: '+8' },
      { company: 'E. & J. Gallo Winery', filings: 48, change: '-3' },
      { company: 'Brown-Forman Corporation', filings: 42, change: '+15' },
    ],
    notableNewBrands: [
      {
        brand: 'Casa Dragones',
        company: 'Casa Dragones LLC',
        category: 'Tequila',
        ttbId: '24087001000456',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000456',
      },
      {
        brand: 'Kentucky Owl',
        company: 'Kentucky Owl LLC',
        category: 'Whiskey',
        ttbId: '24087001000457',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000457',
      },
      {
        brand: 'Cutwater Spirits',
        company: 'Cutwater Spirits LLC',
        category: 'RTD',
        ttbId: '24087001000458',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000458',
      },
    ],
    filingSpikes: [
      {
        company: 'Sazerac Company',
        thisWeek: 45,
        avgWeek: 12,
        percentIncrease: 275,
      },
      {
        company: 'Heaven Hill Brands',
        thisWeek: 38,
        avgWeek: 15,
        percentIncrease: 153,
      },
    ],
    newFilingsList: [
      {
        brand: 'Clase Azul',
        fancifulName: 'Clase Azul Ultra',
        company: 'Clase Azul Mexico',
        signal: 'NEW_BRAND',
        category: 'Tequila',
        ttbId: '24087001000459',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000459',
      },
      {
        brand: 'High Noon',
        fancifulName: 'High Noon Pineapple',
        company: 'E. & J. Gallo Winery',
        signal: 'NEW_SKU',
        category: 'RTD',
        ttbId: '24087001000460',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000460',
      },
      {
        brand: 'Buffalo Trace',
        fancifulName: 'Buffalo Trace Single Barrel Select',
        company: 'Sazerac Company',
        signal: 'NEW_SKU',
        category: 'Whiskey',
        ttbId: '24087001000461',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000461',
      },
      {
        brand: 'Aperol',
        fancifulName: 'Aperol Spritz RTD',
        company: 'Campari America',
        signal: 'NEW_SKU',
        category: 'RTD',
        ttbId: '24087001000462',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000462',
      },
      {
        brand: 'Teremana',
        fancifulName: 'Teremana Cristalino',
        company: 'Teremana LLC',
        signal: 'NEW_SKU',
        category: 'Tequila',
        ttbId: '24087001000463',
        ttbLink: 'https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=24087001000463',
      },
    ],
    databaseUrl: 'https://bevalcintel.com/database',
    accountUrl: 'https://bevalcintel.com/account.html',
    preferencesUrl: 'https://bevalcintel.com/preferences.html',
  },
  welcome: {
    firstName: 'Test',
  },
};

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function sendTestWeeklyReport(email) {
  console.log('\nSending test weekly report...');
  try {
    const result = await sendTestEmail({
      to: email,
      template: 'weekly-report',
      props: testData.weeklyReport,
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
  console.log('\nSending test Pro weekly report...');
  try {
    const result = await sendTestEmail({
      to: email,
      template: 'pro-weekly-report',
      props: testData.proWeeklyReport,
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
  console.log('\nSending test welcome email...');
  try {
    const result = await sendTestEmail({
      to: email,
      template: 'welcome',
      props: testData.welcome,
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

async function interactiveMode() {
  console.log('\n=== BevAlc Email Test Tool ===\n');

  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY not found in environment.');
    console.error('Add it to your .env file:');
    console.error('  RESEND_API_KEY=re_xxxxxxxx\n');
    process.exit(1);
  }

  const email = await promptUser('Enter your email address: ');
  if (!email || !email.includes('@')) {
    console.error('Invalid email address');
    process.exit(1);
  }

  console.log('\nWhich template do you want to test?');
  console.log('  1. Weekly Report (Free)');
  console.log('  2. Pro Weekly Report');
  console.log('  3. Welcome Email');
  console.log('  4. All templates');

  const choice = await promptUser('\nEnter choice (1-4): ');

  let success = true;

  switch (choice) {
    case '1':
      success = await sendTestWeeklyReport(email);
      break;
    case '2':
      success = await sendTestProWeeklyReport(email);
      break;
    case '3':
      success = await sendTestWelcome(email);
      break;
    case '4':
      const r1 = await sendTestWeeklyReport(email);
      const r2 = await sendTestProWeeklyReport(email);
      const r3 = await sendTestWelcome(email);
      success = r1 && r2 && r3;
      break;
    default:
      console.error('Invalid choice');
      process.exit(1);
  }

  console.log('\n' + (success ? 'All tests passed!' : 'Some tests failed.'));
  console.log('Check your inbox at:', email);
}

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

Usage:
  node test-email.js                                    # Interactive mode
  node test-email.js --email <addr> --template <name>   # Send specific template
  node test-email.js --email <addr> --all               # Send all templates

Templates:
  weekly-report      Weekly report email (free users)
  pro-weekly-report  Pro weekly report email (paid subscribers)
  welcome            New subscriber welcome email

Examples:
  node test-email.js --email you@example.com --template weekly-report
  node test-email.js --email you@example.com --template pro-weekly-report
  node test-email.js --email you@example.com --all
`);
      process.exit(0);
    }
  }

  // Check for API key
  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY not found.');
    console.error('Add to .env file or export before running.\n');
    process.exit(1);
  }

  // If no arguments, run interactive mode
  if (!email) {
    return interactiveMode();
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
    console.error('Unknown template:', template);
    console.error('Use: weekly-report, pro-weekly-report, welcome, or --all');
    process.exit(1);
  }

  console.log('\n' + (success ? 'Done!' : 'Some emails failed to send.'));
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
