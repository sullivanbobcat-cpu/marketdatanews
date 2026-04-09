// monthly-stats-tweet.js
// Schedule: 0 13 1 * *  (1st of month at 8am ET)
// Posts monthly stats update with live FeedWatch count.

const { getStore } = require('@netlify/blobs');

async function postTweet(message) {
  const base = process.env.URL || 'https://marketdatanews.com';
  const res = await fetch(`${base}/.netlify/functions/post-to-twitter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

exports.handler = async function () {
  const stateStore = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 12) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    // Fetch live FeedWatch entry count
    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];
    const entryCount = entries.length;

    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const message = `Market Data News — ${month} update:\n📡 45 feeds monitored\n📋 ${entryCount} FeedWatch entries active\n🏛️ 60+ exchanges tracked\n📜 8 NMS plans covered\n\nFree intelligence for market data professionals:\nmarketdatanews.com\n#MarketData #MarketStructure #FinTech`;
    if (message.length > 280) {
      console.warn('[monthly-stats] Tweet too long:', message.length);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'tweet too long' }) };
    }

    const result = await postTweet(message);
    if (!result.success) throw new Error(result.error || 'Post failed');

    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[monthly-stats] Posted. id:', result.id, 'entries:', entryCount);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id, entryCount }) };
  } catch (err) {
    console.error('[monthly-stats] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
