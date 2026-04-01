// daily-feedwatch.js
// Scheduled: 0 11 * * *  (6am ET / 11am UTC)
// Fetches SEC, FINRA, CFTC feeds and generates a FeedWatch digest via Claude.
// Output persisted to Netlify Blobs store 'content' under key 'feedwatch-digest'.

const { getStore } = require('@netlify/blobs');

const FEEDS = [
  {
    name: 'SEC EDGAR',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&dateb=&owner=include&count=10&search_text=&output=atom',
  },
  {
    name: 'FINRA Notices',
    url: 'https://www.finra.org/rules-guidance/notices/rss',
  },
  {
    name: 'CFTC Press Room',
    url: 'https://www.cftc.gov/rss/pressroom.xml',
  },
];

const SYSTEM_PROMPT =
  'You are a market data industry analyst. Review these regulatory notices and identify only those relevant to market data infrastructure, exchange connectivity, NMS plans, SIP feeds, or market data fees. Write a concise daily FeedWatch digest in the style of a professional market data newsletter. Format as HTML with a headline, 3-5 bullet points of material items, and a one paragraph summary. If nothing material, say so briefly.';

async function fetchFeed({ name, url }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews-FeedWatch/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    return { name, text };
  } catch (err) {
    console.error(`[daily-feedwatch] Failed to fetch ${name} (${url}):`, err.message);
    return { name, text: null };
  }
}

function extractTextFromXml(xml) {
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
    titles.map((t) => `• ${t}`).join('\n'),
    summaries.slice(0, 5).map((s) => s.slice(0, 300)).join('\n'),
    links.length ? `Links: ${links.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 5000);
}

exports.handler = async function () {
  const today = new Date().toISOString().split('T')[0];

  const results = await Promise.all(FEEDS.map(fetchFeed));

  const feedContent = results
    .map(({ name, text }) =>
      text ? `=== ${name} ===\n${extractTextFromXml(text)}` : `=== ${name} ===\n[Feed unavailable]`
    )
    .join('\n\n---\n\n');

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: feedContent }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('[daily-feedwatch] Claude API error:', detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Claude API error', detail }) };
    }

    const data = await apiRes.json();
    const html = data.content?.[0]?.text ?? '';

    digest = { date: today, generatedAt: new Date().toISOString(), html };
  } catch (err) {
    console.error('[daily-feedwatch] Unexpected error calling Claude:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  try {
    const store = getStore('content');
    await store.set('feedwatch-digest', JSON.stringify(digest));
    console.log('[daily-feedwatch] Digest saved to Netlify Blobs.');
  } catch (err) {
    console.error('[daily-feedwatch] Failed to save digest to Blobs:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(digest),
  };
};
