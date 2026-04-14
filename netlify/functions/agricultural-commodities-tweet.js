// agricultural-commodities-tweet.js
// Schedule: '0 21 * * 1-5' (4pm ET weekdays — after CBOT close)
// Tweets CBOT settlements if any commodity moved >1.5%

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

function fmt(n, decimals = 2) {
  if (n == null) return 'N/A';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function getQuote(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0' }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose;
    const changePct = (price && prev && prev !== 0) ? ((price - prev) / prev) * 100 : null;
    return { price, prev, changePct };
  } catch (e) {
    console.error(`[ag-tweet] Failed ${symbol}:`, e.message);
    return { price: null, prev: null, changePct: null };
  }
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    // Only tweet once per day
    const alreadyTweeted = await store.get(`ag-prices-${today}`, { type: 'json' }).catch(() => null);
    if (alreadyTweeted) return { statusCode: 200, body: JSON.stringify({ skipped: 'already tweeted today' }) };

    const [corn, wheat, soybeans] = await Promise.all([
      getQuote('ZC=F'),
      getQuote('ZW=F'),
      getQuote('ZS=F'),
    ]);

    // Only tweet if at least one moved >1.5%
    const anyNotable = [corn, wheat, soybeans].some(q => q.changePct !== null && Math.abs(q.changePct) >= 1.5);
    if (!anyNotable) {
      console.log('[ag-tweet] No notable ag moves — skipping');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no notable moves', corn: corn.changePct, wheat: wheat.changePct, soybeans: soybeans.changePct }) };
    }

    function fmtLine(q, sign = true) {
      if (q.price == null) return 'N/A';
      const pct = q.changePct != null ? ` (${q.changePct >= 0 ? '+' : ''}${fmt(q.changePct)}%)` : '';
      return `${fmt(q.price)}c/bu${pct}`;
    }

    // Context for the biggest mover
    const movers = [
      { name: 'Corn', q: corn }, { name: 'Wheat', q: wheat }, { name: 'Soybeans', q: soybeans }
    ].filter(m => m.q.changePct !== null).sort((a, b) => Math.abs(b.q.changePct) - Math.abs(a.q.changePct));

    let context = '';
    if (movers.length) {
      const top = movers[0];
      if (Math.abs(top.q.changePct) >= 3) {
        context = `${top.name} saw sharp ${top.q.changePct > 0 ? 'gains' : 'losses'} on weather and supply concerns.`;
      } else if (Math.abs(top.q.changePct) >= 1.5) {
        context = `${top.name} the notable mover on weather outlook.`;
      }
    }

    const message = [
      'CBOT settlements:',
      '',
      `Corn: ${fmtLine(corn)}`,
      `Wheat: ${fmtLine(wheat)}`,
      `Soybeans: ${fmtLine(soybeans)}`,
      '',
      context,
      'CME agricultural data: marketdatanews.com/feed-status',
    ].filter(Boolean).join('\n');

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set(`ag-prices-${today}`, JSON.stringify({ corn: corn.price, wheat: wheat.price, soybeans: soybeans.price }));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[ag-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id }) };
  } catch (e) {
    console.error('[ag-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
