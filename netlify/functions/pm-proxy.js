exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60'
  };

  const results = { poly: [], kalshi: [], error: null };

  // Fetch Polymarket — use events endpoint which has cleaner titles
  try {
    const r = await fetch(
      'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=50&order=volume&ascending=false',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await r.json();
    results.poly = (Array.isArray(data) ? data : []).slice(0, 50);
  } catch(e) {
    results.error = 'Polymarket: ' + e.message;
  }

  // Fetch Kalshi
  try {
    const r = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await r.json();
    results.kalshi = (data.markets || []).slice(0, 100);
  } catch(e) {
    results.error = (results.error ? results.error + ' | ' : '') + 'Kalshi: ' + e.message;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(results)
  };
};
