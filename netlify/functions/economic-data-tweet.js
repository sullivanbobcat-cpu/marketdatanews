// economic-data-tweet.js
// Schedule: '*/15 12-16 * * 1-5' (every 15 min, 7am-11am ET - when data drops)
// Monitors BLS and Fed press releases for key economic data releases

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

const ECON_KEYWORDS = ['cpi', 'consumer price', 'nonfarm payroll', 'nfp', 'gdp', 'pce', 'unemployment', 'jobs report', 'employment situation', 'personal income', 'producer price', 'ppi', 'retail sales'];

function containsEconKeyword(text) {
  const lower = (text || '').toLowerCase();
  return ECON_KEYWORDS.some(kw => lower.includes(kw));
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
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    items.push({ title: title.trim(), desc: desc.replace(/<[^>]+>/g, '').trim(), link: link.trim(), guid: guid.trim(), pubDate });
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
    console.error(`[econ-tweet] Failed fetch ${url}:`, e.message);
    return null;
  }
}

async function callClaude(title, desc) {
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
      system: 'You are a market data intelligence account. Write a tweet under 230 chars reporting this economic data release. Include the actual number if present and briefly note if it was above or below consensus if mentioned. No hashtags. No emojis. End with marketdatanews.com. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.',
      messages: [{ role: 'user', content: `Title: ${title}\nDescription: ${desc}` }],
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

    const tweeted = (await store.get('econ-data-tweeted', { type: 'json' }).catch(() => [])) || [];
    const candidates = [];

    // BLS
    const blsXml = await fetchText('https://www.bls.gov/rss/latest-releases.xml');
    if (blsXml) {
      for (const item of parseRssItems(blsXml)) {
        if (!tweeted.includes(item.guid) && containsEconKeyword(item.title + ' ' + item.desc)) {
          // Only tweet if published today
          const pubDate = item.pubDate ? new Date(item.pubDate) : null;
          const isToday = pubDate && pubDate.toISOString().split('T')[0] === today;
          if (isToday) candidates.push({ ...item, source: 'BLS' });
        }
      }
    }

    // Fed
    const fedXml = await fetchText('https://www.federalreserve.gov/feeds/press_all.xml');
    if (fedXml) {
      for (const item of parseRssItems(fedXml)) {
        if (!tweeted.includes(item.guid) && containsEconKeyword(item.title + ' ' + item.desc)) {
          const pubDate = item.pubDate ? new Date(item.pubDate) : null;
          const isToday = pubDate && pubDate.toISOString().split('T')[0] === today;
          if (isToday) candidates.push({ ...item, source: 'Fed' });
        }
      }
    }

    if (!candidates.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no new economic releases today' }) };
    }

    const item = candidates[0];
    const message = await callClaude(item.title, item.desc);
    if (!message) return { statusCode: 200, body: JSON.stringify({ skipped: 'claude returned empty' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    tweeted.unshift(item.guid);
    await store.set('econ-data-tweeted', JSON.stringify(tweeted.slice(0, 200)));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[econ-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id }) };
  } catch (e) {
    console.error('[econ-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
