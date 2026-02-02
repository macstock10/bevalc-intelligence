import OpenAI from 'openai';
import 'dotenv/config';

const client = new OpenAI();
const vs = await client.vectorStores.create({ name: 'bevalc-sec-filings' });
console.log('Vector Store ID:', vs.id);
