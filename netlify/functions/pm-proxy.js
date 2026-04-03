const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 7000);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
    }).on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const results = { poly: [], kalshi: [], errors: [] };

  try {
    const data = await get(
      'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=40&order=volume&ascending=false'
    );
    results.poly = Array.isArray(data) ? data.slice(0, 30) : [];
  } catch(e) {
    results.errors.push('Polymarket: ' + e.message);
  }

  try {
    const data = await get(
      'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=50'
    );
    results.kalshi = Array.isArray(data.markets) ? data.markets.slice(0, 50) : [];
  } catch(e) {
    results.errors.push('Kalshi: ' + e.message);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(results)
  };
};
