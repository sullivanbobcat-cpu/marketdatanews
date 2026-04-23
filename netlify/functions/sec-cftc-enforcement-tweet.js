// sec-cftc-enforcement-tweet.js
// Schedule: '0 15,19 * * 1-5' (10am and 2pm ET weekdays)
// Monitors SEC and CFTC RSS for enforcement actions

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

const ENFORCEMENT_KEYWORDS = [
  'fraud', 'manipulation', 'market data', 'insider trading',
  'spoofing', 'wash trading', 'prediction market', 'event contract',
  'registration violation', 'order routing', 'front running', 'pump and dump',
];

function isRelevant(text) {
  const lower = (text || '').toLowerCase();
  return ENFORCEMENT_KEYWORDS.some(kw => lower.includes(kw));
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const guid = (block.match(/<guid[^>]*>(.*?)<\/guid>/) || [])[1] || link;
    items.push({
      title: title.trim(),
      desc: desc.replace(/<[^>]+>/g, '').trim().slice(0, 400),
      link: link.trim(),
      guid: guid.trim(),
    });
  }
  return items;
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(`[enforcement-tweet] Failed ${url}:`, e.message);
    return null;
  }
}

async function callClaude(title, desc, url) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'You are a financial regulation news account. Write a factual tweet under 230 chars about this SEC or CFTC enforcement action. State what happened and the penalty if known. No hashtags. No emojis. No speculation. End with marketdatanews.com/regulation. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.',
      messages: [{ role: 'user', content: `Title: ${title}\nDescription: ${desc}\nURL: ${url}` }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    const tweeted = (await store.get('enforcement-tweeted', { type: 'json' }).catch(() => [])) || [];
    const candidates = [];

    // SEC litigation releases
    const secXml = await fetchText('https://www.sec.gov/rss/litigation/litreleases.xml');
    if (secXml) {
      for (const item of parseRssItems(secXml)) {
        if (!tweeted.includes(item.guid) && isRelevant(item.title + ' ' + item.desc)) {
          candidates.push({ ...item, agency: 'SEC' });
        }
      }
    }

    // CFTC press releases
    const cftcXml = await fetchText('https://www.cftc.gov/rss/pressreleases.xml');
    if (cftcXml) {
      for (const item of parseRssItems(cftcXml)) {
        if (!tweeted.includes(item.guid) && isRelevant(item.title + ' ' + item.desc)) {
          candidates.push({ ...item, agency: 'CFTC' });
        }
      }
    }

    if (!candidates.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no relevant enforcement actions' }) };
    }

    const item = candidates[0];
    const message = await callClaude(item.title, item.desc, item.link);
    if (!message) return { statusCode: 200, body: JSON.stringify({ skipped: 'claude empty' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    tweeted.unshift(item.guid);
    await store.set('enforcement-tweeted', JSON.stringify(tweeted.slice(0, 300)));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[enforcement-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, agency: item.agency }) };
  } catch (e) {
    console.error('[enforcement-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
