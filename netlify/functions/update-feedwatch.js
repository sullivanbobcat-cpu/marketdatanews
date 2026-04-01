const { getStore } = require('@netlify/blobs');

const FEEDS = [
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&dateb=&owner=include&count=20&search_text=&output=atom',
  'https://ir.nasdaq.com/rss/news-releases.xml',
  'https://www.cftc.gov/rss/pressroom.xml',
];

async function fetchFeed(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0 (+https://marketdatanews.com)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return `<!-- ${url} returned ${res.status} -->`;
    return await res.text();
  } catch (err) {
    console.warn(`[update-feedwatch] Feed failed (${url}): ${err.message}`);
    return `<!-- ${url} failed: ${err.message} -->`;
  }
}

exports.handler = async function(event) {
  try {
    const feedResults = await Promise.all(
      FEEDS.map(url => fetchFeed(url).then(text => ({ url, text })))
    );

    const combined = feedResults
      .map(({ url, text }) => `\n\n=== FEED: ${url} ===\n${text.slice(0, 8000)}`)
      .join('\n');

    const today = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are a FeedWatch market data calendar editor. Review these regulatory notices and exchange announcements. Extract only items relevant to market data infrastructure, exchange connectivity, feed changes, NMS plans, SIP updates, or market data fees. For each relevant item create a FeedWatch calendar entry. Return ONLY a JSON array with no other text. Each entry should have these fields: id (unique string like FW-2026-001), exchange (the exchange or regulator name), title (concise title under 80 characters), description (one sentence description), effectiveDate (date string or TBD), severity (one of CRITICAL, HIGH, MEDIUM, LOW), category (one of MILESTONE, TESTEVENT, SYMBOLOGY, CONNECTIVITY, FEE), source (the feed URL it came from), link (the original article URL if available), addedAt (today's date ISO string). If no relevant items found return an empty array.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Today is ${today}. Here are the feeds to analyze:\n${combined}` }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text;

    let newEntries = [];
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { newEntries = JSON.parse(jsonMatch[0]); } catch { newEntries = []; }
    }

    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const existing = await store.get('entries', { type: 'json' }).catch(() => []);
    const existingEntries = Array.isArray(existing) ? existing : [];
    const existingTitles = new Set(existingEntries.map(e => (e.title || '').toLowerCase().trim()));

    const fresh = newEntries.filter(
      e => e.title && !existingTitles.has(e.title.toLowerCase().trim())
    );

    const merged = [...existingEntries, ...fresh];
    await store.set('entries', JSON.stringify(merged));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        added: fresh.length,
        total: merged.length,
        newTitles: fresh.map(e => e.title),
      }),
    };
  } catch (err) {
    console.error('[update-feedwatch] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
