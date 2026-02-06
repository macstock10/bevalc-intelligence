/**
 * Seed glossary_terms table in D1 with all term definitions.
 *
 * Usage:
 *   node scripts/glossary/seed.js
 *
 * Requires env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
 */

const TERMS = require('./terms-data.js');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !DATABASE_ID || !API_TOKEN) {
    console.error('Missing env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN');
    process.exit(1);
}

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function seed() {
    console.log(`Seeding ${TERMS.length} glossary terms...`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < TERMS.length; i++) {
        const t = TERMS[i];
        const statement = {
            sql: `INSERT OR REPLACE INTO glossary_terms
                  (term_slug, term_name, category, definition, plain_english, technical_detail, why_it_matters, related_terms, faqs, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            params: [
                t.slug, t.name, t.category,
                t.definition, t.plain_english, t.technical_detail, t.why_it_matters,
                JSON.stringify(t.related_terms),
                JSON.stringify(t.faqs)
            ]
        };

        try {
            const res = await fetch(D1_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(statement)
            });

            const data = await res.json();
            if (data.success === false || data.errors?.length > 0) {
                console.error(`  FAIL [${i+1}] ${t.slug}:`, JSON.stringify(data.errors));
                failed++;
            } else {
                success++;
                if ((i + 1) % 10 === 0 || i === TERMS.length - 1) {
                    console.log(`  [${i+1}/${TERMS.length}] ...${t.slug}`);
                }
            }
        } catch (err) {
            console.error(`  ERROR [${i+1}] ${t.slug}:`, err.message);
            failed++;
        }

        // Small delay to avoid rate limits
        if (i < TERMS.length - 1) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    console.log(`\nDone: ${success} inserted, ${failed} failed out of ${TERMS.length} total.`);
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
