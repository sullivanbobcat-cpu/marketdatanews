// deadline-countdown-tweet.js
// Schedule: 0 13 * * *  (8am ET daily)
// Posts countdown tweets for CRITICAL/HIGH FeedWatch entries at 30, 14, 7, or 1 days out.

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

async function getDailyCount(store) {
  const today = new Date().toISOString().split('T')[0];
  return (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
}

async function incrementDailyCount(store) {
  const today = new Date().toISOString().split('T')[0];
  const count = await getDailyCount(store);
  await store.set(`daily-tweet-count-${today}`, JSON.stringify(count + 1));
}

exports.handler = async function () {
  const stateStore = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    const dailyCount = await getDailyCount(stateStore);
    if (dailyCount >= 12) {
      console.log('[deadline-countdown] Daily tweet limit reached');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    const MILESTONE_DAYS = [30, 14, 7, 1];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const matches = [];
    for (const e of entries) {
      if (!['CRITICAL', 'HIGH'].includes((e.severity || '').toUpperCase())) continue;
      const dateStr = e.effectiveDate || e.deadline || e.date || '';
      // Skip Q-dates and TBD - can't calculate exact days
      if (!dateStr || /^TBD$/i.test(dateStr) || /Q[1-4]$/i.test(dateStr)) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      const daysLeft = Math.round((d - today) / (24 * 60 * 60 * 1000));
      if (MILESTONE_DAYS.includes(daysLeft)) {
        matches.push({ entry: e, daysLeft });
      }
    }

    if (!matches.length) {
      console.log('[deadline-countdown] No milestone deadlines today');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no milestones' }) };
    }

    const posted = [];
    for (const { entry, daysLeft } of matches) {
      if (await getDailyCount(stateStore) >= 12) break;
      const exchange = (entry.exchange || 'MARKET DATA').toUpperCase().replace(/\s+/g, '');
      const title = (entry.title || '').length > 100
        ? entry.title.slice(0, 97) + '...'
        : entry.title;
      const tag = exchange.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      const message = `⚠️ ${daysLeft} DAY WARNING\n${entry.exchange || 'Market Data'} deadline approaching:\n${title}\n\nDetails + all upcoming deadlines:\nmarketdatanews.com/calendar\n#MarketData #MarketStructure #${tag}`;
      if (message.length > 280) {
        console.warn('[deadline-countdown] Tweet too long, skipping:', message.length);
        continue;
      }
      const result = await postTweet(message);
      if (result.success) {
        await incrementDailyCount(stateStore);
        posted.push({ daysLeft, id: result.id });
        console.log('[deadline-countdown] Posted', daysLeft, 'day warning for', entry.title);
      } else {
        console.error('[deadline-countdown] Post failed:', result.error);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ posted }) };
  } catch (err) {
    console.error('[deadline-countdown] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
