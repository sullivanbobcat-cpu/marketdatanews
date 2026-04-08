// daily-feedwatch.js
// Scheduled: 0 11 * * *  (6am ET / 11am UTC)
// Fetches SEC 19b-4 filings and Federal Register articles, includes active FeedWatch
// entries, then generates a market-data-focused digest via Claude.
// Output persisted to Netlify Blobs store 'content' under key 'feedwatch-digest'.
//
// GET /.netlify/functions/daily-feedwatch?refresh=true  → force regeneration

const { getStore } = require('@netlify/blobs');

const FEEDS = [
  {
    name: 'SEC EDGAR 19b-4 Filings',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=19b-4&dateb=&owner=include&count=10&search_text=&output=atom',
    type: 'xml',
  },
  {
    name: 'Federal Register — SEC',
    url: 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=agency_names&per_page=20&order=newest&agencies[]=securities-and-exchange-commission',
    type: 'json',
  },
  {
    name: 'Federal Register — CFTC',
    url: 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=agency_names&per_page=10&order=newest&agencies[]=commodity-futures-trading-commission',
    type: 'json',
  },
];

async function fetchFeed({ name, url, type }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews-FeedWatch/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    return { name, text, type };
  } catch (err) {
    console.error(`[daily-feedwatch] Failed to fetch ${name}:`, err.message);
    return { name, text: null, type };
  }
}

function extractXml(xml) {
  if (!xml) return '';
  const strip = (s) =>
    s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const pull = (tag) =>
    [...xml.matchAll(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'gi'))]
      .map((m) => strip(m[1]))
      .filter(Boolean);

  const titles = pull('title').slice(1, 15);
  const summaries = pull('summary').concat(pull('description')).slice(0, 8);
  const links = [...xml.matchAll(/<link[^>]+href="([^"]+)"/gi)].map((m) => m[1]).slice(0, 8);

  return [
    titles.map((t) => `TITLE: ${t}`).join('\n'),
    summaries.slice(0, 5).map((s, i) => `SUMMARY ${i + 1}: ${s.slice(0, 400)}`).join('\n'),
    links.length ? `Links: ${links.join(', ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 5000);
}

function extractJson(text) {
  if (!text) return '';
  try {
    const data = JSON.parse(text);
    const articles = data.results || (Array.isArray(data) ? data : []);
    return articles.slice(0, 15).map((a, i) => {
      const parts = [];
      if (a.title) parts.push(`TITLE: ${a.title}`);
      if (a.agency_names && a.agency_names.length) parts.push(`AGENCY: ${a.agency_names.join(', ')}`);
      if (a.publication_date) parts.push(`DATE: ${a.publication_date}`);
      if (a.abstract) parts.push(`ABSTRACT: ${a.abstract.slice(0, 350)}`);
      return `[Item ${i + 1}] ${parts.join(' | ')}`;
    }).join('\n---\n').slice(0, 6000);
  } catch (err) {
    console.error('[daily-feedwatch] JSON parse error:', err.message);
    return '[Could not parse JSON feed]';
  }
}

function extractContent({ name, text, type }) {
  if (!text) return `=== ${name} ===\n[Feed unavailable]`;
  const body = type === 'json' ? extractJson(text) : extractXml(text);
  return `=== ${name} ===\n${body || '[No items]'}`;
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

  // Fetch all feeds in parallel
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const feedContent = results.map(extractContent).join('\n\n---\n\n');

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

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

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
