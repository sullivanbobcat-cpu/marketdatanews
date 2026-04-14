// cme-volume-tweet.js
// Schedule: '0 22 * * 1-5' (5pm ET weekdays — after market close)
// Tweets notable CME daily volume across asset classes

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

function fmt(n) {
  if (n == null) return 'N/A';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 280,
      system: 'You are a futures market data account. Write a tweet under 220 chars about today notable CME trading volume. Be specific with numbers. No hashtags. No emojis. End with marketdatanews.com/feed-status',
      messages: [{ role: 'user', content: prompt }],
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

    // Check if already tweeted today
    const alreadyTweeted = await store.get(`cme-volume-${today}`, { type: 'json' }).catch(() => null);
    if (alreadyTweeted) return { statusCode: 200, body: JSON.stringify({ skipped: 'already tweeted today' }) };

    const res = await fetch('https://www.cmegroup.com/CmeWS/mvc/Volume/TotalVolume?assetClassId=all&periodType=daily', {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`CME HTTP ${res.status}`);
    const data = await res.json();

    if (!data || !Array.isArray(data)) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'unexpected CME response format' }) };
    }

    // Aggregate by asset class
    let agVol = 0, equityVol = 0, cryptoVol = 0, cryptoPrevVol = 0;
    const AG_PRODUCTS = ['ZC', 'ZW', 'ZS', 'ZL', 'ZM', 'ZO', 'ZR'];
    const EQUITY_PRODUCTS = ['ES', 'NQ', 'RTY', 'YM', 'MES', 'MNQ'];
    const CRYPTO_PRODUCTS = ['BTC', 'ETH', 'MBT', 'MET'];

    for (const row of data) {
      const sym = (row.productCode || row.symbol || '').toUpperCase();
      const vol = Number(row.totalVolume || row.volume || 0);
      const prevVol = Number(row.priorDayVolume || row.prevVolume || 0);
      if (AG_PRODUCTS.some(p => sym.startsWith(p))) agVol += vol;
      if (EQUITY_PRODUCTS.some(p => sym === p)) equityVol += vol;
      if (CRYPTO_PRODUCTS.some(p => sym.startsWith(p))) { cryptoVol += vol; cryptoPrevVol += prevVol; }
    }

    const notable = [];
    if (agVol > 500000) notable.push(`Agricultural: ${fmt(agVol)} contracts`);
    if (equityVol > 2000000) notable.push(`Equity index (ES/NQ): ${fmt(equityVol)} contracts`);
    if (cryptoPrevVol > 0 && cryptoVol / cryptoPrevVol > 1.20) {
      notable.push(`Crypto futures: ${fmt(cryptoVol)} contracts (+${Math.round((cryptoVol / cryptoPrevVol - 1) * 100)}% vs prior day)`);
    }

    if (!notable.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no notable volume', agVol, equityVol, cryptoVol }) };
    }

    const prompt = `Today's notable CME volume:\n${notable.join('\n')}\n\nDate: ${today}`;
    const message = await callClaude(prompt);
    if (!message) return { statusCode: 200, body: JSON.stringify({ skipped: 'claude empty' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set(`cme-volume-${today}`, JSON.stringify({ tweeted: true, notable }));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[cme-volume-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id }) };
  } catch (e) {
    console.error('[cme-volume-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
