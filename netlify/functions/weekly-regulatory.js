// weekly-regulatory.js
// Scheduled: 0 12 * * 1  (7am ET / 12pm UTC, every Monday)
// Fetches SEC EDGAR filings and generates a weekly regulatory roundup via Claude.
// Output persisted to Netlify Blobs store 'content' under key 'weekly-regulatory'.

const { getStore } = require('@netlify/blobs');

const FEED_URL =
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&dateb=&owner=include&count=20&search_text=&output=atom';

const SYSTEM_PROMPT =
  'You are a regulatory intelligence analyst specializing in US equity market structure and market data regulation. Review these SEC filings and identify NMS plan amendments, SIP-related rule changes, market data fee filings, and exchange rule changes affecting data dissemination. Write a weekly regulatory roundup as professional HTML with sections for: Key Filings This Week, NMS Plan Updates, Fee Changes, What To Watch Next Week.';

function getWeekLabel() {
  const d = new Date();
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay() + 1); // Monday
  return start.toISOString().split('T')[0];
}

function extractTextFromXml(xml) {
  if (!xml) return '';
  const strip = (s) =>
    s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const pull = (tag) =>
    [...xml.matchAll(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'gi'))]
      .map((m) => strip(m[1]))
      .filter(Boolean);

  const titles = pull('title').slice(1, 25);
  const summaries = pull('summary').concat(pull('description')).slice(0, 15);
  const updated = pull('updated').concat(pull('pubDate')).slice(0, 20);
  const links = [...xml.matchAll(/<link[^>]+href="([^"]+)"/gi)].map((m) => m[1]).slice(0, 15);

  const items = titles.map((t, i) =>
    [
      `Title: ${t}`,
      updated[i] ? `Date: ${updated[i]}` : '',
      summaries[i] ? `Summary: ${summaries[i].slice(0, 400)}` : '',
      links[i] ? `Link: ${links[i]}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  );

  return items.join('\n\n').slice(0, 7000);
}

exports.handler = async function () {
  const week = getWeekLabel();

  let feedText = null;
  try {
    const res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'MarketDataNews-RegulatoryMonitor/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    feedText = await res.text();
  } catch (err) {
    console.error('[weekly-regulatory] Failed to fetch SEC EDGAR feed:', err.message);
  }

  const feedContent = feedText
    ? `SEC EDGAR — Recent Filings (week of ${week}):\n\n${extractTextFromXml(feedText)}`
    : `SEC EDGAR feed was unavailable for week of ${week}. Provide a note that data could not be retrieved.`;

  let roundup;
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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: feedContent }],
      }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('[weekly-regulatory] Claude API error:', detail);
      return { statusCode: 502, body: JSON.stringify({ error: 'Claude API error', detail }) };
    }

    const data = await apiRes.json();
    const html = data.content?.[0]?.text ?? '';

    roundup = { week, generatedAt: new Date().toISOString(), html };
  } catch (err) {
    console.error('[weekly-regulatory] Unexpected error calling Claude:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  try {
    const store = getStore('content');
    await store.set('weekly-regulatory', JSON.stringify(roundup));
    console.log('[weekly-regulatory] Roundup saved to Netlify Blobs.');
  } catch (err) {
    console.error('[weekly-regulatory] Failed to save roundup to Blobs:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roundup),
  };
};
