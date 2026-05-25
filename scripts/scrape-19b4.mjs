#!/usr/bin/env node
// scripts/scrape-19b4.mjs
// Phase 1: Fetch all SRO 19b-4 filings from the Federal Register API (2017-present)
// Stores results in data/19b4-filings.db (SQLite) and exports data/sec-19b4-filings.json
// Idempotent: safe to re-run, only inserts new filings.
//
// Usage:
//   node scripts/scrape-19b4.mjs              # full scrape
//   node scripts/scrape-19b4.mjs --year 2024  # single year only
//   node scripts/scrape-19b4.mjs --since 2024-01-01  # incremental

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ─── Exchange family prefix map ───────────────────────────────────────────────
const SR_PREFIX_MAP = {
  'NYSE-':          'NYSE',
  'NYSEARCA-':      'NYSE',
  'NYSEArca-':      'NYSE',
  'NYSEAmer-':      'NYSE',
  'NYSEMKT-':       'NYSE',  // historical name for NYSE American
  'NYSECHX-':       'NYSE',
  'NYSENAT-':       'NYSE',
  'NYSEAMER-':      'NYSE',
  'NYSETEX-':       'NYSE',  // NYSE Texas
  'NYSETEX -':      'NYSE',  // with space variant
  'CHX-':           'NYSE',  // Chicago Stock Exchange (acquired by NYSE 2018)
  'NSX-':           'NYSE',  // NYSE National (formerly National Stock Exchange)
  'NASDAQ-':        'Nasdaq',
  'Nasdaq-':        'Nasdaq',
  'NASDAQBX-':      'Nasdaq',
  'NasdaqBX-':      'Nasdaq',
  'BX-':            'Nasdaq',  // Nasdaq BX (Boston)
  'Phlx-':          'Nasdaq',
  'PHLX-':          'Nasdaq',
  'ISE-':           'Nasdaq',
  'ISEMercury-':    'Nasdaq',
  'ISE Mercury-':   'Nasdaq',
  'ISEGemini-':     'Nasdaq',
  'ISE Gemini-':    'Nasdaq',
  'GEMX-':          'Nasdaq',
  'MRX-':           'Nasdaq',
  'NasdaqTX-':      'Nasdaq',  // Nasdaq Texas
  'NasdaqTX -':     'Nasdaq',  // with space variant
  'CboeBZX-':       'Cboe',
  'CboeBYX-':       'Cboe',
  'CboeEDGA-':      'Cboe',
  'CboeEDGX-':      'Cboe',
  'C2-':            'Cboe',
  'CBOE-':          'Cboe',
  'Cboe-':          'Cboe',
  'CFE-':           'Cboe',   // Cboe Futures Exchange
  'BATS-':          'Cboe',       // historical (pre-2017 Cboe name)
  'BatsBZX-':       'Cboe',
  'BatsBYX-':       'Cboe',
  'BatsEDGA-':      'Cboe',
  'BatsEDGX-':      'Cboe',
  'Bats EDGX-':     'Cboe',  // with space variant
  'IEX-':           'IEX',
  'MEMX-':          'MEMX',
  'MIAX-':          'MIAX',
  'PEARL-':         'MIAX',
  'EMERALD-':       'MIAX',
  'MIAXSAP-':       'MIAX',
  'MIAXSapphire-':  'MIAX',
  'LTSE-':          'LTSE',
  'BOX-':           'BOX',        // BOX Options Exchange (TMX Group)
  'SAPPHIRE-':      'MIAX',       // MIAX Sapphire
  'Sapphire-':      'MIAX',
  'NYSENat-':       'NYSE',       // NYSE National (alternate spelling)
  'TXSE-':          'Other',      // Texas Securities Exchange (new, out of scope)
  '24X-':           'Other',      // 24X National Exchange (new, out of scope)
  'OCC-':           'Other',      // OCC (options clearinghouse)
  'NSCC-':          'Other',      // NSCC (clearinghouse)
  'DTC-':           'Other',      // DTC (clearinghouse)
  'FICC-':          'Other',      // FICC (clearinghouse)
};

