const https = require('https');
const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 8000);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

async function getQuote(symbol) {
  try {
    const data = await fetchJSON(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
    );
    const result = data?.chart?.result?.[0];
    const meta   = result?.meta;
    const price  = meta?.regularMarketPrice ?? meta?.chartPreviousClose;
    const prev   = meta?.chartPreviousClose ?? meta?.previousClose;
    const change = (price != null && prev != null && prev !== 0)
      ? ((price - prev) / prev) * 100
      : null;
    return { price, change };
  } catch (e) {
    console.error(`[market-snapshot] Failed to fetch ${symbol}:`, e.message);
    return { price: null, change: null };
  }
}

function fmt(n, decimals = 2) {
  if (n == null) return 'N/A';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChange(c) {
  if (c == null) return '';
  return ` (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)`;
}

exports.handler = async () => {
  try {
    // Shared daily limit
    const stateStore = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 12) {
      console.log('[market-snapshot] Daily limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const [sp, yield10, vix, gold, oil] = await Promise.all([
      getQuote('^GSPC'),   // S&P 500
      getQuote('^TNX'),    // 10-Year Treasury yield
      getQuote('^VIX'),    // VIX
      getQuote('GC=F'),    // Gold futures
      getQuote('CL=F'),    // WTI Crude futures
    ]);

    const message = [
      'Morning market snapshot:',
      `S&P 500: ${fmt(sp.price, 0)}${fmtChange(sp.change)}`,
      `10Y Yield: ${fmt(yield10.price, 3)}%`,
      `VIX: ${fmt(vix.price)}`,
      `Gold: $${fmt(gold.price, 0)}`,
      `Oil: $${fmt(oil.price)}`,
      '',
      'marketdatanews.com',
    ].join('\n');

    if (message.length > 280) {
      throw new Error(`Tweet too long: ${message.length} chars`);
    }

    const client = new TwitterApi({
      appKey:       process.env.TWITTER_API_KEY,
      appSecret:    process.env.TWITTER_API_SECRET,
      accessToken:  process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[market-snapshot] Tweeted id:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id, message }) };
  } catch (e) {
    console.error('[market-snapshot] Error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
