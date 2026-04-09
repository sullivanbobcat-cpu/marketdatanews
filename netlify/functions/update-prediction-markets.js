// update-prediction-markets.js
// Schedule: 0 12 * * *  (7am ET daily = 12:00 UTC)
// Fetches CFTC RSS + Federal Register, filters for prediction market content,
// calls Claude to identify new developments, merges with existing Blob entries.
// GET ?seed=true  → seeds initial hardcoded entries

const { getStore } = require('@netlify/blobs');

const CFTC_RSS_URL = 'https://www.cftc.gov/rss/pressreleases.xml';
const FR_CFTC_URL = 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=10&order=newest&agencies[]=commodity-futures-trading-commission';

const KEYWORDS = [
  'prediction market', 'event contract', 'kalshi', 'polymarket', '5c(c)',
  'binary contract', 'designated contract market', 'DCM', 'sports contract',
  'insider trading', 'ANPRM', 'gambling', 'preemption',
];

// Seed data from existing page entries
const SEED_ENTRIES = [
  {
    date: '2026-01-29',
    title: 'SEC/CFTC Joint Project Crypto Summit',
    description: 'CFTC Chair Selig announces four-part regulatory agenda for prediction markets at joint summit with SEC. Framework covers manipulation, insider trading, government official trading restrictions, and contract self-certification standards.',
    type: 'RULEMAKING',
    severity: 'HIGH',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-02-25',
    title: 'CFTC Enforcement Advisory Issued',
    description: 'CFTC issues formal enforcement advisory clarifying full enforcement authority over CFTC-registered designated contract markets. Kalshi reports two insider trading cases referred to enforcement. CFTC confirms ability to bring manipulation charges against prediction market participants.',
    type: 'ENFORCEMENT',
    severity: 'HIGH',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-03-01',
    title: 'Arizona Files First Criminal Charges Against Kalshi',
    description: 'Arizona files first criminal charges against Kalshi for illegal gambling and election wagering under state law. Kalshi calls charges "paper thin" and without merit. First criminal prosecution of a CFTC-registered prediction market platform.',
    type: 'LITIGATION',
    severity: 'CRITICAL',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-03-12',
    title: 'CFTC Advance Notice of Proposed Rulemaking on Event Contracts',
    description: 'CFTC issues ANPRM on event contract regulation. Guidance Advisory 26-08 simultaneously issued to all DCMs establishing manipulation resistance standards for binary contract markets. Comment period opened for sports contracts, insider trading rules, and trading restrictions on government officials.',
    type: 'RULEMAKING',
    severity: 'CRITICAL',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/9185-26',
  },
  {
    date: '2026-03-15',
    title: 'DOJ Exploring Insider Trading Jurisdiction Over Prediction Markets',
    description: 'Federal prosecutors exploring whether prediction market bets on company-specific events could constitute insider trading under existing federal securities law. No charges filed. Jurisdiction over CFTC-registered platforms versus SEC securities law remains the central question.',
    type: 'ENFORCEMENT',
    severity: 'HIGH',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-03-23',
    title: '5c(c) Capital Fund Launched by Kalshi and Polymarket CEOs',
    description: 'New venture fund backed by Kalshi CEO Tarek Mansour, Polymarket CEO Shayne Coplan, Marc Andreessen, and Ribbit Capital. Named after the CFTC section governing event contracts. Fund targets prediction market infrastructure and adjacent fintech investments.',
    type: 'INDUSTRY',
    severity: 'MEDIUM',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-03-26',
    title: 'Nevada Issues Preliminary Injunction Against Coinbase Prediction Markets',
    description: 'Nevada court issues preliminary injunction against Coinbase prediction market product. Coinbase immediately files preemptive federal lawsuit asserting CFTC registration preempts state gaming law. Case expected to be bellwether for federal versus state jurisdiction.',
    type: 'LITIGATION',
    severity: 'HIGH',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
  {
    date: '2026-03-27',
    title: 'Washington AG Files Against Kalshi Over Sports Event Contracts',
    description: 'Washington State Attorney General files action against Kalshi over sports event contracts — sixth state to take formal action. Kalshi argues federal preemption under CFTC registration. Case joins existing proceedings in New York, Massachusetts, Arizona, and Nevada.',
    type: 'LITIGATION',
    severity: 'HIGH',
    source_url: 'https://www.cftc.gov/PressRoom/PressReleases/index.htm',
  },
];

const SEED_COMMENT_STATUS = {
  open: true,
  closeDate: '2026-06-10',
  daysRemaining: 0, // computed at runtime
};

function isRelevant(text) {
  const lower = (text || '').toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function parseXmlItems(xml) {
  if (!xml) return [];
  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const pull = (tag, src) =>
    [...src.matchAll(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'gi'))].map(m => strip(m[1])).filter(Boolean);

  // Split into <item> blocks
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  return itemBlocks.map(block => ({
    title: pull('title', block)[0] || '',
    description: pull('description', block)[0] || '',
    link: pull('link', block)[0] || '',
    pubDate: pull('pubDate', block)[0] || '',
  })).filter(item => isRelevant(item.title + ' ' + item.description));
}

function parseFrArticles(data) {
  const articles = (data && data.results) || [];
  return articles
    .filter(a => isRelevant((a.title || '') + ' ' + (a.abstract || '')))
    .map(a => ({
      title: a.title || '',
      description: a.abstract || '',
      link: a.html_url || '',
      pubDate: a.publication_date || '',
    }));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    console.error(`[update-pm] Fetch failed ${url}:`, err.message);
    return null;
  }
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter(e => {
    const key = `${e.date}|${(e.title || '').toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeDaysRemaining(closeDate) {
  const d = new Date(closeDate + 'T23:59:59Z');
  return Math.max(0, Math.round((d - Date.now()) / (24 * 60 * 60 * 1000)));
}

exports.handler = async function (event) {
  const isSeed = event?.queryStringParameters?.seed === 'true';

  const store = getStore({
    name: 'prediction-markets',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  // ── SEED MODE ──────────────────────────────────────────────────────────────
  if (isSeed) {
    try {
      const commentStatus = {
        ...SEED_COMMENT_STATUS,
        daysRemaining: computeDaysRemaining(SEED_COMMENT_STATUS.closeDate),
      };
      await store.set('prediction-market-updates', JSON.stringify(SEED_ENTRIES));
      await store.set('cftc-comment-status', JSON.stringify(commentStatus));
      console.log('[update-pm] Seeded', SEED_ENTRIES.length, 'entries');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeded: SEED_ENTRIES.length, commentStatus }),
      };
    } catch (err) {
      console.error('[update-pm] Seed error:', err.message);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── SCHEDULED UPDATE MODE ──────────────────────────────────────────────────
  try {
    // Load existing entries (auto-seed if empty)
    let existingEntries = await store.get('prediction-market-updates', { type: 'json' }).catch(() => null);
    if (!Array.isArray(existingEntries) || existingEntries.length === 0) {
      existingEntries = SEED_ENTRIES;
    }

    // Fetch feeds in parallel
    const [cftcRes, frRes] = await Promise.all([
      fetchWithTimeout(CFTC_RSS_URL),
      fetchWithTimeout(FR_CFTC_URL),
    ]);

    const feedItems = [];

    if (cftcRes) {
      const xml = await cftcRes.text();
      feedItems.push(...parseXmlItems(xml).slice(0, 10));
    }
    if (frRes) {
      const frData = await frRes.json();
      feedItems.push(...parseFrArticles(frData).slice(0, 10));
    }

    if (!feedItems.length) {
      console.log('[update-pm] No relevant feed items found');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no relevant items', total: existingEntries.length }) };
    }

    const feedContent = feedItems.map((item, i) =>
      `[${i + 1}] TITLE: ${item.title}\nDATE: ${item.pubDate}\nURL: ${item.link}\nSUMMARY: ${(item.description || '').slice(0, 400)}`
    ).join('\n\n');

    const existingSummary = existingEntries.slice(0, 20).map(e =>
      `${e.date} — ${e.title}`
    ).join('\n');

    const systemPrompt = `You are tracking regulatory developments in the prediction markets industry. Return only valid JSON.`;

    const userPrompt = `Here are the latest CFTC and Federal Register items:\n${feedContent}\n\nHere are the existing tracker entries already on the page:\n${existingSummary}\n\nIdentify any NEW developments not already in the existing entries. For each new development return a JSON array with these fields:\n- date: YYYY-MM-DD\n- title: short headline (max 80 chars)\n- description: 2-3 sentence plain English summary of what happened and why it matters for prediction market infrastructure and regulation\n- type: one of RULEMAKING, ENFORCEMENT, LITIGATION, LEGISLATION, INDUSTRY\n- severity: CRITICAL HIGH MEDIUM or LOW\n- source_url: link to the primary source\n\nReturn only valid JSON array. If no new developments return empty array [].`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    let newEntries = [];
    if (apiRes.ok) {
      const apiData = await apiRes.json();
      const text = apiData.content?.[0]?.text || '[]';
      try {
        const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]');
        newEntries = Array.isArray(parsed) ? parsed : [];
        console.log('[update-pm] Claude identified', newEntries.length, 'new entries');
      } catch (e) {
        console.error('[update-pm] JSON parse error from Claude:', e.message);
      }
    } else {
      console.error('[update-pm] Claude API error:', apiRes.status);
    }

    // Merge, dedupe, sort, cap at 50
    const merged = dedupeEntries([...newEntries, ...existingEntries])
      .filter(e => e.date && e.title)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);

    await store.set('prediction-market-updates', JSON.stringify(merged));

    // ── Check/update comment period status ────────────────────────────────────
    let commentStatus = await store.get('cftc-comment-status', { type: 'json' }).catch(() => null);
    if (!commentStatus) {
      commentStatus = { ...SEED_COMMENT_STATUS };
    }
    // Check feed content for ANPRM close date clues
    const anprmMatch = feedContent.match(/comment(?:s)?\s+(?:due|close[sd]?|period(?:\s+ends?)?)[^\d]*(\w+\s+\d{1,2},?\s+\d{4})/i);
    if (anprmMatch) {
      const parsedClose = new Date(anprmMatch[1]);
      if (!isNaN(parsedClose.getTime())) {
        commentStatus.closeDate = parsedClose.toISOString().split('T')[0];
      }
    }
    commentStatus.daysRemaining = computeDaysRemaining(commentStatus.closeDate);
    commentStatus.open = commentStatus.daysRemaining > 0;
    await store.set('cftc-comment-status', JSON.stringify(commentStatus));

    console.log('[update-pm] Done. total entries:', merged.length, 'new:', newEntries.length);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: merged.length, added: newEntries.length, commentStatus }),
    };
  } catch (err) {
    console.error('[update-pm] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
