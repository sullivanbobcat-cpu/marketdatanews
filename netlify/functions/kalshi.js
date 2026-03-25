// netlify/functions/kalshi.js
// Proxies requests to the Kalshi public API to avoid CORS issues
// Usage: /.netlify/functions/kalshi?endpoint=markets&ticker_symbol=FED

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const endpoint = params.endpoint || 'markets';
  
  // Build Kalshi API URL
  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  
  // Remove 'endpoint' from params, pass the rest as query string to Kalshi
  const { endpoint: _, ...rest } = params;
  const qs = new URLSearchParams(rest).toString();
  const url = `${BASE}/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Kalshi API returned ${res.status}` }),
      };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // cache 60 seconds
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
