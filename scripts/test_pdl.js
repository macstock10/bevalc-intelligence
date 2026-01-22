// Test People Data Labs API with beverage companies
// Run: node test_pdl.js

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
    console.error('Error: Set PEOPLE_DATA_LABS_API_KEY environment variable');
    process.exit(1);
}

// Test companies from YOUR database (real use case)
const TEST_COMPANIES = [
    // Top COLA filers (companies with many filings - should have contacts)
    { name: 'MHW, LTD.', type: 'cola_filer', filings: 28251 },
    { name: 'LATITUDE WINES, LLC', type: 'cola_filer', filings: 21334 },
    { name: 'T. ELENTENY HOLDINGS, LLC', type: 'cola_filer', filings: 19517 },
    { name: 'FRUIT OF THE VINES, INC.', type: 'cola_filer', filings: 18344 },
    { name: 'BARSAC, INC.', type: 'cola_filer', filings: 13959 },

    // Permit holders WITHOUT COLAs (leads - may have limited contact data)
    { name: 'Ursa Major Distilling', type: 'permit_lead', filings: 0 },
    { name: 'Port Chilkoot Distillery', type: 'permit_lead', filings: 0 },
    { name: 'Fairbanks Distilling Company', type: 'permit_lead', filings: 0 },
    { name: 'Arctic Harvest', type: 'permit_lead', filings: 0 }
];

// Search for contacts at a company
function searchContacts(companyName) {
    return new Promise((resolve, reject) => {
        // Build Elasticsearch-style query for PDL Search API
        const searchQuery = {
            query: {
                bool: {
                    must: [
                        {
                            term: {
                                "job_company_name": companyName
                            }
                        }
                    ]
                }
            },
            size: 5,
            // Get people with decision-making titles
            "required": ["job_title", "job_company_name"]
        };

        const body = JSON.stringify(searchQuery);

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

            res.on('data', (chunk) => {
                data += chunk;
            });

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
    return {
        name: person.full_name,
        title: person.job_title,
        company: person.job_company_name,
        email: person.work_email || person.emails?.[0]?.address || 'No email',
        phone: person.phone_numbers?.[0] || 'No phone',
        linkedin: person.linkedin_url || 'No LinkedIn',
        seniority: person.job_title_levels?.join(', ') || 'Unknown'
    };
}

// Main test function
async function runTest() {
    console.log('='.repeat(80));
    console.log('PEOPLE DATA LABS API TEST - Beverage Industry');
    console.log('='.repeat(80));
    console.log('');

    const results = {
        tested: 0,
        successful: 0,
        failed: 0,
        totalContacts: 0,
        contactsByType: { cola_filer: 0, permit_lead: 0 }
    };

    for (const company of TEST_COMPANIES) {
        results.tested++;
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`Testing: ${company.name}`);
        console.log(`Type: ${company.type} | COLA Filings: ${company.filings}`);
        console.log(`${'─'.repeat(80)}`);

        try {
            const response = await searchContacts(company.name);
            const contacts = response.data || [];

            console.log(`✓ Found ${contacts.length} contacts`);

            if (contacts.length > 0) {
                results.successful++;
                results.totalContacts += contacts.length;
                results.contactsByType[company.type] += contacts.length;

                console.log('\nTop contacts:');
                contacts.slice(0, 3).forEach((person, i) => {
                    const contact = formatContact(person);
                    console.log(`  ${i + 1}. ${contact.name}`);
                    console.log(`     Title: ${contact.title}`);
                    console.log(`     Email: ${contact.email}`);
                    console.log(`     Phone: ${contact.phone}`);
                    console.log(`     Seniority: ${contact.seniority}`);
                });
            } else {
                console.log('✗ No contacts found');
                results.failed++;
            }

            // Rate limit: 3 seconds between requests (free tier is strict)
            await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
            // 404 = no contacts found (not an error, just no data)
            if (error.message.includes('404')) {
                console.log('✗ No contacts found in PDL database');
                results.failed++;
            } else {
                console.log(`✗ Error: ${error.message}`);
                results.failed++;
            }
        }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Companies tested: ${results.tested}`);
    console.log(`Successful lookups: ${results.successful} (${Math.round(results.successful / results.tested * 100)}%)`);
    console.log(`Failed lookups: ${results.failed}`);
    console.log(`Total contacts found: ${results.totalContacts}`);
    console.log(`Average contacts per company: ${(results.totalContacts / results.successful).toFixed(1)}`);
    console.log('');
    console.log('Contacts by company type:');
    console.log(`  COLA filers (existing customers): ${results.contactsByType.cola_filer}`);
    console.log(`  Permit leads (no COLAs yet): ${results.contactsByType.permit_lead}`);
    console.log('');
    console.log(`API credits used: ~${results.tested} of 100 free monthly lookups`);
    console.log('='.repeat(80));
}

// Run the test
runTest().catch(console.error);
