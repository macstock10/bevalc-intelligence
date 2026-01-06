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
    downloadLink: 'https://pub-1c889ae594b041a3b752c6c891eb718e.r2.dev/weekly/2026-01-05/bevalc_weekly_snapshot.pdf',
    newFilingsCount: '847',
    newBrandsCount: '23',
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
  console.log('  1. Weekly Report');
  console.log('  2. Welcome Email');
  console.log('  3. All templates');

  const choice = await promptUser('\nEnter choice (1-3): ');

  let success = true;

  switch (choice) {
    case '1':
      success = await sendTestWeeklyReport(email);
      break;
    case '2':
      success = await sendTestWelcome(email);
      break;
    case '3':
      const r1 = await sendTestWeeklyReport(email);
      const r2 = await sendTestWelcome(email);
      success = r1 && r2;
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
  weekly-report    Weekly PDF report email
  welcome          New subscriber welcome email

Examples:
  node test-email.js --email you@example.com --template weekly-report
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
    const r2 = await sendTestWelcome(email);
    success = r1 && r2;
  } else if (template === 'weekly-report') {
    success = await sendTestWeeklyReport(email);
  } else if (template === 'welcome') {
    success = await sendTestWelcome(email);
  } else {
    console.error('Unknown template:', template);
    console.error('Use: weekly-report, welcome, or --all');
    process.exit(1);
  }

  console.log('\n' + (success ? 'Done!' : 'Some emails failed to send.'));
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
