// prediction-markets.js
// Uses native fetch (Node 18+) — same approach as kalshi.js which is proven to work.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const KALSHI_CATEGORIES = ['economics', 'financials', 'politics', 'geopolitics', 'climate'];

// Module-level cache (60 seconds)
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60 * 1000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'marketdatanews.com/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  console.log('[prediction-markets] GET', url, '→', res.status);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

function isGoodKalshiMarket(m) {
  const title = m.title || '';
  const price = m.yes_price_dollars;
  if (title.includes(',')) return false;
  if (title.toLowerCase().startsWith('yes ')) return false;
  if ((m.category || '').toLowerCase() === 'sports') return false;
  if (typeof price !== 'number' || price <= 0.01 || price >= 0.99) return false;
  if (!((m.volume_24h > 0) || (m.open_interest > 0))) return false;
  return true;
}

async function fetchKalshi() {
  const seen = new Set();
  const markets = [];

  // Fetch all category endpoints concurrently; ignore individual failures
  const results = await Promise.all(
    KALSHI_CATEGORIES.map(cat =>
      fetchJson(
        `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=25&category=${cat}`
      ).catch(err => {
        console.error('[prediction-markets] Kalshi category', cat, 'failed:', err.message);
        return null;
      })
    )
  );

  for (const data of results) {
    if (!data || !Array.isArray(data.markets)) continue;
    for (const m of data.markets) {
      const ticker = m.ticker || m.id || '';
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      if (!isGoodKalshiMarket(m)) continue;

      let yesPrice = m.yes_price_dollars;
      // Legacy fallback (integer cents removed Mar 12 2026 but just in case)
      if (typeof yesPrice !== 'number' && typeof m.yes_price === 'number') {
        yesPrice = m.yes_price / 100;
      }

      markets.push({
        source: 'kalshi',
        id: ticker,
        title: m.title || '',
        yesPrice: typeof yesPrice === 'number' ? yesPrice : null,
        volume: m.volume_24h || m.volume || 0,
        volumeDollars: m.dollar_volume_24h || m.dollar_volume || 0,
        expiryDate: m.close_time || m.expiration_time || null,
        category: m.category || '',
        url: 'https://kalshi.com/markets/' + ticker,
      });
    }
  }

  console.log('[prediction-markets] Kalshi markets after filter:', markets.length);
  return markets;
}

function parseOutcomePrices(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const v = parseFloat(arr[0]);
    return isNaN(v) ? null : v;
  } catch { return null; }
}

async function fetchPolymarket() {
  let data;
  try {
    data = await fetchJson(
      'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume&ascending=false'
    );
  } catch (err) {
    console.error('[prediction-markets] Polymarket failed:', err.message);
    return null;
  }

  const markets = Array.isArray(data) ? data : [];
  const filtered = markets
    .filter(m => {
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
        yesPrice,
        volume: parseFloat(m.volume24hr || m.volume || 0),
        volumeDollars: parseFloat(m.volume24hr || m.volume || 0),
        expiryDate: m.endDateIso || m.endDate || null,
        category: m.category || (Array.isArray(m.tags) ? m.tags[0] : '') || '',
        url: m.slug ? 'https://polymarket.com/event/' + m.slug : null,
      };
    });

  console.log('[prediction-markets] Polymarket markets after filter:', filtered.length);
  return filtered;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Serve from cache if fresh
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) {
    return { statusCode: 200, headers: { ...CORS, 'X-Cache': 'HIT' }, body: JSON.stringify(_cache) };
  }

  let kalshiMarkets, polymarkets;
  try {
    [kalshiMarkets, polymarkets] = await Promise.all([fetchKalshi(), fetchPolymarket()]);
  } catch (err) {
    console.error('[prediction-markets] Top-level error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to fetch market data: ' + err.message, markets: [] }),
    };
  }

  const markets = [...(kalshiMarkets || []), ...(polymarkets || [])];

  const result = {
    markets,
    kalshiCount: kalshiMarkets ? kalshiMarkets.length : 0,
    polymarketCount: polymarkets ? polymarkets.length : 0,
    kalshiError: kalshiMarkets === null,
    polymarketError: polymarkets === null,
    fetchedAt: new Date().toISOString(),
  };

  _cache = result;
  _cacheTs = Date.now();

  return { statusCode: 200, headers: { ...CORS, 'X-Cache': 'MISS' }, body: JSON.stringify(result) };
};
