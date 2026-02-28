// netlify/functions/feedwatch.js
// FeedWatch structured data API — fetches data from static feedwatch.json
//
// Endpoints:
//   GET /.netlify/functions/feedwatch
//   GET /.netlify/functions/feedwatch?impact=critical
//   GET /.netlify/functions/feedwatch?impact=high,critical
//   GET /.netlify/functions/feedwatch?org=cme+group
//   GET /.netlify/functions/feedwatch?action_required=true
//   GET /.netlify/functions/feedwatch?region=US
//   GET /.netlify/functions/feedwatch?limit=5
//   GET /.netlify/functions/feedwatch?category=feed+change

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'X-API-Version': '1.0',
    'X-Data-Source': 'FeedWatch by Market Data News',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Determine the base URL from the incoming request host
    const host = event.headers && (event.headers['x-forwarded-host'] || event.headers['host']);
    const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const baseUrl = host ? `${proto}://${host}` : 'https://marketdatanews.com';

    // Fetch the static JSON file from our own domain
    const dataUrl = `${baseUrl}/feedwatch.json`;
    const response = await fetch(dataUrl, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data: HTTP ${response.status}`);
    }

    const data = await response.json();
    let entries = data.entries || [];

    // Parse query params
    const params = event.queryStringParameters || {};

    // Filter: impact level (comma-separated OK)
    if (params.impact) {
      const levels = params.impact.toLowerCase().split(',').map(s => s.trim());
      entries = entries.filter(e => levels.includes(e.impact.toLowerCase()));
    }

    // Filter: organization (comma-separated OK)
    if (params.org) {
      const orgs = params.org.toLowerCase().split(',').map(s => s.trim());
      entries = entries.filter(e => orgs.includes(e.organization.toLowerCase()));
    }

    // Filter: category (partial match, comma-separated OK)
    if (params.category) {
      const cats = params.category.toLowerCase().split(',').map(s => s.trim());
      entries = entries.filter(e => cats.some(c => e.category.toLowerCase().includes(c)));
    }

    // Filter: action_required
    if (params.action_required !== undefined && params.action_required !== null) {
      const ar = params.action_required === 'true';
      entries = entries.filter(e => e.action_required === ar);
    }

    // Filter: region
    if (params.region) {
      const regions = params.region.toUpperCase().split(',').map(s => s.trim());
      entries = entries.filter(e => regions.includes(e.region.toUpperCase()));
    }

    // Sort by effective_date ascending (exact dates first, Q-dates after, TBD last)
    entries = entries.sort((a, b) => {
      const parseDate = (val) => {
        if (!val) return new Date('2099-12-31');
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val);
        const qMatch = val.match(/(\d{4})-Q(\d)/);
        if (qMatch) {
          const qMonths = { '1': '01', '2': '04', '3': '07', '4': '10' };
          return new Date(`${qMatch[1]}-${qMonths[qMatch[2]]}-01`);
        }
        return new Date('2099-12-31');
      };
      return parseDate(a.effective_date) - parseDate(b.effective_date);
    });

    // Limit results
    const limit = params.limit ? parseInt(params.limit, 10) : null;
    const limited = (limit && limit > 0) ? entries.slice(0, limit) : entries;

    const result = {
      version: data.version,
      generated: data.generated,
      total_entries: data.entries.length,
      returned: limited.length,
      filters_applied: Object.keys(params).filter(k => k !== 'limit' && params[k]),
      entries: limited,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result, null, 2),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: err.message,
        hint: 'Make sure feedwatch.json exists in the /files directory',
      }),
    };
  }
};
