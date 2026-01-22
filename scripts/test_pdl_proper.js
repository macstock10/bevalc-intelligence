// Test People Data Labs API with real BevAlc companies
// Run: node test_pdl_proper.js
//
// This test uses:
// 1. Company Cleaner API to normalize company names
// 2. Person Search API to find contacts at each company

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const API_KEY = process.env.PEOPLE_DATA_LABS_API_KEY;

if (!API_KEY) {
    console.error('Error: Set PEOPLE_DATA_LABS_API_KEY in .env file');
    process.exit(1);
}

// Test companies from YOUR database
const TEST_COMPANIES = [
    // Top COLA filers (should have contacts)
    { name: 'MHW, LTD.', type: 'cola_filer', filings: 28251 },
    { name: 'LATITUDE WINES, LLC', type: 'cola_filer', filings: 21334 },
    { name: 'FRUIT OF THE VINES, INC.', type: 'cola_filer', filings: 18344 },

    // Permit holders WITHOUT COLAs (leads)
    { name: 'Ursa Major Distilling', type: 'permit_lead', filings: 0 },
    { name: 'Port Chilkoot Distillery', type: 'permit_lead', filings: 0 },
    { name: 'Fairbanks Distilling Company', type: 'permit_lead', filings: 0 }
];

// Step 1: Clean/normalize company name
function cleanCompanyName(companyName) {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({ name: companyName });

        const options = {
            hostname: 'api.peopledatalabs.com',
            path: `/v5/company/clean?${params.toString()}`,
            method: 'GET',
            headers: {
                'X-Api-Key': API_KEY
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    // If cleaner fails, return original name
                    resolve({ name: companyName });
                }
            });
        });

        req.on('error', (error) => {
            // If cleaner fails, return original name
            resolve({ name: companyName });
        });

        req.end();
    });
}

