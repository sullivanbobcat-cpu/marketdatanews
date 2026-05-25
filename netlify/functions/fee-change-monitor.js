// fee-change-monitor.js
// Scheduled: 0 13 * * *  (8am ET / 13:00 UTC)
// Monitors NYSE pricing PDF and Nasdaq Trader notices for market data fee changes via Claude.
// Persists fee-alerts to Netlify Blobs only when changes are detected.

const { getStore } = require('@netlify/blobs');

const SOURCES = [
  {
    name: 'NYSE Market Data Pricing',
    url: 'https://www.nyse.com/publicdocs/nyse/data/NYSE_Market_Data_Pricing.pdf',
    note: 'NYSE market data fee schedule PDF. Contains pricing tiers and rate information.',
    type: 'PDF',
  },
  {
    name: 'Nasdaq Trader News',
    url: 'https://www.nasdaqtrader.com/content/whatsnew/whatsnewrss.xml',
    note: 'RSS feed of Nasdaq Trader market and equity trading notices.',
    type: 'RSS',
  },
];

const SYSTEM_PROMPT =
  'You are a market data fee analyst reviewing pre-filtered regulatory content. ' +
  'Identify ONLY changes to these specific fee categories:\n' +
  '- Per-message, per-execution, or per-order fees\n' +
  '- Port fees, connectivity fees, cross-connect fees\n' +
  '- Market data subscription fees, depth-of-book fees, SIP fees, OPRA fees\n' +
  '- Co-location, cabinet, or power fees\n' +
  '- Routing fees, access fees, or rebate changes\n' +
  '\n' +
  'EXCLUDE and do NOT flag: dividends, earnings, executive pay, stock repurchases, ' +
  'corporate actions, M&A, investor relations announcements, or general business news. ' +
  'If content is garbled, corrupt, or unreadable, treat it as no findings.\n' +
  '\n' +
  'Output ONLY valid JSON: { "hasChanges": boolean, "changes": [ { "exchange": string, ' +
  '"product": string, "changeType": string, "description": string, "effectiveDate": string, ' +
  '"sourceUrl": string } ], "summary": string }. No text outside the JSON object.';

// ── Document classification — runs BEFORE Claude sees anything ───────────────
// Only SR_FILING, EXCHANGE_NOTICE, and TECHNICAL_BULLETIN proceed to fee analysis.
// Everything else is dropped and logged.

const FEE_ELIGIBLE_TYPES = new Set(['SR_FILING', 'EXCHANGE_NOTICE', 'TECHNICAL_BULLETIN']);

const IR_SIGNALS = [
  /\bdividend\b/i, /\bper share\b/i, /\bquarterly dividend\b/i,
  /\bearnings per share\b/i, /\bnet income\b/i, /\bfiscal (year|quarter)\b/i,
  /\bquarterly results\b/i, /\bannual report\b/i, /\bshareholder\b/i,
  /\binvestor relations\b/i, /\bshare repurchase\b/i, /\bbuyback\b/i,
  /\bexecutive compensation\b/i, /\bappoints\b/i, /\bacquires\b/i,
  /\bmerger\b/i, /\bacquisition\b/i, /\bearnings release\b/i,
];

const SR_SIGNALS = [
  /\bSR-[A-Z]+-\d{4}-\d+\b/,
  /self-regulatory organization/i,
  /proposed rule change/i,
  /national market system plan/i,
];

const EXCHANGE_NOTICE_SIGNALS = [
  /fee schedule/i, /pricing schedule/i, /fee change/i, /fee amendment/i,
  /connectivity fee/i, /port fee/i, /co-?location/i,
  /market data fee/i, /subscription fee/i, /depth.of.book fee/i,
  /SIP fee/i, /trader notice/i, /information circular/i,
  /19b-4/i, /feeschedule/i, /rule.filing/i, /access fee/i,
  /rebate/i, /routing fee/i, /cabinet fee/i, /power fee/i,
];

const TECHNICAL_BULLETIN_SIGNALS = [
  /technical bulletin/i, /system notice/i, /connectivity notice/i,
  /protocol update/i, /infrastructure notice/i, /network notice/i,
];

function classifyItem(title, description, link) {
  const text = `${title} ${description} ${link}`;
  // IR signals are hard exclusions — checked first
  if (IR_SIGNALS.some((re) => re.test(text))) {
    // Only rescue if there's an explicit SR filing reference
    if (SR_SIGNALS.some((re) => re.test(text))) return 'SR_FILING';
    return 'IR_ANNOUNCEMENT';
  }
  if (SR_SIGNALS.some((re) => re.test(text))) return 'SR_FILING';
  if (EXCHANGE_NOTICE_SIGNALS.some((re) => re.test(text))) return 'EXCHANGE_NOTICE';
  if (TECHNICAL_BULLETIN_SIGNALS.some((re) => re.test(text))) return 'TECHNICAL_BULLETIN';
  return 'OTHER';
}

// ── Post-classification URL validation ──────────────────────────────────────
// Each finding's sourceUrl must match a fee-related path pattern.
// Catches classification errors before findings reach subscribers.

const FEE_URL_PATTERNS = [
  /19b-4/i, /fee.?schedule/i, /rule.?filing/i, /trader.?notice/i,
  /pricing/i, /whatsnew/i, /colocation/i, /co.?location/i,
  /connectivity/i, /market.?data/i, /publicdocs/i, /federalregister/i,
  /nasdaqtrader/i,
];

