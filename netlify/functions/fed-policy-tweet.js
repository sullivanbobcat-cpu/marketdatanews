// fed-policy-tweet.js
// Schedule: '0 14,18 * * 1-5' (9am and 1pm ET weekdays)
// Tweets when Fed rate cut probability shifts more than 5pp on Kalshi

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

async function fetchJson(url, label) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`[fed-policy-tweet] Failed to fetch ${label}:`, e.message);
    return null;
  }
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    // Global daily limit
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) {
      console.log('[fed-policy-tweet] Daily limit reached');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const data = await fetchJson(
      'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=50&series_ticker=kxfeddecision',
      'Kalshi FOMC'
    );
    if (!data || !data.markets || !data.markets.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no data' }) };
    }

    // Find the next upcoming FOMC meeting market (earliest close time)
    const markets = data.markets.filter(m => m.close_time && new Date(m.close_time) > new Date());
    if (!markets.length) return { statusCode: 200, body: JSON.stringify({ skipped: 'no open markets' }) };
    markets.sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
    const market = markets[0];

    const ticker = market.ticker;
    const currentProb = Math.round((market.last_price ?? 0) * 100);
    const meetingDate = market.title || market.subtitle || ticker;

    // Check stored probability
    const blobKey = `fed-prob-${ticker}`;
    const prevData = await store.get(blobKey, { type: 'json' }).catch(() => null);
    const prevProb = prevData?.prob ?? null;

    // Store current
    await store.set(blobKey, JSON.stringify({ prob: currentProb, updatedAt: new Date().toISOString() }));

    if (prevProb === null) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'first run — baseline stored' }) };
    }

    const change = currentProb - prevProb;
    if (Math.abs(change) < 5) {
      console.log(`[fed-policy-tweet] Change only ${change}pp — skipping`);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'change too small', change }) };
    }

    const sign = change > 0 ? '+' : '';
    const message = [
      'Fed rate decision odds shifting:',
      '',
      `${meetingDate}: ${currentProb}% probability of cut`,
      `Change: ${sign}${change}pp since last check`,
      '',
      'Via Kalshi event markets',
      'marketdatanews.com/prediction-markets-live',
    ].join('\n');

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[fed-policy-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, change }) };
  } catch (e) {
    console.error('[fed-policy-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
