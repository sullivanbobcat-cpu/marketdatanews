// netlify/functions/feedwatch.js
// FeedWatch API - fetches feedwatch.json from static files

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'X-API-Version': '1.0',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Build base URL from request headers
  const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers['host'])) || 'marketdatanews.com';
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const dataUrl = `${proto}://${host}/feedwatch.json`;

  let data;

  // Try fetch first (Node 18+), fall back to https module
  try {
    if (typeof fetch !== 'undefined') {
      const res = await fetch(dataUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${dataUrl}`);
      data = await res.json();
    } else {
      // Fallback: Node https module
      data = await new Promise((resolve, reject) => {
        const https = require('https');
        https.get(dataUrl, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('JSON parse failed: ' + e.message)); }
          });
        }).on('error', reject);
      });
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load data', detail: err.message, tried: dataUrl }),
    };
  }

  let entries = data.entries || [];
  const params = event.queryStringParameters || {};

  if (params.impact) {
    const levels = params.impact.toLowerCase().split(',').map(s => s.trim());
    entries = entries.filter(e => levels.includes(e.impact.toLowerCase()));
  }
  if (params.org) {
    const orgs = params.org.toLowerCase().split(',').map(s => s.trim());
    entries = entries.filter(e => orgs.includes(e.organization.toLowerCase()));
  }
  if (params.category) {
    const cats = params.category.toLowerCase().split(',').map(s => s.trim());
    entries = entries.filter(e => cats.some(c => e.category.toLowerCase().includes(c)));
  }
  if (params.action_required !== undefined) {
    entries = entries.filter(e => e.action_required === (params.action_required === 'true'));
  }
  if (params.region) {
    const regions = params.region.toUpperCase().split(',').map(s => s.trim());
    entries = entries.filter(e => regions.includes(e.region.toUpperCase()));
  }

  // Sort by effective date ascending
  entries.sort((a, b) => {
    const parse = (v) => {
      if (!v) return 9999;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v).getTime();
      const q = v.match(/(\d{4})-Q(\d)/);
      if (q) return new Date(`${q[1]}-${['01','04','07','10'][+q[2]-1]}-01`).getTime();
      return 9999999999999;
    };
    return parse(a.effective_date) - parse(b.effective_date);
  });

  if (params.limit) {
    const n = parseInt(params.limit, 10);
    if (n > 0) entries = entries.slice(0, n);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      version: data.version,
      generated: data.generated,
      total: data.entries.length,
      returned: entries.length,
      filters: Object.keys(params).filter(k => k !== 'limit'),
      entries,
    }, null, 2),
  };
};
