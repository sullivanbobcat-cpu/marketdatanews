// exchange-outage-tweet.js
// Schedule: '*/10 12-22 * * 1-5' (every 10 min during market hours + extended)
// Monitors exchange status pages and tweets on outages/resolutions

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

const EXCHANGES = [
  { name: 'NYSE',   url: 'https://status.nyse.com/api/v2/status.json' },
  { name: 'Nasdaq', url: 'https://status.nasdaq.com/api/v2/status.json' },
  { name: 'CME',    url: 'https://status.cmegroup.com/api/v2/status.json' },
  { name: 'Cboe',   url: 'https://status.cboe.com/api/v2/status.json' },
  { name: 'DTCC',   url: 'https://status.dtcc.com/api/v2/status.json' },
];

function isOperational(statusData) {
  const desc = (statusData?.status?.description || '').toLowerCase();
  const indicator = (statusData?.status?.indicator || '').toLowerCase();
  return indicator === 'none' || desc.includes('all systems operational') || desc.includes('operational');
}

function getStatusText(statusData) {
  return statusData?.status?.description || statusData?.status?.indicator || 'Unknown status';
}

function etNow() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    const activeIncidents = (await store.get('active-incidents', { type: 'json' }).catch(() => ({}))) || {};
    const now = Date.now();
    const tweets = [];

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    let currentDailyCount = dailyCount;

    for (const exchange of EXCHANGES) {
      try {
        const res = await fetch(exchange.url, {
          headers: { 'User-Agent': 'MarketDataNews/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();

        const operational = isOperational(data);
        const statusText = getStatusText(data);
        const incident = activeIncidents[exchange.name];

        if (!operational && !incident) {
          // New outage detected
          if (currentDailyCount >= 15) break;

          const message = [
            'MARKET INFRASTRUCTURE ALERT',
            '',
            `${exchange.name} reporting: ${statusText}`,
            `Detected: ${etNow()} ET`,
            '',
            'Monitor: marketdatanews.com/feed-status',
          ].join('\n');

          const tweet = await client.v2.tweet(message);
          currentDailyCount++;
          activeIncidents[exchange.name] = { startTime: now, statusText, tweetId: tweet.data.id, lastTweetTime: now };
          tweets.push({ exchange: exchange.name, action: 'outage', id: tweet.data.id });
          console.log(`[outage-tweet] Outage tweet for ${exchange.name}:`, tweet.data.id);

        } else if (!operational && incident) {
          // Existing incident - rate limit to 1 tweet per hour
          const hoursSinceLastTweet = (now - incident.lastTweetTime) / 3600000;
          if (hoursSinceLastTweet >= 1 && currentDailyCount < 15) {
            const message = [
              `${exchange.name} still reporting: ${statusText}`,
              `Ongoing since: ${new Date(incident.startTime).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} ET`,
              '',
              'marketdatanews.com/feed-status',
            ].join('\n');
            const tweet = await client.v2.tweet(message);
            currentDailyCount++;
            activeIncidents[exchange.name].lastTweetTime = now;
            tweets.push({ exchange: exchange.name, action: 'update', id: tweet.data.id });
          }

        } else if (operational && incident) {
          // Resolved
          if (currentDailyCount < 15) {
            const durationMin = Math.round((now - incident.startTime) / 60000);
            const message = [
              `${exchange.name} incident resolved`,
              `Duration: ${durationMin} minute${durationMin !== 1 ? 's' : ''}`,
              '',
              'marketdatanews.com/feed-status',
            ].join('\n');
            const tweet = await client.v2.tweet(message);
            currentDailyCount++;
            delete activeIncidents[exchange.name];
            tweets.push({ exchange: exchange.name, action: 'resolved', id: tweet.data.id });
            console.log(`[outage-tweet] Resolved tweet for ${exchange.name}:`, tweet.data.id);
          }
        }
      } catch (exchangeErr) {
        console.error(`[outage-tweet] Error checking ${exchange.name}:`, exchangeErr.message);
      }
    }

    await store.set('active-incidents', JSON.stringify(activeIncidents));
    if (currentDailyCount > dailyCount) {
      await store.set(`daily-tweet-count-${today}`, JSON.stringify(currentDailyCount));
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, tweets }) };
  } catch (e) {
    console.error('[outage-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
