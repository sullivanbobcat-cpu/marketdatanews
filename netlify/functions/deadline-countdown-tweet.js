// deadline-countdown-tweet.js
// Schedule: 0 13 * * *  (8am ET daily)
// Posts countdown tweets for CRITICAL/HIGH FeedWatch entries at 30, 14, 7, or 1 days out.

const { getStore } = require('@netlify/blobs');
const { Anthropic } = require('@anthropic-ai/sdk');

async function generateWhyItMatters(title, description) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    system: 'You are a market data infrastructure expert. Write one sentence (max 100 characters) explaining what happens if a firm misses this deadline. Be specific and direct. No em dashes. No jargon. Start with a verb.',
    messages: [{ role: 'user', content: `${title}\n\n${description || ''}` }],
  });
  return (msg.content[0]?.text || '').trim().replace(/\n/g, ' ');
}

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

      const exchange = (entry.exchange || 'Market Data').toUpperCase();
      const title = (entry.title || '').length > 80
        ? entry.title.slice(0, 77) + '...'
        : entry.title;

      let whyLine = '';
      try {
        whyLine = await generateWhyItMatters(entry.title, entry.description || entry.body || '');
        // Trim to 100 chars if Claude ran long
        if (whyLine.length > 100) whyLine = whyLine.slice(0, 97) + '...';
      } catch (err) {
        console.warn('[deadline-countdown] Claude call failed:', err.message);
        whyLine = 'Firms missing this deadline face connectivity or compliance disruptions.';
      }

      const message = `${exchange} deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}:\n\n${title}\n\nWhy it matters: ${whyLine}\n\nmarketdatanews.com/calendar`;

      if (message.length > 280) {
        console.warn('[deadline-countdown] Tweet too long (' + message.length + ' chars), truncating why line');
        const overhead = message.length - whyLine.length;
        const maxWhy = 280 - overhead - 3;
        const trimmedWhy = maxWhy > 20 ? whyLine.slice(0, maxWhy) + '...' : whyLine.slice(0, 50) + '...';
        const fallback = `${exchange} deadline in ${daysLeft} day${daysLeft === 1 ? '' : 's'}:\n\n${title}\n\nWhy it matters: ${trimmedWhy}\n\nmarketdatanews.com/calendar`;
        if (fallback.length > 280) {
          console.warn('[deadline-countdown] Still too long after trim, skipping:', fallback.length);
          continue;
        }
        const result = await postTweet(fallback);
        if (result.success) {
          await incrementDailyCount(stateStore);
          posted.push({ daysLeft, id: result.id });
          console.log('[deadline-countdown] Posted (trimmed)', daysLeft, 'day warning for', entry.title);
        }
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
