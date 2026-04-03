const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 6000);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
    }).on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

const KALSHI_SERIES = [
  'kxfeddecision',
  'kxratecut',
  'kxratecutcount',
  'kxinfl',
  'kxrecession',
  'kxgdp',
  'kxunemployment',
];

const POLY_URLS = [
  'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=15&tag_id=4',
  'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=15&tag_id=6',
  'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=15&tag_id=3',
];

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const results = { kalshi: [], poly: [], errors: [] };

  // Fetch all Kalshi series in parallel
  const kalshiResults = await Promise.allSettled(
    KALSHI_SERIES.map(series =>
      get('https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=10&series_ticker=' + series)
    )
  );
  for (const r of kalshiResults) {
    if (r.status === 'fulfilled') {
      results.kalshi.push(...(r.value.markets || []));
    } else {
      results.errors.push('Kalshi series: ' + r.reason.message);
    }
  }

  // Fetch Polymarket tag endpoints in parallel
  const polyResults = await Promise.allSettled(POLY_URLS.map(url => get(url)));
  for (const r of polyResults) {
    if (r.status === 'fulfilled') {
      results.poly.push(...(Array.isArray(r.value) ? r.value : []));
    } else {
      results.errors.push('Polymarket: ' + r.reason.message);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(results)
  };
};
