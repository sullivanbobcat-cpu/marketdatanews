const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

const FACTS = [
  'OPRA is the highest-volume market data feed in US markets — regularly exceeding 100 billion messages per day across 96 multicast channels. marketdatanews.com/feed-status #MarketData',
  'There are 8 separate NMS Plans governing US market data infrastructure — CTA, CQ, UTP, OPRA, CAT, LULD, ISRA, and Rule 605. We track all of them: marketdatanews.com/nms #MarketData',
  'CME deprecated 1Gbps support for MDP 3.0 multicast in March 2026. If your feed handler is on 1Gbps you may be losing packets at market open. marketdatanews.com/feed-status #MarketData',
];

exports.handler = async () => {
  try {
    // Shared daily limit
    const stateStore = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 12) {
      console.log('[daily-tweet] Daily limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    // Fetch FeedWatch entries from Netlify Blobs
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const data = await store.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    // Find the next upcoming CRITICAL or HIGH entry within 60 days
    const now = new Date();
    const cutoff = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const upcoming = entries
      .filter(e => {
        if (!['CRITICAL', 'HIGH'].includes((e.severity || '').toUpperCase())) return false;
        if (!e.date) return false;
        const d = new Date(e.date);
        return d >= now && d <= cutoff;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    let message;

    if (upcoming.length > 0) {
      const entry = upcoming[0];
      const daysOut = Math.ceil((new Date(entry.date) - now) / (24 * 60 * 60 * 1000));
      const exchange = (entry.exchange || entry.source || 'MARKET DATA').toUpperCase();
      const title = (entry.title || '').length > 100
        ? (entry.title || '').slice(0, 97) + '...'
        : (entry.title || '');
      const emoji = (entry.severity || '').toUpperCase() === 'CRITICAL' ? '🚨' : '⚠️';

      message = `${emoji} ${exchange} deadline in ${daysOut} day${daysOut === 1 ? '' : 's'}\n\n${title}\n\nFull details + all upcoming deadlines:\nmarketdatanews.com/calendar\n\n#MarketData #MarketStructure #FinTech`;
    } else {
      // Rotate through facts based on ISO week number
      const weekNum = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
      message = FACTS[weekNum % FACTS.length];
    }

    const tweet = await client.v2.tweet(message);
    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[daily-tweet] Posted tweet id:', tweet.data.id);

    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, message }) };
  } catch (e) {
    console.error('[daily-tweet] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
