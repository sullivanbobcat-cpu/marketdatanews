exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  function fetchWithTimeout(url, ms) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms)
    );
    return Promise.race([fetch(url), timeout]);
  }

  const results = { poly: [], kalshi: [], errors: [] };

  try {
    const r = await fetchWithTimeout(
      'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=30&order=volume&ascending=false',
      7000
    );
    const text = await r.text();
    const data = JSON.parse(text);
    results.poly = Array.isArray(data) ? data.slice(0, 30) : [];
  } catch(e) {
    results.errors.push('Polymarket: ' + e.message);
  }

  try {
    const r = await fetchWithTimeout(
      'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=50',
      7000
    );
    const text = await r.text();
    const data = JSON.parse(text);
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
