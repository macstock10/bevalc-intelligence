/**
 * Minimal Cloudflare D1 API helper for sec-rag ingestion.
 */

type D1Result = {
  success: boolean;
  result?: Array<{ results?: Array<Record<string, unknown>> }>;
  errors?: Array<unknown>;
};

const D1_BATCH_SIZE = 100;

function getD1Config() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN required');
  }

  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return { apiUrl, apiToken };
}

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const s = String(value)
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/'/g, "''");
  return `'${s}'`;
}

async function d1Execute(sql: string): Promise<D1Result> {
  const { apiUrl, apiToken } = getD1Config();
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`D1 API error: ${response.status} ${text}`);
  }

  return response.json() as Promise<D1Result>;
}

export async function upsertRagChunksContent(rows: Array<Record<string, unknown>>): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += D1_BATCH_SIZE) {
    const batch = rows.slice(i, i + D1_BATCH_SIZE);
    const values = batch.map(r => `(
      ${escapeSqlValue(r.id)},
      ${escapeSqlValue(r.ticker)},
      ${escapeSqlValue(r.doc_type)},
      ${escapeSqlValue(r.filing_date)},
      ${escapeSqlValue(r.section)},
      ${escapeSqlValue(r.source_url)},
      ${escapeSqlValue(r.accession_number)},
      ${escapeSqlValue(r.fiscal_year)},
      ${escapeSqlValue(r.fiscal_quarter)},
      ${escapeSqlValue(r.content)}
    )`);

    const sql = `
      INSERT OR REPLACE INTO sec_rag_chunks_content
      (id, ticker, doc_type, filing_date, section, source_url, accession_number, fiscal_year, fiscal_quarter, content)
      VALUES ${values.join(',')}
    `;

    await d1Execute(sql);
  }
}
