/**
 * Resend Email Sender for BevAlc Intelligence
 *
 * Usage from Python (via subprocess):
 *   node emails/send.js weekly-report --to user@example.com --weekEnding "January 5, 2026" --downloadLink "https://..."
 *
 * Usage from Node.js:
 *   import { sendWeeklyReport, sendWelcome } from './emails/send.js';
 *   await sendWeeklyReport({ to: 'user@example.com', weekEnding: '...' });
 */

import { Resend } from 'resend';
import { render } from '@react-email/components';
import { WeeklyReport } from './templates/WeeklyReport.jsx';
import { Welcome } from './templates/Welcome.jsx';

// Lazy initialize Resend (allows dotenv to load first)
let _resend = null;
function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// Default from address - update this with your verified domain
const getFromEmail = () => process.env.FROM_EMAIL || 'BevAlc Intelligence <hello@bevalcintel.com>';

/**
 * Send the weekly report email
 */
export async function sendWeeklyReport({
  to,
  weekEnding,
  summary,
  totalFilings,
  newBrands,
  newSkus,
  newCompanies,
  topFiler,
  topFilerCount,
  categoryData,
  topCompaniesList,
  topExtensionsList,
  proPreviewLabel,
  databaseUrl,
}) {
  const html = await render(
    WeeklyReport({
      weekEnding,
      summary,
      totalFilings,
      newBrands,
      newSkus,
      newCompanies,
      topFiler,
      topFilerCount,
      categoryData,
      topCompaniesList,
      topExtensionsList,
      proPreviewLabel,
      databaseUrl,
    })
  );

  const result = await getResend().emails.send({
    from: getFromEmail(),
    to,
    subject: `Your BevAlc Weekly Snapshot - ${weekEnding}`,
    html,
  });

  return result;
}

/**
 * Send the welcome email
 */
export async function sendWelcome({
  to,
  firstName = '',
}) {
  const html = await render(
    Welcome({
      firstName,
      email: to,
    })
  );

  const result = await getResend().emails.send({
    from: getFromEmail(),
    to,
    subject: firstName
      ? `Welcome to BevAlc Intelligence, ${firstName}!`
      : 'Welcome to BevAlc Intelligence!',
    html,
  });

  return result;
}

/**
 * Send a test email (for previewing any template)
 */
export async function sendTestEmail({
  to,
  template,
  props = {},
}) {
  let Component;
  let subject;

  switch (template) {
    case 'weekly-report':
      Component = WeeklyReport;
      subject = `[TEST] Weekly Report - ${props.weekEnding || 'Preview'}`;
      break;
    case 'welcome':
      Component = Welcome;
      subject = '[TEST] Welcome Email';
      break;
    default:
      throw new Error(`Unknown template: ${template}`);
  }

  const html = await render(Component(props));

  const result = await getResend().emails.send({
    from: getFromEmail(),
    to,
    subject,
    html,
  });

  return result;
}

/**
 * CLI Interface
 * Usage: node send.js <template> --to <email> [--prop value...]
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
BevAlc Email Sender

Usage:
  node send.js <template> --to <email> [options]

Templates:
  weekly-report    Weekly PDF report email
  welcome          New subscriber welcome email

Options:
  --to             Recipient email (required)
  --test           Send as test email with [TEST] prefix

Weekly Report Options:
  --weekEnding     Date string (e.g., "January 5, 2026")
  --downloadLink   URL to the PDF report
  --newFilingsCount Number of new filings
  --newBrandsCount  Number of new brands

Welcome Options:
  --firstName      Recipient's first name

Examples:
  node send.js weekly-report --to user@example.com --weekEnding "January 5, 2026" --downloadLink "https://..."
  node send.js welcome --to user@example.com --firstName "John"
  node send.js weekly-report --to test@example.com --test
`);
    process.exit(0);
  }

  const template = args[0];
  const options = {};
  let isTest = false;

  // Parse arguments
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--test') {
      isTest = true;
    } else if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      options[key] = value;
      i++;
    }
  }

  if (!options.to) {
    console.error('Error: --to is required');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    console.error('Set it in your .env file or export it before running');
    process.exit(1);
  }

  try {
    let result;

    if (isTest) {
      result = await sendTestEmail({
        to: options.to,
        template,
        props: options,
      });
    } else {
      switch (template) {
        case 'weekly-report':
          result = await sendWeeklyReport({
            to: options.to,
            weekEnding: options.weekEnding || new Date().toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric'
            }),
            downloadLink: options.downloadLink || 'https://bevalcintel.com',
            newFilingsCount: options.newFilingsCount,
            newBrandsCount: options.newBrandsCount,
          });
          break;
        case 'welcome':
          result = await sendWelcome({
            to: options.to,
            firstName: options.firstName || '',
          });
          break;
        default:
          console.error(`Unknown template: ${template}`);
          process.exit(1);
      }
    }

    if (result.error) {
      console.error('Failed to send email:', result.error);
      process.exit(1);
    }

    console.log('Email sent successfully!');
    console.log('Message ID:', result.data?.id);
  } catch (error) {
    console.error('Error sending email:', error.message);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (process.argv[1].endsWith('send.js')) {
  main();
}
