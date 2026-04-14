// treasury-yield-tweet.js
// Schedule: '0 14,17,20 * * 1-5' (9am, 12pm, 3pm ET weekdays)
// Tweets notable 10Y Treasury yield moves (>8 basis points)

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

function fmt(n, decimals = 3) {
  if (n == null) return 'N/A';
  return Number(n).toFixed(decimals);
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=5m&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const currentYield = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose;

    if (!currentYield || !prevClose) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no yield data' }) };
    }

    const bpsFromClose = Math.round((currentYield - prevClose) * 100);

    // Check last tweeted level
    const lastData = await store.get('last-yield-tweet', { type: 'json' }).catch(() => null);
    const lastYield = lastData?.yield ?? null;
    const bpsFromLastTweet = lastYield !== null ? Math.round((currentYield - lastYield) * 100) : null;

    // Only tweet if >8bps from prior close OR >8bps from last tweet
    const triggerFromClose = Math.abs(bpsFromClose) >= 8;
    const triggerFromLastTweet = bpsFromLastTweet !== null && Math.abs(bpsFromLastTweet) >= 8;

    if (!triggerFromClose && !triggerFromLastTweet) {
      console.log(`[yield-tweet] Only ${bpsFromClose}bps from close, ${bpsFromLastTweet}bps from last tweet — skipping`);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'move too small', bpsFromClose, bpsFromLastTweet }) };
    }

    const refBps = triggerFromClose ? bpsFromClose : bpsFromLastTweet;
    const refLabel = triggerFromClose ? 'today' : 'from last update';
    const sign = refBps > 0 ? '+' : '';

    let context = '';
    if (currentYield > 5.0) context = 'Yield at multi-year high levels.';
    else if (currentYield < 3.5) context = 'Yield at multi-month lows.';
    else if (bpsFromClose >= 10) context = 'Sharp move higher following market open.';
    else if (bpsFromClose <= -10) context = 'Sharp rally in Treasuries.';

    const message = [
      `10Y Treasury yield: ${fmt(currentYield)}%`,
      `Move: ${sign}${refBps} basis points ${refLabel}`,
      '',
      context,
      'marketdatanews.com',
    ].filter(Boolean).join('\n');

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set('last-yield-tweet', JSON.stringify({ yield: currentYield, date: today, bpsFromClose }));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[yield-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, currentYield, bpsFromClose }) };
  } catch (e) {
    console.error('[yield-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