// ─── Category rules (first match wins) ───────────────────────────────────────
const CATEGORY_RULES = [
  {
    cat: 'FEE_CAT',
    patterns: [
      /\bCAT\b/,                           // "CAT" acronym (Consolidated Audit Trail)
      /consolidated audit trail/i,
      /\bCAT fee/i,
      /\bCAT cost/i,
      /historical cost.*national market/i,
      /national market system.*historical cost/i,
      /reasonably budgeted.*CAT/i,
      /CAT.*reasonably budgeted/i,
      /\bCAT NMS\b/i,
      /CAT funding/i,
    ],
  },
  {
    cat: 'FEE_PORT',
    patterns: [
      /\bport fee/i, /order entry port/i, /\bdrop copy\b/i, /\bfan.?out\b/i,
      /physical port/i, /virtual control circuit/i, /\bVCC\b/,
      /connectivity fee/i, /\b10\s?Gb\b/i, /\b1\s?Gb\b/i, /gigabit port/i,
      /network access port/i, /connection fee/i, /\bhand.?off\b/i,
    ],
  },
  {
    cat: 'FEE_COLOCATION',
    patterns: [
      /co.?location/i, /\bcabinet\b/i, /\bpower fee\b/i,
      /cross.?connect/i, /\brack\b/i, /dedicated core/i, /\bcolo\b/i,
      /hosting fee/i, /proximity/i,
    ],
  },
  {
    cat: 'FEE_MARKET_DATA',
    patterns: [
      /market data fee/i, /data fee/i, /\bITCH\b/, /\bPITCH\b/,
      /\bSIP fee\b/i, /depth.of.book/i, /\bOPRA\b/,
      /historical data/i, /derived data/i, /data product fee/i,
      /information fee/i, /redistribution fee/i,
    ],
  },
  {
    cat: 'FEE_ROUTING',
    patterns: [
      /\srebate\b/i, /routing fee/i, /\btaker fee\b/i, /maker.taker/i,
      /transaction fee/i, /execution fee/i, /\badd credit\b/i,
      /\bremove fee\b/i, /\bpayment for order flow\b/i,
    ],
  },
  {
    cat: 'FEE_LISTING',
    patterns: [
      /listing fee/i, /\blisting standard/i, /issuer fee/i,
      /\bannual fee\b/i, /\bapplication fee\b/i,
    ],
  },
];

// Any title with a fee keyword but no specific category above → FEE_OTHER
const FEE_KEYWORDS = [
  /\bfee\b/i, /\bfees\b/i, /\bpric(e|ing)\b/i, /\bcharge\b/i,
  /\brebate\b/i, /\bcompensation\b/i, /\bsurcharge\b/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectFilingType(title) {
  if (/immediate effectiveness/i.test(title)) return 'immediate_effectiveness';
  if (/notice of withdrawal|withdrawal/i.test(title)) return 'withdrawn';
  if (/order instituting proceedings/i.test(title)) return 'proceedings';
  if (/order approving|order granting|order disapproving/i.test(title)) return 'final_order';
  if (/notice of filing/i.test(title)) return 'notice_and_comment';
  return 'unknown';
}

function classifyCategory(title) {
  for (const rule of CATEGORY_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(title)) return rule.cat;
    }
  }
  // Check for generic fee keywords → FEE_OTHER
  for (const kw of FEE_KEYWORDS) {
    if (kw.test(title)) return 'FEE_OTHER';
  }
  return 'RULE_CHANGE';
}

function extractSrNumber(docketIds) {
  if (!Array.isArray(docketIds)) return null;
  for (const id of docketIds) {
    if (/^File No\. SR-/i.test(id)) {
      return id.replace(/^File No\. /i, '');
    }
  }
  return null;
}

function detectExchangeFamily(srNumber) {
  // srNumber looks like "SR-NYSE-2024-69"
  // Strip the leading "SR-" and match against prefixes (trim any stray whitespace)
  const afterSR = srNumber.replace(/^SR-/i, '').trimStart();
  for (const [prefix, family] of Object.entries(SR_PREFIX_MAP)) {
    if (afterSR.startsWith(prefix)) return family;
  }
  return 'Other';
}

function effectiveDate(filingType, publicationDate) {
  if (filingType === 'immediate_effectiveness') return publicationDate;
  return null;
}

// ─── Federal Register API fetch ───────────────────────────────────────────────

const FR_API = 'https://www.federalregister.gov/api/v1/documents.json';
const FIELDS = ['title', 'document_number', 'publication_date', 'pdf_url', 'docket_ids', 'html_url', 'type', 'action'].join(',');
const UA = 'MarketDataNews-Research/1.0 contact@marketdatanews.com';

