// prediction-market-pulse-tweet.js
// Schedule: 0 12 * * 1-5  (8am ET weekdays = 12:00 UTC)
// Fetches Kalshi open markets, picks the most uncertain high-volume one, tweets it.

const { getStore } = require('@netlify/blobs');

const KALSHI_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100';

const SPORTS_KEYWORDS = [
  'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball',
  'hockey', 'tennis', 'golf', 'superbowl', 'world cup', 'championship', 'playoff',
  'oscar', 'grammy', 'emmy', 'award', 'celebrity', 'actor', 'movie', 'album',
];

function isSportsOrEntertainment(title) {
  const lower = (title || '').toLowerCase();
  return SPORTS_KEYWORDS.some(kw => lower.includes(kw));
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

    // Load tweeted PM tickers with expiry timestamps
    const tweetedPm = (await stateStore.get('tweeted-pm-ids', { type: 'json' }).catch(() => ({}))) || {};
    const now = Date.now();
    // Prune expired (>7 days old)
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const activePm = Object.fromEntries(
      Object.entries(tweetedPm).filter(([, exp]) => exp > now)
    );

    // Fetch Kalshi markets
    const res = await fetch(KALSHI_URL, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Kalshi API ${res.status}`);
    const data = await res.json();
    const markets = data.markets || [];

    // Filter: 30-70% probability, no commas in title, no sports/entertainment, not already tweeted recently
    const candidates = markets
      .filter(m => {
        const yes = m.yes_price != null ? m.yes_price : (m.last_price != null ? m.last_price : null);
        if (yes == null) return false;
        // Kalshi prices are in cents (0-100) or dollars (0-1) depending on API version
        const prob = yes > 1 ? yes / 100 : yes;
        if (prob < 0.30 || prob > 0.70) return false;
        if (!m.title || m.title.includes(',')) return false;
        if (isSportsOrEntertainment(m.title)) return false;
        if (activePm[m.ticker]) return false;
        return true;
      })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));

    if (!candidates.length) {
      console.log('[pm-pulse] No suitable markets found');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no suitable markets' }) };
    }

    const market = candidates[0];
    const yes = market.yes_price != null ? market.yes_price : market.last_price;
    const prob = yes > 1 ? Math.round(yes) : Math.round(yes * 100);
    const volume = market.volume_24h || market.volume || 0;
    const volFormatted = volume >= 1000000
      ? `$${(volume / 1000000).toFixed(1)}M`
      : volume >= 1000
        ? `$${(volume / 1000).toFixed(0)}K`
        : `$${volume}`;

    const message = `📊 Prediction Market Pulse\n${market.title}\nYES: ${prob}% probability\nVolume: ${volFormatted}\n\nVia Kalshi — full macro dashboard:\nmarketdatanews.com/prediction-markets-live\n#PredictionMarkets #MacroMarkets #Kalshi`;
    if (message.length > 280) {
      console.warn('[pm-pulse] Tweet too long:', message.length);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'tweet too long' }) };
    }

    const result = await postTweet(message);
    if (!result.success) throw new Error(result.error || 'Post failed');

    // Save ticker with 7-day expiry
    activePm[market.ticker] = now + sevenDays;
    await stateStore.set('tweeted-pm-ids', JSON.stringify(activePm));
    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));

    console.log('[pm-pulse] Posted:', market.ticker, 'id:', result.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id, ticker: market.ticker }) };
  } catch (err) {
    console.error('[pm-pulse] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
