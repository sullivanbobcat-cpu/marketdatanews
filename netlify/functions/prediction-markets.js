const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Module-level cache
let cache = null;
let cacheTs = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

const KALSHI_CATEGORIES = ['economics', 'financials', 'politics', 'geopolitics', 'climate'];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MarketDataNews/1.0',
      },
      timeout: 8000,
    }, (res) => {
      // Treat 404 as empty result rather than error
      if (res.statusCode === 404) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function isValidKalshiPrice(v) {
  return typeof v === 'number' && !isNaN(v) && v >= 0.01 && v <= 0.99;
}

function isQualityKalshiMarket(m) {
  const title = m.title || m.question || '';
  // Filter out multi-outcome markets (comma-separated options in title)
  if (title.includes(',')) return false;
  // Filter out garbled 'yes ...' prefixed titles
  if (title.toLowerCase().startsWith('yes ')) return false;
  // Filter out sports category
  if ((m.category || '').toLowerCase() === 'sports') return false;
  // Require valid price
  const price = m.yes_price_dollars;
  if (!isValidKalshiPrice(price)) return false;
  // Require some trading activity
  if (!((m.volume_24h > 0) || (m.open_interest > 0))) return false;
  return true;
}

function mapKalshiMarket(m) {
  let yesPrice = null;
  if (isValidKalshiPrice(m.yes_price_dollars)) {
    yesPrice = m.yes_price_dollars;
  } else if (typeof m.yes_price === 'number' && m.yes_price > 0) {
    // Legacy fallback: integer cents (e.g. 65 → 0.65)
    yesPrice = m.yes_price / 100;
    if (!isValidKalshiPrice(yesPrice)) yesPrice = null;
  }
  return {
    source: 'kalshi',
    id: m.ticker || m.id || '',
    title: m.title || m.question || '',
    subtitle: m.subtitle || '',
    yesPrice,
    volume: m.volume_24h || m.volume || 0,
    volumeDollars: m.dollar_volume_24h || m.dollar_volume || 0,
    openInterest: m.open_interest || 0,
    expiryDate: m.close_time || m.expiration_time || null,
    category: m.category || '',
    url: m.ticker ? 'https://kalshi.com/markets/' + m.ticker : null,
  };
}

async function fetchKalshi() {
  try {
    // Fetch all category endpoints in parallel; skip 404s gracefully
    const results = await Promise.all(
      KALSHI_CATEGORIES.map(cat =>
        fetchJson(
          `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=25&category=${cat}`
        ).catch(() => null)
      )
    );

    // Combine, deduplicate by ticker, apply quality filter
    const seen = new Set();
    const markets = [];
    for (const data of results) {
      if (!data || !Array.isArray(data.markets)) continue;
      for (const m of data.markets) {
        const ticker = m.ticker || m.id || '';
        if (seen.has(ticker)) continue;
        seen.add(ticker);
        if (isQualityKalshiMarket(m)) {
          markets.push(mapKalshiMarket(m));
        }
      }
    }
    return markets;
  } catch (err) {
    console.error('[prediction-markets] Kalshi error:', err.message);
    return null;
  }
}

function parseOutcomePrices(raw) {
  if (!raw) return null;
  // May be a JSON string: '["0.67","0.33"]' or already an array
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = parseFloat(arr[0]);
  return isNaN(v) ? null : v;
}

async function fetchPolymarket() {
  try {
    const data = await fetchJson(
      'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume&ascending=false'
    );
    const markets = Array.isArray(data) ? data : [];

    return markets
      .filter(m => {
        // Filter to markets with meaningful volume
        const vol = parseFloat(m.volume24hr || m.volume || 0);
        return vol > 1000;
      })
      .map(m => {
        let yesPrice = parseOutcomePrices(m.outcomePrices);
        if (yesPrice === null && typeof m.bestAsk === 'number') yesPrice = m.bestAsk;
        if (yesPrice === null && typeof m.lastTradePrice === 'number') yesPrice = m.lastTradePrice;

        return {
          source: 'polymarket',
          id: m.id || m.conditionId || '',
          title: m.question || m.title || '',
          subtitle: m.description ? String(m.description).slice(0, 120) : '',
          yesPrice,
          volume: parseFloat(m.volume24hr || m.volume || 0),
          volumeDollars: parseFloat(m.volume24hr || m.volume || 0),
          expiryDate: m.endDateIso || m.endDate || null,
          category: m.category || (Array.isArray(m.tags) ? m.tags[0] : '') || '',
          url: m.slug ? 'https://polymarket.com/event/' + m.slug : null,
        };
      });
  } catch (err) {
    console.error('[prediction-markets] Polymarket error:', err.message);
    return null;
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Check module-level cache
  if (cache && Date.now() - cacheTs < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'X-Cache': 'HIT' },
      body: JSON.stringify(cache),
    };
  }

  const [kalshiMarkets, polymarkets] = await Promise.all([fetchKalshi(), fetchPolymarket()]);

  const markets = [
    ...(kalshiMarkets || []),
    ...(polymarkets || []),
  ];

  const result = {
    markets,
    kalshiCount: kalshiMarkets ? kalshiMarkets.length : 0,
    polymarketCount: polymarkets ? polymarkets.length : 0,
    kalshiError: kalshiMarkets === null,
    polymarketError: polymarkets === null,
    fetchedAt: new Date().toISOString(),
  };

  cache = result;
  cacheTs = Date.now();

  return {
    statusCode: 200,
    headers: { ...CORS, 'X-Cache': 'MISS' },
    body: JSON.stringify(result),
  };
};