async function fetchPage(year, page, dateGte, dateLte) {
  const params = new URLSearchParams();
  params.append('fields[]', 'title');
  params.append('fields[]', 'document_number');
  params.append('fields[]', 'publication_date');
  params.append('fields[]', 'pdf_url');
  params.append('fields[]', 'docket_ids');
  params.append('fields[]', 'html_url');
  params.append('fields[]', 'type');
  params.append('fields[]', 'action');
  params.append('conditions[agencies][]', 'securities-and-exchange-commission');
  params.append('conditions[term]', '"self-regulatory organizations"');
  params.append('conditions[publication_date][gte]', dateGte);
  params.append('conditions[publication_date][lte]', dateLte);
  params.append('per_page', '100');
  params.append('page', String(page));

  const url = `${FR_API}?${params.toString()}`;

  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
      });
      if (res.status === 429) {
        console.warn(`[scraper] Rate limited on page ${page} of ${year}, waiting 2s...`);
        await sleep(2000);
        retries--;
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      return data;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      console.warn(`[scraper] Fetch error (retrying): ${err.message}`);
      await sleep(1000);
    }
  }
}

async function fetchYear(dateGte, dateLte, db, insertStmt) {
  const year = dateGte.slice(0, 4);
  let page = 1;
  let totalCount = null;
  let newCount = 0;
  let skippedNoSR = 0;
  let skippedSecAction = 0;

  while (true) {
    const data = await fetchPage(year, page, dateGte, dateLte);

    if (totalCount === null) {
      totalCount = data.count || 0;
      if (totalCount === 0) {
        console.log(`[scraper] Year ${year}: no documents found.`);
        break;
      }
      const pages = Math.ceil(totalCount / 100);
      console.log(`[scraper] Year ${year}: ${totalCount} documents across ${pages} pages`);
    }

    const results = data.results || [];

    for (const doc of results) {
      const srNumber = extractSrNumber(doc.docket_ids);
      if (!srNumber) {
        skippedNoSR++;
        continue;
      }

      const title = doc.title || '';
      const filingType = detectFilingType(title);

      if (['final_order', 'proceedings', 'unknown'].includes(filingType)) {
        skippedSecAction++;
        continue;
      }

      const category = classifyCategory(title);
      const exchangeFamily = detectExchangeFamily(srNumber);
      const pubDate = doc.publication_date || null;
      const effDate = effectiveDate(filingType, pubDate);
      const isWithdrawn = filingType === 'withdrawn' ? 1 : 0;

      try {
        const info = insertStmt.run(
          srNumber,
          exchangeFamily,
          pubDate,
          title,
          doc.document_number || null,
          doc.html_url || null,
          doc.pdf_url || null,
          filingType,
          effDate,
          category,
          'rules_based',
          isWithdrawn,
        );
        if (info.changes > 0) newCount++;
      } catch (err) {
        // UNIQUE constraint — already exists, skip
        if (!err.message.includes('UNIQUE')) {
          console.warn(`[scraper] Insert error for ${srNumber}: ${err.message}`);
        }
      }
    }

    if (!data.next_page_url) break;
    page++;
    await sleep(250);
  }

  console.log(`[scraper] Year ${year}: ${newCount} new, ${skippedNoSR} skipped (no SR), ${skippedSecAction} skipped (SEC actions)`);
  return { newCount, skippedNoSR, skippedSecAction };
}

// ─── Summary table ────────────────────────────────────────────────────────────

