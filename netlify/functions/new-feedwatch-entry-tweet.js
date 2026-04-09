// new-feedwatch-entry-tweet.js
// Schedule: 0 * * * *  (every hour)
// Tweets newly added FeedWatch entries (added in last 2 hours) that haven't been tweeted yet.

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
    if (dailyCount >= 10) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    // Fetch FeedWatch entries
    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    // Load already-tweeted FW entry IDs
    const tweetedIds = (await stateStore.get('tweeted-fw-ids', { type: 'json' }).catch(() => [])) || [];
    const tweetedSet = new Set(Array.isArray(tweetedIds) ? tweetedIds : []);

    // Filter entries added in last 2 hours
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const newEntries = entries.filter(e => {
      if (!e.id || tweetedSet.has(e.id)) return false;
      if (!e.addedAt) return false;
      const added = new Date(e.addedAt);
      return !isNaN(added.getTime()) && added >= cutoff;
    });

    if (!newEntries.length) {
      console.log('[new-feedwatch-entry] No new entries in last 2 hours');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no new entries' }) };
    }

    const posted = [];
    let currentCount = dailyCount;

    for (const entry of newEntries) {
      if (currentCount >= 10) break;
      const exchange = entry.exchange || 'Market Data';
      const tag = exchange.toUpperCase().replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
      const title = (entry.title || '').length > 100
        ? entry.title.slice(0, 97) + '...'
        : (entry.title || '');
      const dateField = entry.effectiveDate || entry.deadline || entry.date || 'TBD';
      const severity = (entry.severity || 'MEDIUM').toUpperCase();

      const message = `NEW on FeedWatch 📋\n${exchange}: ${title}\nSeverity: ${severity} | Effective: ${dateField}\n\nFull calendar: marketdatanews.com/calendar\n#MarketData #${tag} #MarketStructure`;
      if (message.length > 280) {
        console.warn('[new-feedwatch-entry] Tweet too long for entry', entry.id);
        continue;
      }

      const result = await postTweet(message);
      if (result.success) {
        tweetedSet.add(entry.id);
        currentCount++;
        posted.push({ id: result.id, entryId: entry.id });
        console.log('[new-feedwatch-entry] Posted for entry', entry.id);
      } else {
        console.error('[new-feedwatch-entry] Post failed:', result.error);
      }
    }

    if (posted.length) {
      const updatedIds = [...tweetedSet].slice(-1000);
      await stateStore.set('tweeted-fw-ids', JSON.stringify(updatedIds));
      await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(currentCount));
    }

    return { statusCode: 200, body: JSON.stringify({ posted }) };
  } catch (err) {
    console.error('[new-feedwatch-entry] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