// Step 2: Search for contacts at the company
function searchContacts(companyName, limit = 5) {
    return new Promise((resolve, reject) => {
        // SQL query - simpler and more readable than Elasticsearch
        const sqlQuery = `
            SELECT * FROM person
            WHERE job_company_name='${companyName.replace(/'/g, "''")}'
            AND (
                job_title_levels LIKE '%director%'
                OR job_title_levels LIKE '%vp%'
                OR job_title_levels LIKE '%c_suite%'
                OR job_title_levels LIKE '%owner%'
            )
            AND (
                work_email IS NOT NULL
                OR mobile_phone IS NOT NULL
            )
        `.trim();

        const body = JSON.stringify({
            sql: sqlQuery,
            size: limit,  // Limit results to control costs
            dataset: 'all',  // Use full dataset
            pretty: true
        });

        const options = {
            hostname: 'api.peopledatalabs.com',
            path: '/v5/person/search',
            method: 'POST',
            headers: {
                'X-Api-Key': API_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(body);
        req.end();
    });
}

// Format contact for display
function formatContact(person) {
    const emails = person.emails || [];
    const phones = person.phone_numbers || [];

    return {
        name: person.full_name || 'Unknown',
        title: person.job_title || 'Unknown',
        company: person.job_company_name || 'Unknown',
        email: person.work_email || emails[0]?.address || 'No email',
        phone: person.mobile_phone || phones[0] || 'No phone',
        linkedin: person.linkedin_url || 'No LinkedIn',
        seniority: (person.job_title_levels || []).join(', ') || 'Unknown',
        location: person.location_name || 'Unknown'
    };
}

// Main test function
async function runTest() {
    console.log('='.repeat(80));
    console.log('PEOPLE DATA LABS API TEST - BevAlc Intelligence');
    console.log('Testing: Company Cleaner + Person Search');
    console.log('='.repeat(80));
    console.log('');

    const results = {
        tested: 0,
        cleanerSuccess: 0,
        searchSuccess: 0,
        searchFailed: 0,
        totalContacts: 0,
        contactsByType: { cola_filer: 0, permit_lead: 0 },
        creditsUsed: 0
    };

    for (const company of TEST_COMPANIES) {
        results.tested++;
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`[${results.tested}/${TEST_COMPANIES.length}] ${company.name}`);
        console.log(`Type: ${company.type} | COLA Filings: ${company.filings}`);
        console.log(`${'─'.repeat(80)}`);

        try {
            // Step 1: Clean company name
            console.log(`\n  [1/2] Cleaning company name...`);
            const cleanResult = await cleanCompanyName(company.name);
            const cleanedName = cleanResult.name || company.name;

            if (cleanResult.name && cleanResult.name !== company.name) {
                console.log(`  ✓ Cleaned: "${company.name}" → "${cleanedName}"`);
                results.cleanerSuccess++;
            } else {
                console.log(`  → Using original: "${cleanedName}"`);
            }

            // Wait 2 seconds (Company Cleaner rate limit: 10/min)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 2: Search for contacts
            console.log(`\n  [2/2] Searching for contacts...`);
            const response = await searchContacts(cleanedName, 5);
            const contacts = response.data || [];
            const total = response.total || 0;

            results.creditsUsed += contacts.length;

            if (contacts.length > 0) {
                console.log(`  ✓ Found ${contacts.length} contacts (${total} total match criteria)`);
                results.searchSuccess++;
                results.totalContacts += contacts.length;
                results.contactsByType[company.type] += contacts.length;

                console.log('\n  Top contacts:');
                contacts.forEach((person, i) => {
                    const contact = formatContact(person);
                    console.log(`\n    ${i + 1}. ${contact.name}`);
                    console.log(`       Title: ${contact.title}`);
                    console.log(`       Email: ${contact.email}`);
                    console.log(`       Phone: ${contact.phone}`);
                    console.log(`       LinkedIn: ${contact.linkedin ? 'Yes' : 'No'}`);
                    console.log(`       Location: ${contact.location}`);
                });
            } else if (total === 0) {
                console.log(`  ✗ No contacts found in PDL database`);
                results.searchFailed++;
            } else {
                console.log(`  ✗ Found ${total} matches but none had required contact info`);
                results.searchFailed++;
            }

            // Wait 5 seconds between searches (rate limit protection)
            if (results.tested < TEST_COMPANIES.length) {
                console.log(`\n  Waiting 5 seconds (rate limit)...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

        } catch (error) {
            console.log(`  ✗ Error: ${error.message}`);
            results.searchFailed++;

            // If rate limited, wait longer
            if (error.message.includes('429')) {
                console.log(`  Waiting 10 seconds before continuing...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`\nCompanies tested: ${results.tested}`);
    console.log(`Successful searches: ${results.searchSuccess} (${Math.round(results.searchSuccess / results.tested * 100)}%)`);
    console.log(`Failed searches: ${results.searchFailed}`);
    console.log(`Total contacts found: ${results.totalContacts}`);
    console.log(`Average contacts per success: ${results.searchSuccess > 0 ? (results.totalContacts / results.searchSuccess).toFixed(1) : 0}`);
    console.log('');
    console.log('Contacts by company type:');
    console.log(`  COLA filers: ${results.contactsByType.cola_filer} contacts`);
    console.log(`  Permit leads: ${results.contactsByType.permit_lead} contacts`);
    console.log('');
    console.log(`API credits used: ~${results.creditsUsed} search credits`);
    console.log(`Company cleanups: ${results.cleanerSuccess} (free)`);
    console.log('');
    console.log('='.repeat(80));

    // Recommendations
    console.log('\nRECOMMENDATIONS FOR PRODUCTION:');
    console.log('');
    console.log('1. Coverage: ' + (results.searchSuccess / results.tested >= 0.5 ?
        '✓ Good coverage (50%+ success rate)' :
        '✗ Low coverage - may need better company matching'));
    console.log('2. Data quality: Review contact titles - are they decision-makers?');
    console.log('3. Cost estimate: ~' + (results.creditsUsed / results.searchSuccess).toFixed(1) + ' credits per company enhancement');
    console.log('4. Cache strategy: Store contacts in D1 with 90-day TTL (like enhancements)');
    console.log('');
    console.log('='.repeat(80));
}

// Run the test
runTest().catch(console.error);
