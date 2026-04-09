// daily-feedwatch.js
// Scheduled: 0 11 * * *  (6am ET / 11am UTC)
// Fetches SEC 19b-4 filings and Federal Register articles, includes active FeedWatch
// entries, then generates a market-data-focused digest via Claude.
// Output persisted to Netlify Blobs store 'content' under key 'feedwatch-digest'.
//
// GET /.netlify/functions/daily-feedwatch?refresh=true  → force regeneration

const { getStore } = require('@netlify/blobs');

// Federal Register API — reliable JSON endpoints replacing broken SEC EDGAR RSS
const FR_URL = 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=20&order=newest&agencies[]=securities-and-exchange-commission&conditions[term]=SR-';
const CFTC_URL = 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=10&order=newest&agencies[]=commodity-futures-trading-commission';

async function fetchJson(url, label) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews-FeedWatch/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`[daily-feedwatch] Failed to fetch ${label}:`, err.message);
    return null;
  }
}

function formatArticles(data, label) {
  if (!data || !data.results) return `=== ${label} ===\n[Feed unavailable]`;
  const articles = data.results.slice(0, 15);
  if (!articles.length) return `=== ${label} ===\n[No items]`;
  const body = articles.map((a, i) => {
    const parts = [];
    if (a.title) parts.push(`TITLE: ${a.title}`);
    if (a.publication_date) parts.push(`DATE: ${a.publication_date}`);
    if (a.abstract) parts.push(`ABSTRACT: ${a.abstract.slice(0, 350)}`);
    if (a.html_url) parts.push(`URL: ${a.html_url}`);
    return `[Item ${i + 1}] ${parts.join(' | ')}`;
  }).join('\n---\n');
  return `=== ${label} ===\n${body}`;
}


// Simple markdown → HTML converter for digest rendering
function markdownToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inList = false;

  for (const line of lines) {
    if (/^## (.+)$/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${line.replace(/^## /, '')}</h2>`);
    } else if (/^### (.+)$/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${line.replace(/^### /, '')}</h3>`);
    } else if (/^[-•*] (.+)$/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${line.replace(/^[-•*] /, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`);
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      const text = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
      out.push(`<p>${text}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

exports.handler = async function (event) {
  const forceRefresh = event?.queryStringParameters?.refresh === 'true';
  const today = new Date().toISOString().split('T')[0];
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const store = getStore({
    name: 'content',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  // Skip regeneration if today's digest already exists and ?refresh=true not set
  if (!forceRefresh) {
    try {
      const existing = await store.get('feedwatch-digest', { type: 'json' });
      if (existing && existing.date === today) {
        console.log('[daily-feedwatch] Today\'s digest already exists, returning cached.');
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(existing),
        };
      }
    } catch (_) { /* no existing digest — proceed with generation */ }
  }

  // Fetch Federal Register feeds in parallel
  const [frData, cftcData] = await Promise.all([
    fetchJson(FR_URL, 'Federal Register — SEC SR- Filings'),
    fetchJson(CFTC_URL, 'Federal Register — CFTC'),
  ]);
  const feedContent = [
    formatArticles(frData, 'Federal Register — SEC Exchange Rule Filings (SR-)'),
    formatArticles(cftcData, 'Federal Register — CFTC'),
  ].join('\n\n---\n\n');

  // ── FeedWatch date helpers ───────────────────────────────────────────────
  const QUARTER_ENDS = { Q1: [2, 31], Q2: [5, 30], Q3: [8, 30], Q4: [11, 31] };

  function effectiveDateFuture(dateStr) {
    if (!dateStr) return false;
    const s = String(dateStr).trim();
    if (/^TBD$/i.test(s)) return true;
    // Q-date: "2026-Q2", "2026-Q3", etc.
    const qMatch = s.match(/^(\d{4})-Q([1-4])$/i);
    if (qMatch) {
      const year = parseInt(qMatch[1], 10);
      const [month, day] = QUARTER_ENDS[`Q${qMatch[2]}`];
      const quarterEnd = new Date(year, month, day, 23, 59, 59);
      return quarterEnd.getTime() >= Date.now();
    }
    // Regular date
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return d.getTime() >= new Date().setHours(0, 0, 0, 0);
  }

  // Fetch FeedWatch entries from Blobs
  let feedwatchEntries = 'No upcoming FeedWatch entries.';
  try {
    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const fwData = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(fwData) ? fwData : [];

    const upcoming = entries
      .filter((e) => {
        const dateField = e.effectiveDate || e.deadline || e.date || '';
        return effectiveDateFuture(dateField);
      })
      .sort((a, b) => {
        const da = new Date(a.effectiveDate || a.deadline || '9999');
        const db = new Date(b.effectiveDate || b.deadline || '9999');
        return da - db;
      })
      .slice(0, 15);

    if (upcoming.length) {
      feedwatchEntries = upcoming.map((e) => {
        const dateField = e.effectiveDate || e.deadline || e.date || 'TBD';
        return `• [${e.severity || 'MEDIUM'}] ${e.exchange || ''} — ${e.title || ''}` +
          ` | Effective: ${dateField}` +
          (e.description ? ` | ${e.description.slice(0, 150)}` : '');
      }).join('\n');
    }
  } catch (err) {
    console.error('[daily-feedwatch] Failed to fetch FeedWatch entries:', err.message);
  }

  const systemPrompt =
    `You are the editor of Market Data News, an intelligence platform for market data professionals.

Today is ${todayLabel}.

Write a concise daily digest for market data professionals. Focus ONLY on:
- Exchange rule filings (SR-NYSE-, SR-NASDAQ-, SR-CBOE-, SR-FINRA-, SR-CME-)
- NMS plan amendments
- Market data fee changes
- Connectivity and infrastructure notices
- CAT, OPRA, UTP, CTA plan updates
- CFTC notices affecting futures market data

Format as markdown with these sections:

## ${todayLabel} Market Data Intelligence Brief

### Key Developments
[2-4 bullet points of the most important items — if nothing market-data-specific found say so briefly]

### Exchange Rule Filings
[List any SR- filings with brief description]

### FeedWatch Alerts
[Only highlight FeedWatch entries with FUTURE effective dates as upcoming alerts. Do not mention entries whose deadlines have already passed unless providing historical context. Today is ${todayLabel}.]

### Regulatory Pipeline
[Any pending rulemakings relevant to market data]

Keep each section brief — 2-5 lines max. If a section has no relevant content skip it entirely. Never say 'nothing to report' — instead omit empty sections. Total length: 200-350 words.`;

  const userPrompt =
    `Here are today's SEC and CFTC regulatory filings and notices:\n${feedContent}\n\nHere are the current FeedWatch entries (active infrastructure deadlines):\n${feedwatchEntries}`;

  let digest;
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
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('[daily-feedwatch] Claude API error:', detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Claude API error', detail }) };
    }

    const data = await apiRes.json();
    const markdown = data.content?.[0]?.text ?? '';
    const html = markdownToHtml(markdown);

    digest = { date: today, generatedAt: new Date().toISOString(), html, markdown };
  } catch (err) {
    console.error('[daily-feedwatch] Unexpected error calling Claude:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  try {
    await store.set('feedwatch-digest', JSON.stringify(digest));
    console.log('[daily-feedwatch] Digest saved. date=' + digest.date);
  } catch (err) {
    console.error('[daily-feedwatch] Failed to save digest to Blobs:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(digest),
  };
};
