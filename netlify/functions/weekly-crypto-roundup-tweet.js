// weekly-crypto-roundup-tweet.js
// Schedule: '0 14 * * 0'  (Sunday 9am ET = 14:00 UTC)
// Posts a weekly roundup of the top 5 Kalshi prediction markets by volume.

const { getStore } = require('@netlify/blobs');

const KALSHI_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100';
const DAILY_LIMIT = 12;

function fmtVolume(v) {
  if (!v) return '$0';
  if (v >= 1000000) return `$${(v/1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v/1000).toFixed(0)}K`;
  return `$${v}`;
}

async function postTweet(message) {
  const res = await fetch('https://marketdatanews.com/.netlify/functions/post-to-twitter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

exports.handler = async function () {
  const store = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= DAILY_LIMIT) {
      console.log('[weekly-crypto-roundup] Daily limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit', count: dailyCount }) };
    }

    // Fetch Kalshi markets
    const res = await fetch(KALSHI_URL, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Kalshi API ${res.status}`);
    const data = await res.json();
    const markets = data.markets || [];

    // Filter 20–80% probability, sort by volume descending
    const top5 = markets
      .filter(m => {
        const yes = m.yes_price != null ? m.yes_price : (m.last_price ?? null);
        if (yes == null) return false;
        const prob = yes > 1 ? yes / 100 : yes;
        return prob >= 0.20 && prob <= 0.80;
      })
      .map(m => {
        const yes = m.yes_price != null ? m.yes_price : (m.last_price ?? 0);
        const prob = yes > 1 ? yes / 100 : yes;
        return { ...m, prob, vol: m.volume_24h || m.volume || 0 };
      })
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 5);

    if (!top5.length) {
      console.log('[weekly-crypto-roundup] No eligible markets found');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no eligible markets' }) };
    }

    const marketList = top5.map(m => ({
      title: (m.title || '').length > 45 ? m.title.slice(0, 43) + '..' : m.title,
      probability: `${Math.round(m.prob * 100)}%`,
      volume: fmtVolume(m.vol),
    }));

    // Call Claude to write the roundup tweet
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: 'You are a market intelligence account. Write a weekly prediction market roundup tweet listing the 5 most-traded markets and their current YES probabilities. Format as a numbered list. Keep total under 270 chars. End with marketdatanews.com/prediction-markets-live #PredictionMarkets #MacroMarkets. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.',
        messages: [{ role: 'user', content: `Top 5 Kalshi markets this week:\n${JSON.stringify(marketList, null, 2)}` }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!apiRes.ok) throw new Error(`Claude API ${apiRes.status}`);
    const apiData = await apiRes.json();
    const tweet = (apiData.content?.[0]?.text || '').trim();

    if (!tweet || tweet.length > 280) {
      console.warn('[weekly-crypto-roundup] Tweet too long or empty:', tweet?.length);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'tweet too long or empty', len: tweet?.length }) };
    }

    const result = await postTweet(tweet);
    if (!result.success) throw new Error(result.error || 'Post failed');

    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[weekly-crypto-roundup] Posted. id:', result.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id, tweet }) };
  } catch (err) {
    console.error('[weekly-crypto-roundup] Error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
