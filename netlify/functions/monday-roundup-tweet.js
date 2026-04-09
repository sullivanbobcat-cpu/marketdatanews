// monday-roundup-tweet.js
// Schedule: 0 12 * * 1  (Monday 7am ET = 12:00 UTC)
// Posts top 3 upcoming FeedWatch deadlines within 60 days.

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

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

exports.handler = async function () {
  const stateStore = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 10) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cutoff60 = new Date(todayMidnight.getTime() + 60 * 24 * 60 * 60 * 1000);

    // Filter to real-dated entries within 60 days
    const upcoming = entries
      .filter(e => {
        const dateStr = e.effectiveDate || e.deadline || e.date || '';
        if (!dateStr || /^TBD$/i.test(dateStr) || /Q[1-4]$/i.test(dateStr)) return false;
        const d = new Date(dateStr);
        return !isNaN(d.getTime()) && d >= todayMidnight && d <= cutoff60;
      })
      .map(e => {
        const dateStr = e.effectiveDate || e.deadline || e.date;
        const d = new Date(dateStr);
        const daysLeft = Math.round((d - todayMidnight) / (24 * 60 * 60 * 1000));
        return { ...e, daysLeft };
      })
      .sort((a, b) => {
        const sa = SEVERITY_ORDER[(a.severity || 'LOW').toUpperCase()] ?? 3;
        const sb = SEVERITY_ORDER[(b.severity || 'LOW').toUpperCase()] ?? 3;
        if (sa !== sb) return sa - sb;
        return a.daysLeft - b.daysLeft;
      })
      .slice(0, 3);

    if (upcoming.length < 1) {
      console.log('[monday-roundup] No upcoming deadlines within 60 days');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no upcoming deadlines' }) };
    }

    const lines = upcoming.map((e, i) => {
      const exchange = (e.exchange || 'Market Data').slice(0, 15);
      const titleMax = 45;
      const title = (e.title || '').length > titleMax
        ? e.title.slice(0, titleMax - 2) + '..'
        : (e.title || '');
      return `${i + 1}. ${exchange} — ${title} (${e.daysLeft}d)`;
    });

    const message = `📅 This week in market data infrastructure:\n${lines.join('\n')}\n\nFull deadline calendar:\nmarketdatanews.com/calendar\n#MarketData #MarketStructure`;
    if (message.length > 280) {
      console.warn('[monday-roundup] Tweet too long:', message.length);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'tweet too long' }) };
    }

    const result = await postTweet(message);
    if (!result.success) throw new Error(result.error || 'Post failed');

    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[monday-roundup] Posted. id:', result.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id }) };
  } catch (err) {
    console.error('[monday-roundup] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
