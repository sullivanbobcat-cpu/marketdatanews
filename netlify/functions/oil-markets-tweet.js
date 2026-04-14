// oil-markets-tweet.js
// Schedule: '0 14 * * 1-5' (9am ET weekdays)
// Tweets notable Brent crude price moves

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

function fmt(n, decimals = 2) {
  if (n == null) return 'N/A';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=2d', {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose;

    if (!price || !prev) return { statusCode: 200, body: JSON.stringify({ skipped: 'no price data' }) };

    const change = price - prev;
    const changePct = (change / prev) * 100;

    // Only tweet if moved more than $1.50 or is at notable level
    const isNotableMove = Math.abs(change) >= 1.50;
    const isNotableLevel = price >= 100 || price <= 70;

    if (!isNotableMove && !isNotableLevel) {
      console.log(`[oil-tweet] Move only $${fmt(Math.abs(change))} — skipping`);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'not notable', price, change }) };
    }

    // Check last tweeted price
    const lastData = await store.get('last-oil-price', { type: 'json' }).catch(() => null);
    const lastPrice = lastData?.price ?? null;
    if (lastPrice !== null && Math.abs(price - lastPrice) < 1.50 && !isNotableLevel) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'already tweeted similar price' }) };
    }

    const sign = change >= 0 ? '+' : '';
    let context = '';
    if (price >= 100) context = 'Brent above $100 for the first time recently.';
    else if (price <= 70) context = 'Brent at multi-month lows.';
    else if (change <= -1.50) context = 'Crude selling off on demand concerns.';
    else if (change >= 1.50) context = 'Crude rallying on supply tightness.';

    const message = [
      `Brent crude: $${fmt(price)} (${sign}${fmt(changePct)}% today)`,
      '',
      context,
      '',
      'Energy futures data: marketdatanews.com/feed-status',
    ].filter(Boolean).join('\n');

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set('last-oil-price', JSON.stringify({ price, date: today }));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[oil-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, price, change }) };
  } catch (e) {
    console.error('[oil-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