function validateFindings(changes) {
  const valid = [];
  for (const c of changes) {
    const url = c.sourceUrl || '';
    if (!url || FEE_URL_PATTERNS.some((re) => re.test(url))) {
      valid.push(c);
    } else {
      console.warn(`[fee-change-monitor] Dropping finding "${c.product}" — source URL failed validation: ${url}`);
    }
  }
  return valid;
}

async function fetchSource({ name, url }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews-FeeMonitor/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const contentType = res.headers.get('content-type') ?? '';
    let text;

    if (contentType.includes('pdf') || url.endsWith('.pdf')) {
      let rawText;
      try {
        const buf = await res.arrayBuffer();
        rawText = Buffer.from(buf)
          .toString('latin1')
          .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
          .replace(/\s{3,}/g, '\n')
          .slice(0, 8000);
      } catch (pdfErr) {
        // Log the error but never pass it to Claude
        console.error(`[fee-change-monitor] PDF read error for ${name}:`, pdfErr.message);
        return { name, text: null };
      }

      // Quality gate: reject if fewer than 70% printable chars or no fee keywords
      const printableRatio = (rawText.match(/[a-zA-Z0-9 .,\-$%]/g) || []).length / Math.max(rawText.length, 1);
      const hasFeeContent = /fee|price|pricing|rate|cost|subscription|per message|per execution/i.test(rawText);

      if (printableRatio < 0.70 || !hasFeeContent) {
        console.error(
          `[fee-change-monitor] PDF extraction for ${name} failed quality gate — ` +
          `printableRatio=${printableRatio.toFixed(2)}, hasFeeContent=${hasFeeContent}. Skipping source.`
        );
        return { name, text: null };
      }
      text = rawText;
    } else {
      text = await res.text();
    }
    return { name, text };
  } catch (err) {
    console.error(`[fee-change-monitor] Failed to fetch ${name} (${url}):`, err.message);
    return { name, text: null };
  }
}

function filterAndExtractRssItems(xml, sourceName) {
  if (!xml) return '';
  const strip = (s) =>
    s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const pullFirst = (tag, src) => {
    const m = src.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
    return m ? strip(m[1]) : '';
  };

  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const kept = [];
  let dropped = 0;

  for (const block of itemBlocks) {
    const title = pullFirst('title', block);
    const description = pullFirst('description', block).slice(0, 300);
    const link = pullFirst('link', block) || pullFirst('guid', block);
    const docType = classifyItem(title, description, link);

    if (FEE_ELIGIBLE_TYPES.has(docType)) {
      kept.push(`[${docType}] ${title}${description ? ': ' + description : ''}`);
    } else {
      dropped++;
      console.log(`[fee-change-monitor] Dropped "${title}" from ${sourceName} — classified as ${docType}`);
    }
  }

  if (!kept.length) {
    console.log(`[fee-change-monitor] ${sourceName}: all ${dropped} items dropped by classifier — no fee-eligible content.`);
    return '';
  }

  console.log(`[fee-change-monitor] ${sourceName}: kept ${kept.length}, dropped ${dropped}`);
  return kept.join('\n').slice(0, 4000);
}

exports.handler = async function () {
  const today = new Date().toISOString().split('T')[0];

  const fetched = await Promise.all(SOURCES.map(fetchSource));

  const contentBlocks = fetched.map(({ name, text }, i) => {
    const note = SOURCES[i].note;
    if (!text) return null;
    const isXml = text.trimStart().startsWith('<') || text.includes('<?xml');
    const extracted = isXml ? filterAndExtractRssItems(text, name) : text.slice(0, 4000);
    if (!extracted) return null;
    return `=== ${name} ===\nNote: ${note}\n\n${extracted}`;
  }).filter(Boolean);

  if (!contentBlocks.length) {
    console.log('[fee-change-monitor] No usable content from any source today.');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: today,
        checkedAt: new Date().toISOString(),
        hasChanges: false,
        changes: [],
        summary: 'No fee changes detected in monitored sources today.',
      }),
    };
  }

  const feedContent = contentBlocks.join('\n\n---\n\n');

  let parsed;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: feedContent }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('[fee-change-monitor] Claude API error:', detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Claude API error', detail }) };
    }

    const data = await apiRes.json();
    const rawText = data.content?.[0]?.text ?? '{}';

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { hasChanges: false, changes: [], summary: rawText };
  } catch (err) {
    console.error('[fee-change-monitor] Error calling Claude or parsing response:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  // Post-validation: drop any findings whose source URL doesn't match fee-related patterns
  if (parsed.hasChanges && Array.isArray(parsed.changes)) {
    parsed.changes = validateFindings(parsed.changes);
    parsed.hasChanges = parsed.changes.length > 0;
    if (!parsed.hasChanges) {
      console.warn('[fee-change-monitor] All findings dropped by post-validation.');
    }
  }

  // Normalize empty result to a clean summary
  if (!parsed.hasChanges || !parsed.changes?.length) {
    parsed.hasChanges = false;
    parsed.changes = [];
    parsed.summary = parsed.summary || 'No fee changes detected in monitored sources today.';
  }

  const result = { date: today, checkedAt: new Date().toISOString(), ...parsed };

  if (parsed.hasChanges) {
    try {
      const store = getStore({
        name: 'content',
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_TOKEN,
      });
      await store.set('fee-alerts', JSON.stringify(result));
      console.log('[fee-change-monitor] Fee changes detected — saved to Netlify Blobs.');
    } catch (err) {
      console.error('[fee-change-monitor] Failed to save alerts to Blobs:', err.message);
    }
  } else {
    console.log('[fee-change-monitor] No fee changes detected.');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
