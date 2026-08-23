#!/usr/bin/env node
// scripts/extract-port-fees.mjs
// Extract port fee amounts from FEE_PORT filings for NYSE, Cboe BZX, and Nasdaq
// Uses FR body HTML + Claude Haiku for structured extraction
// Idempotent: skips already-extracted filings
//
// Usage: node scripts/extract-port-fees.mjs

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const UA = 'MarketDataNews-Research/1.0 contact@marketdatanews.com';
const db = new Database(join(ROOT, 'data/19b4-filings.db'));
const claude = new Anthropic();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Create extraction table ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS port_fee_extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sr_number TEXT NOT NULL,
    venue TEXT,
    exchange_family TEXT,
    filing_date TEXT,
    port_1gb_before REAL,
    port_1gb_after  REAL,
    port_10gb_before REAL,
    port_10gb_after  REAL,
    port_100gb_before REAL,
    port_100gb_after  REAL,
    is_new_tier INTEGER DEFAULT 0,
    product_tier TEXT,
    notes TEXT,
    extraction_method TEXT DEFAULT 'claude',
    extracted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sr_number)
  )
`);
// Migrate: add product_tier to tables created before this column existed
try { db.exec(`ALTER TABLE port_fee_extractions ADD COLUMN product_tier TEXT`); } catch (_) {}

// ─── Fetch FR body HTML ───────────────────────────────────────────────────────
async function fetchBodyText(frDocNumber) {
  const apiUrl = `https://www.federalregister.gov/api/v1/documents/${frDocNumber}.json?fields[]=body_html_url`;
  const metaRes = await fetch(apiUrl, { headers: { 'User-Agent': UA } });
  if (!metaRes.ok) throw new Error(`FR API ${metaRes.status} for ${frDocNumber}`);
  const meta = await metaRes.json();
  if (!meta.body_html_url) throw new Error(`No body_html_url for ${frDocNumber}`);

  await sleep(200);
  const bodyRes = await fetch(meta.body_html_url, { headers: { 'User-Agent': UA } });
  if (!bodyRes.ok) throw new Error(`Body HTML ${bodyRes.status}`);
  const html = await bodyRes.text();

  // Strip HTML tags and decode common entities
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&thinsp;|&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Extract relevant snippet around port fee content ────────────────────────
function extractRelevantSnippet(text, maxChars = 8000) {
  const anchors = [
    /physical port/i,
    /port fee/i,
    /connectivity fee/i,
    /\$[\d,]+ per (?:physical )?port/i,
    /1 gigabit|10 gigabit|100 gigabit|1[\s]?Gb|10[\s]?Gb|100[\s]?Gb/i,
  ];

  // Primary anchor: earliest keyword match
  let bestIdx = -1;
  for (const pat of anchors) {
    const m = text.search(pat);
    if (m >= 0 && (bestIdx < 0 || m < bestIdx)) bestIdx = m;
  }

  // For long documents (> 10 000 chars): also try a dollar-amount-near-Gb anchor.
  // The intro section often mentions "port fee" abstractly at ~1 100 chars, while
  // the actual fee schedule table with dollar figures sits much later.
  // Find the earliest "$X,XXX" that also has a Gb/port keyword within ±300 chars.
  if (text.length > 10000) {
    const dollarRe = /\$[\d,]+/g;
    let m;
    while ((m = dollarRe.exec(text)) !== null) {
      const ctx = text.slice(Math.max(0, m.index - 300), m.index + 300);
      if (/\bGb\b|gigabit|per port|per month/i.test(ctx)) {
        if (bestIdx < 0 || m.index < bestIdx) bestIdx = m.index;
        break; // use earliest qualifying dollar amount
      }
    }
  }

  if (bestIdx < 0) return text.slice(0, maxChars);
  const start = Math.max(0, bestIdx - 300);
  return text.slice(start, start + maxChars);
}

