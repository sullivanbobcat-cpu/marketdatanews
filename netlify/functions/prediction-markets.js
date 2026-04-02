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

async function fetchKalshi() {
  try {
    const data = await fetchJson(
      'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=50'
    );
    const markets = Array.isArray(data.markets) ? data.markets : [];
    return markets.map(m => ({
      source: 'kalshi',
      id: m.ticker || m.id || '',
      title: m.title || m.question || '',
      subtitle: m.subtitle || '',
      // yes_price_dollars is decimal (0.65 = 65%) — Kalshi removed integer-cent fields Mar 12 2026
      yesPrice: typeof m.yes_price_dollars === 'number' ? m.yes_price_dollars : null,
      volume: m.volume_24h || m.volume || 0,
      volumeDollars: m.dollar_volume_24h || m.dollar_volume || 0,
      expiryDate: m.close_time || m.expiration_time || null,
      category: m.category || '',
      url: m.ticker ? 'https://kalshi.com/markets/' + m.ticker : null,
    }));
  } catch (err) {
    console.error('[prediction-markets] Kalshi error:', err.message);
    return null; // null signals failure
  }
}

async function fetchPolymarket() {
  try {
    const data = await fetchJson(
      'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume&ascending=false'
    );
    const markets = Array.isArray(data) ? data : [];
    return markets.map(m => {
      // Polymarket outcomePrices is an array like ["0.65","0.35"] (YES, NO)
      let yesPrice = null;
      if (Array.isArray(m.outcomePrices) && m.outcomePrices.length > 0) {
        yesPrice = parseFloat(m.outcomePrices[0]);
        if (isNaN(yesPrice)) yesPrice = null;
      } else if (typeof m.lastTradePrice === 'number') {
        yesPrice = m.lastTradePrice;
      }
      return {
        source: 'polymarket',
        id: m.id || m.conditionId || '',
        title: m.question || m.title || '',
        subtitle: m.description ? m.description.slice(0, 120) : '',
        yesPrice,
        volume: m.volume24hr || m.volume || 0,
        volumeDollars: m.volume24hr || m.volume || 0,
        expiryDate: m.endDateIso || m.endDate || null,
        category: m.category || m.tags?.[0] || '',
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

  // Fetch both in parallel
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
