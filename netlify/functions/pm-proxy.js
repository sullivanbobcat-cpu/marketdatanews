// pm-proxy.js
// Aggregates Kalshi market data for the live prediction markets page.
// Returns: { kalshi: [...], debug_tickers: [...], errors: [...] }
// GET /.netlify/functions/pm-proxy

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
};

async function fetchWithTimeout(url, timeoutMs) {
  return fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'MarketDataNews/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  const results = { kalshi: [], errors: [] };

  // General open markets fetch
  try {
    const r = await fetchWithTimeout(
      `${BASE}/markets?status=open&limit=20`,
      6000
    );
    const data = await r.json();
    if (data.markets && data.markets.length) {
      results.kalshi.push(...data.markets);
    }
  } catch (e) {
    results.errors.push('General markets: ' + e.message);
  }

  // Targeted fetches for specific series — must be uppercase (API is case-sensitive)
  const specificSeries = [
    'KXCRYPTOSTRUCTURE',
    'KXNYSECIRCUIT',
    'KXSECQUARTERLY',
  ];

  for (const series of specificSeries) {
    try {
      const r = await fetchWithTimeout(
        `${BASE}/markets?status=open&limit=5&series_ticker=${series}`,
        6000
      );
      const text = await r.text();
      const data = JSON.parse(text);
      if (data.markets && data.markets.length) {
        results.kalshi.push(...data.markets);
      }
    } catch (e) {
      results.errors.push('Series ' + series + ': ' + e.message);
    }
  }

  // Dedupe by ticker
  const seen = new Set();
  results.kalshi = results.kalshi.filter(m => {
    if (!m.ticker || seen.has(m.ticker)) return false;
    seen.add(m.ticker);
    return true;
  });

  results.debug_tickers = results.kalshi.map(m => m.ticker).slice(0, 20);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(results),
  };
};