// ─── Claude Haiku extraction ──────────────────────────────────────────────────
async function extractWithClaude(srNumber, venue, filingDate, snippet) {
  const prompt = `You are extracting port connectivity fee data from a US stock exchange SEC rule filing.

Filing: ${srNumber} (${venue}, ${filingDate})

Text excerpt:
<text>
${snippet}
</text>

Extract physical port fees (monthly recurring fees for 1 Gb, 10 Gb, and 100 Gb ports).
Return ONLY valid JSON matching this schema (null if not mentioned):
{
  "port_1gb_before": <number or null>,
  "port_1gb_after": <number or null>,
  "port_10gb_before": <number or null>,
  "port_10gb_after": <number or null>,
  "port_100gb_before": <number or null>,
  "port_100gb_after": <number or null>,
  "is_new_tier": <true if this filing establishes a NEW port tier (not just a price change), false otherwise>,
  "product_tier": <"Ultra" if fees explicitly labeled as Ultra/Ultra fiber/10 GB Ultra/1 GB Ultra, "Standard" if labeled as standard, null if not specified>,
  "notes": "<one sentence summary of what changed, or null>"
}

Rules:
- Only include fees explicitly stated as "per port per month" or "per physical port" monthly recurring fees
- Do NOT include one-time/installation charges
- Do NOT include wireless connectivity, cross-connects, or cabinet fees
- Do NOT include logical port fees (SQF, Purge Port, order entry logical ports)
- "before" = fee BEFORE this filing's change; "after" = fee AFTER
- If only one fee is mentioned with no before/after distinction, put it in "after" (it's the new fee)
- If a fee is being eliminated/deleted, set "after" to null and put the old fee in "before"
- If no port fee data found, return all nulls
- Return ONLY the JSON object, no other text`;

  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON from response
    const m = raw.match(/\{[\s\S]+\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Claude returned non-JSON: ${raw.slice(0, 100)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const TARGET_PATTERNS = [
  "sr_number LIKE 'SR-NYSE-%'",
  "sr_number LIKE 'SR-CboeBZX-%'",
  "sr_number LIKE 'SR-BatsBZX-%'",
  "sr_number LIKE 'SR-NASDAQ-%'",
];

const filings = db.prepare(`
  SELECT f.sr_number, f.fr_doc_number, f.filing_date, f.exchange_family,
    CASE
      WHEN f.sr_number LIKE 'SR-NYSE-%' THEN 'NYSE'
      WHEN f.sr_number LIKE 'SR-CboeBZX-%' OR f.sr_number LIKE 'SR-BatsBZX-%' THEN 'Cboe BZX'
      WHEN f.sr_number LIKE 'SR-NASDAQ-%' THEN 'Nasdaq'
      ELSE f.exchange_family
    END as venue
  FROM filings f
  WHERE f.category = 'FEE_PORT'
  AND (${TARGET_PATTERNS.join(' OR ')})
  AND NOT EXISTS (SELECT 1 FROM port_fee_extractions p WHERE p.sr_number = f.sr_number)
  ORDER BY f.filing_date
`).all();

console.log(`[extract] ${filings.length} filings to process`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO port_fee_extractions
    (sr_number, venue, exchange_family, filing_date,
     port_1gb_before, port_1gb_after, port_10gb_before, port_10gb_after,
     port_100gb_before, port_100gb_after, is_new_tier, product_tier, notes, extraction_method)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude')
`);

let processed = 0;
let errors = 0;
let noData = 0;

for (const filing of filings) {
  process.stdout.write(`[${++processed}/${filings.length}] ${filing.sr_number} (${filing.venue}, ${filing.filing_date})... `);
  try {
    const fullText = await fetchBodyText(filing.fr_doc_number);
    const snippet = extractRelevantSnippet(fullText);
    await sleep(150); // Claude rate limit buffer

    const extracted = await extractWithClaude(filing.sr_number, filing.venue, filing.filing_date, snippet);

    const hasData = Object.entries(extracted)
      .filter(([k]) => k !== 'is_new_tier' && k !== 'notes')
      .some(([, v]) => v !== null);

    if (!hasData) {
      noData++;
      process.stdout.write(`(no fee data)\n`);
    } else {
      const parts = [];
      if (extracted.port_10gb_before !== null) parts.push(`10Gb: $${extracted.port_10gb_before}→$${extracted.port_10gb_after}`);
      if (extracted.port_1gb_before !== null)  parts.push(`1Gb: $${extracted.port_1gb_before}→$${extracted.port_1gb_after}`);
      if (extracted.port_100gb_after !== null) parts.push(`100Gb: $${extracted.port_100gb_after}`);
      process.stdout.write(`${parts.join(', ')}\n`);
    }

    insertStmt.run(
      filing.sr_number, filing.venue, filing.exchange_family, filing.filing_date,
      extracted.port_1gb_before, extracted.port_1gb_after,
      extracted.port_10gb_before, extracted.port_10gb_after,
      extracted.port_100gb_before, extracted.port_100gb_after,
      extracted.is_new_tier ? 1 : 0, extracted.product_tier ?? null, extracted.notes
    );

    await sleep(200); // FR rate limit buffer

  } catch (err) {
    errors++;
    process.stdout.write(`ERROR: ${err.message}\n`);
    // Still insert a null row so we don't re-attempt
    insertStmt.run(
      filing.sr_number, filing.venue, filing.exchange_family, filing.filing_date,
      null, null, null, null, null, null, 0, null, `extraction_error: ${err.message}`
    );
    await sleep(500);
  }
}

console.log(`\n[extract] Done. Processed: ${processed}, No fee data: ${noData}, Errors: ${errors}`);

// ─── Print summary of extracted data ─────────────────────────────────────────
console.log('\n=== Extraction Results ===');
const results = db.prepare(`
  SELECT sr_number, venue, filing_date,
    port_1gb_before, port_1gb_after,
    port_10gb_before, port_10gb_after,
    port_100gb_before, port_100gb_after,
    is_new_tier, notes
  FROM port_fee_extractions
  WHERE (port_10gb_after IS NOT NULL OR port_1gb_after IS NOT NULL OR port_100gb_after IS NOT NULL)
  ORDER BY venue, filing_date
`).all();

console.log(`Filings with extractable fee data: ${results.length}`);
for (const r of results) {
  const parts = [];
  if (r.port_1gb_after)   parts.push(`1Gb: $${r.port_1gb_before || '?'}→$${r.port_1gb_after}`);
  if (r.port_10gb_after)  parts.push(`10Gb: $${r.port_10gb_before || '?'}→$${r.port_10gb_after}`);
  if (r.port_100gb_after) parts.push(`100Gb: ${r.port_100gb_before ? '$'+r.port_100gb_before+'→' : 'NEW '}$${r.port_100gb_after}`);
  console.log(`  ${r.sr_number} | ${r.venue} | ${r.filing_date}`);
  console.log(`    ${parts.join(' | ')}${r.is_new_tier ? ' [NEW TIER]' : ''}`);
  if (r.notes) console.log(`    Note: ${r.notes}`);
}

// ─── Export JSON for the research page ───────────────────────────────────────
const exportData = db.prepare(`
  SELECT * FROM port_fee_extractions
  WHERE (port_10gb_after IS NOT NULL OR port_1gb_after IS NOT NULL OR port_100gb_after IS NOT NULL)
  ORDER BY venue, filing_date
`).all();

writeFileSync(
  join(ROOT, 'data/port-fee-series.json'),
  JSON.stringify({ generated: new Date().toISOString(), count: exportData.length, series: exportData }, null, 2)
);
console.log(`\nExported ${exportData.length} data points to data/port-fee-series.json`);

db.close();