function printSummaryTable(db) {
  const categories = ['FEE_PORT', 'FEE_COLOCATION', 'FEE_MARKET_DATA', 'FEE_ROUTING', 'FEE_LISTING', 'FEE_OTHER', 'RULE_CHANGE'];
  const catLabels =  ['FEE_PORT', 'FEE_COLO',      'FEE_DATA',        'FEE_ROUT',   'FEE_LIST',   'FEE_OTHER', 'RULE_CHANGE'];

  const exchanges = db.prepare(`SELECT DISTINCT exchange_family FROM filings ORDER BY exchange_family`).all().map(r => r.exchange_family);

  console.log('\n[scraper] ─── Filing counts by exchange ───');

  const header = ['Exchange', ...catLabels, 'Total'].map(s => s.padEnd(12)).join('│ ');
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const exch of exchanges) {
    const row = [exch];
    let total = 0;
    for (const cat of categories) {
      const r = db.prepare(`SELECT COUNT(*) as c FROM filings WHERE exchange_family=? AND category=?`).get(exch, cat);
      row.push(r.c);
      total += r.c;
    }
    row.push(total);
    console.log(row.map(v => String(v).padEnd(12)).join('│ '));
  }

  // Totals row
  const totalRow = ['TOTAL'];
  let grandTotal = 0;
  for (const cat of categories) {
    const r = db.prepare(`SELECT COUNT(*) as c FROM filings WHERE category=?`).get(cat);
    totalRow.push(r.c);
    grandTotal += r.c;
  }
  totalRow.push(grandTotal);
  console.log('─'.repeat(header.length));
  console.log(totalRow.map(v => String(v).padEnd(12)).join('│ '));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI args
  let singleYear = null;
  let sinceDate = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' && args[i + 1]) {
      singleYear = parseInt(args[++i], 10);
    } else if (args[i] === '--since' && args[i + 1]) {
      sinceDate = args[++i];
    }
  }

  // Open / create database
  const dbPath = join(ROOT, 'data', '19b4-filings.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS filings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      sr_number        TEXT UNIQUE NOT NULL,
      exchange_family  TEXT,
      filing_date      TEXT,
      title            TEXT,
      fr_doc_number    TEXT,
      html_url         TEXT,
      pdf_url          TEXT,
      filing_type      TEXT,
      effective_date   TEXT,
      category         TEXT,
      category_method  TEXT DEFAULT 'rules_based',
      withdrawn        INTEGER DEFAULT 0,
      fetched_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_filings_date     ON filings(filing_date);
    CREATE INDEX IF NOT EXISTS idx_filings_exchange ON filings(exchange_family);
    CREATE INDEX IF NOT EXISTS idx_filings_category ON filings(category);
  `);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO filings
      (sr_number, exchange_family, filing_date, title, fr_doc_number,
       html_url, pdf_url, filing_type, effective_date, category,
       category_method, withdrawn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const currentYear = new Date().getFullYear();

  let yearsToProcess = [];

  if (singleYear) {
    yearsToProcess.push({ gte: `${singleYear}-01-01`, lte: `${singleYear}-12-31` });
  } else if (sinceDate) {
    const since = new Date(sinceDate);
    const today = new Date().toISOString().slice(0, 10);
    const startYear = since.getFullYear();
    for (let y = startYear; y <= currentYear; y++) {
      const gte = y === startYear ? sinceDate : `${y}-01-01`;
      const lte = y === currentYear ? today : `${y}-12-31`;
      yearsToProcess.push({ gte, lte });
    }
  } else {
    for (let y = 2017; y <= currentYear; y++) {
      yearsToProcess.push({ gte: `${y}-01-01`, lte: `${y}-12-31` });
    }
  }

  console.log(`[scraper] Starting scrape. Years/ranges to process: ${yearsToProcess.length}`);
  console.log(`[scraper] Database: ${dbPath}`);

  let totalNew = 0;
  let totalSkippedNoSR = 0;
  let totalSkippedSecAction = 0;

  for (const { gte, lte } of yearsToProcess) {
    const result = await fetchYear(gte, lte, db, insertStmt);
    totalNew += result.newCount;
    totalSkippedNoSR += result.skippedNoSR;
    totalSkippedSecAction += result.skippedSecAction;
    await sleep(500);
  }

  console.log(`\n[scraper] ─── Scrape complete ───`);
  console.log(`[scraper] Total new filings: ${totalNew}`);
  console.log(`[scraper] Total skipped (no SR number): ${totalSkippedNoSR}`);
  console.log(`[scraper] Total skipped (SEC actions): ${totalSkippedSecAction}`);

  // Summary table
  printSummaryTable(db);

  // Sample rows — 20 most recent fee filings (not RULE_CHANGE)
  const samples = db.prepare(`
    SELECT sr_number, exchange_family, filing_date, filing_type, category,
           substr(title, 1, 60) as title
    FROM filings
    WHERE category != 'RULE_CHANGE'
    ORDER BY filing_date DESC
    LIMIT 20
  `).all();

  console.log('\n[scraper] ─── 20 most recent fee filings (sample) ───');
  console.table(samples);

  // Export JSON
  const allFilings = db.prepare(`SELECT * FROM filings ORDER BY filing_date DESC`).all();
  const jsonPath = join(ROOT, 'data', 'sec-19b4-filings.json');
  const jsonExport = {
    generated: new Date().toISOString(),
    count: allFilings.length,
    filings: allFilings,
  };
  writeFileSync(jsonPath, JSON.stringify(jsonExport, null, 2));
  console.log(`\n[scraper] Exported ${allFilings.length} filings to ${jsonPath}`);

  db.close();
}

main().catch(err => {
  console.error('[scraper] Fatal error:', err);
  process.exit(1);
});
