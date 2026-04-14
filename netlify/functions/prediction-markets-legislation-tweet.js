// prediction-markets-legislation-tweet.js
// Schedule: '0 15 * * 1-5' (10am ET weekdays)
// Monitors CFTC press releases + Federal Register for prediction market regulatory news

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

const PM_KEYWORDS = ['prediction market', 'event contract', 'kalshi', 'polymarket', '5c(c)', 'binary contract', 'gambling', 'preemption', 'state action'];

function containsPMKeyword(text) {
  const lower = (text || '').toLowerCase();
  return PM_KEYWORDS.some(kw => lower.includes(kw));
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
    console.error(`[pm-leg-tweet] Failed fetch ${url}:`, e.message);
    return null;
  }
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`[pm-leg-tweet] Failed fetch ${url}:`, e.message);
    return null;
  }
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
    items.push({ title: title.trim(), desc: desc.trim(), link: link.trim(), guid: guid.trim() });
  }
  return items;
}

async function callClaude(title, abstract, url) {
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
      system: 'You are a market infrastructure news account. Write a factual tweet under 220 chars about this prediction market regulatory development. No hashtags. No emojis. End with marketdatanews.com/prediction-markets',
      messages: [{ role: 'user', content: `Title: ${title}\nAbstract: ${abstract}\nURL: ${url}` }],
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

    const tweeted = (await store.get('pm-leg-tweeted', { type: 'json' }).catch(() => [])) || [];

    const candidates = [];

    // Source 1: CFTC RSS
    const cftcXml = await fetchText('https://www.cftc.gov/rss/pressreleases.xml');
    if (cftcXml) {
      for (const item of parseRssItems(cftcXml)) {
        if (!tweeted.includes(item.guid) && containsPMKeyword(item.title + ' ' + item.desc)) {
          candidates.push({ ...item, source: 'CFTC' });
        }
      }
    }

    // Source 2: Federal Register CFTC
    const frData = await fetchJson(
      'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=5&order=newest&agencies[]=commodity-futures-trading-commission'
    );
    if (frData?.results) {
      for (const a of frData.results) {
        const id = a.html_url || a.title;
        if (!tweeted.includes(id) && containsPMKeyword(a.title + ' ' + (a.abstract || ''))) {
          candidates.push({ title: a.title, desc: a.abstract || '', link: a.html_url, guid: id, source: 'Federal Register' });
        }
      }
    }

    if (!candidates.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no relevant items' }) };
    }

    const item = candidates[0];
    const message = await callClaude(item.title, item.desc, item.link);
    if (!message) return { statusCode: 200, body: JSON.stringify({ skipped: 'claude returned empty' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    tweeted.unshift(item.guid);
    await store.set('pm-leg-tweeted', JSON.stringify(tweeted.slice(0, 200)));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[pm-leg-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id }) };
  } catch (e) {
    console.error('[pm-leg-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
