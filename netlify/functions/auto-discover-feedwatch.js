// auto-discover-feedwatch.js
// Schedule: '0 11 * * 1' (Monday 6am ET — weekly)
// Scrapes CME, FINRA, Federal Register, NYSE for new market data notices
// Uses Claude to filter for material items and adds to FeedWatch

const { getStore } = require('@netlify/blobs');

const SOURCES = [
  {
    name: 'CME Globex Notices',
    url: 'https://www.cmegroup.com/rss/notices.xml',
    type: 'rss',
  },
  {
    name: 'FINRA Notices',
    url: 'https://www.finra.org/rss/notices',
    type: 'rss',
  },
  {
    name: 'Federal Register SEC SRO',
    url: 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=20&order=newest&agencies[]=securities-and-exchange-commission&conditions[term]=SR-',
    type: 'json',
  },
  {
    name: 'NYSE Trader Updates',
    url: 'https://www.nyse.com/rss/trader-updates',
    type: 'rss',
  },
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseRss(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const guid = (block.match(/<guid[^>]*>(.*?)<\/guid>/) || [])[1] || link;
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';

    if (pubDate) {
      const pub = new Date(pubDate).getTime();
      if (!isNaN(pub) && pub < cutoff) continue;
    }

    items.push({
      title: title.trim(),
      description: desc.replace(/<[^>]+>/g, '').trim().slice(0, 500),
      link: link.trim(),
      guid: guid.trim(),
      source: sourceName,
    });
  }
  return items;
}

function parseFederalRegisterJson(data, sourceName) {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  return (data.results || [])
    .filter(item => {
      const pub = new Date(item.publication_date).getTime();
      return !isNaN(pub) && pub >= cutoff;
    })
    .map(item => ({
      title: (item.title || '').trim(),
      description: (item.abstract || '').trim().slice(0, 500),
      link: item.html_url || '',
      guid: item.html_url || item.title || '',
      source: sourceName,
    }));
}

async function fetchSource(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[auto-discover] ${source.name} HTTP ${res.status}`);
      return [];
    }

    if (source.type === 'json') {
      const data = await res.json();
      return parseFederalRegisterJson(data, source.name);
    } else {
      const xml = await res.text();
      return parseRss(xml, source.name);
    }
  } catch (e) {
    console.error(`[auto-discover] Failed ${source.name}:`, e.message);
    return [];
  }
}

async function callClaude(newItems, existingTitles) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: `You are a market data infrastructure expert. Review these exchange notices and regulatory filings. For each one that represents a material change requiring action from market data professionals, extract:
- exchange: the exchange name (CME, NYSE, Nasdaq, FINRA etc)
- title: clear descriptive title under 80 chars
- description: 2-3 sentence plain English summary of what changed and what action is required
- effectiveDate: YYYY-MM-DD or YYYY-Q1/Q2/Q3/Q4 or TBD
- severity: CRITICAL (connectivity loss risk), HIGH (action required), MEDIUM (monitoring required), LOW (informational)
- category: CONNECTIVITY, PROTOCOL, FEE, MILESTONE, REGULATORY
- link: source URL

Return ONLY a valid JSON array. If nothing is material return empty array []. Do not include items already in the existing FeedWatch entries.`,
      messages: [{
        role: 'user',
        content: `Existing FeedWatch entry titles (do not duplicate these):\n${existingTitles.join('\n')}\n\nNew items to review:\n${JSON.stringify(newItems, null, 2)}`,
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();

  // Extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[auto-discover] Failed to parse Claude JSON:', e.message);
    return [];
  }
}

exports.handler = async () => {
  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    // Load existing entries and seen URLs
    const existingEntries = (await store.get('entries', { type: 'json' }).catch(() => [])) || [];
    const seenUrls = new Set((await store.get('auto-discovered-urls', { type: 'json' }).catch(() => [])) || []);
    const existingTitles = existingEntries.map(e => e.title).filter(Boolean);

    // Determine next ID
    const maxId = existingEntries.reduce((max, e) => {
      const num = parseInt((e.id || '').replace('FW-2026-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 38); // floor at 38 (current max)

    // Fetch all sources
    const allItems = [];
    for (const source of SOURCES) {
      const items = await fetchSource(source);
      allItems.push(...items);
    }

    console.log(`[auto-discover] Fetched ${allItems.length} total items across all sources`);

    // Filter out already-seen URLs
    const newItems = allItems.filter(item => item.guid && !seenUrls.has(item.guid));
    console.log(`[auto-discover] ${newItems.length} new items after dedup`);

    if (!newItems.length) {
      return { statusCode: 200, body: JSON.stringify({ scanned: allItems.length, added: 0, skipped: 'no new items' }) };
    }

    // Call Claude to filter for material items
    const materialItems = await callClaude(newItems, existingTitles);
    console.log(`[auto-discover] Claude found ${materialItems.length} material items`);

    // Mark all new item GUIDs as seen
    const updatedSeenUrls = [...seenUrls, ...newItems.map(i => i.guid)].slice(-2000);
    await store.set('auto-discovered-urls', JSON.stringify(updatedSeenUrls));

    if (!materialItems.length) {
      return { statusCode: 200, body: JSON.stringify({ scanned: allItems.length, newSeen: newItems.length, added: 0 }) };
    }

    // Assign IDs and timestamps
    let nextNum = maxId;
    const now = new Date().toISOString();
    const toAdd = materialItems.map(item => ({
      id: `FW-2026-${String(++nextNum).padStart(3, '0')}`,
      exchange: item.exchange || 'Unknown',
      title: (item.title || '').slice(0, 80),
      description: item.description || '',
      effectiveDate: item.effectiveDate || 'TBD',
      severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(item.severity) ? item.severity : 'MEDIUM',
      category: ['CONNECTIVITY', 'PROTOCOL', 'FEE', 'MILESTONE', 'REGULATORY'].includes(item.category) ? item.category : 'REGULATORY',
      link: item.link || '',
      source: 'auto-discovered',
      addedAt: now,
    }));

    // Merge and save
    const updatedEntries = [...toAdd, ...existingEntries];
    await store.set('entries', JSON.stringify(updatedEntries));

    console.log(`[auto-discover] Added ${toAdd.length} entries:`, toAdd.map(e => e.id).join(', '));
    return {
      statusCode: 200,
      body: JSON.stringify({ scanned: allItems.length, newSeen: newItems.length, added: toAdd.length, ids: toAdd.map(e => e.id) }),
    };
  } catch (e) {
    console.error('[auto-discover] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
