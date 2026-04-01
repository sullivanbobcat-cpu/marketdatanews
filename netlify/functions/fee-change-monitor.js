// fee-change-monitor.js
// Scheduled: 0 13 * * *  (8am ET / 13:00 UTC)
// Monitors NYSE pricing PDF and NASDAQ news RSS for market data fee changes via Claude.
// Persists fee-alerts to Netlify Blobs only when changes are detected.

const { getStore } = require('@netlify/blobs');

const SOURCES = [
  {
    name: 'NYSE Market Data Pricing',
    url: 'https://www.nyse.com/publicdocs/nyse/data/NYSE_Market_Data_Pricing.pdf',
    note: 'This is a PDF document. Extract any readable text about fee schedules, pricing tiers, or rate changes.',
  },
  {
    name: 'Nasdaq News Releases',
    url: 'https://ir.nasdaq.com/rss/news-releases.xml',
    note: 'RSS feed of Nasdaq IR news releases.',
  },
];

const SYSTEM_PROMPT =
  'You are a market data fee analyst. Review this content and identify any fee schedule changes, new product pricing, or amendments to existing market data fees. Flag anything that represents a price increase, new fee category, or significant policy change. Output ONLY valid JSON with exactly these fields: { "hasChanges": boolean, "changes": [ { "exchange": string, "product": string, "changeType": string, "description": string, "effectiveDate": string } ], "summary": string }. Do not include any text outside the JSON object.';

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
      const buf = await res.arrayBuffer();
      text = Buffer.from(buf)
        .toString('latin1')
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
        .replace(/\s{3,}/g, '\n')
        .slice(0, 6000);
    } else {
      text = await res.text();
    }
    return { name, text };
  } catch (err) {
    console.error(`[fee-change-monitor] Failed to fetch ${name} (${url}):`, err.message);
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

  const titles = pull('title').slice(1, 20);
  const summaries = pull('description').concat(pull('summary')).slice(0, 10);
  return titles.map((t, i) => `${t}${summaries[i] ? ': ' + summaries[i].slice(0, 300) : ''}`).join('\n').slice(0, 4000);
}

exports.handler = async function () {
  const today = new Date().toISOString().split('T')[0];

  const fetched = await Promise.all(SOURCES.map(fetchSource));

  const contentBlocks = fetched.map(({ name, text }, i) => {
    const note = SOURCES[i].note;
    if (!text) return `=== ${name} ===\n[Source unavailable]`;
    const isXml = text.trimStart().startsWith('<') || text.includes('<?xml');
    const extracted = isXml ? extractTextFromXml(text) : text.slice(0, 4000);
    return `=== ${name} ===\nNote: ${note}\n\n${extracted}`;
  });

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
