// netlify/functions/feedwatch.js
// FeedWatch structured data API
// GET /.netlify/functions/feedwatch
// Query params:
//   ?impact=critical|high|medium|low
//   ?org=cme+group|nasdaq|nyse|finra|sec|cftc
//   ?category=feed+change|port+migration|...
//   ?action_required=true|false
//   ?region=US|EU|UK|APAC
//   ?limit=20 (default: all)
//   ?format=json (only option for now)

const fs = require('fs');
const path = require('path');

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

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Load the feedwatch.json data file
    // In Netlify, the published dir is "files", functions are at project root
    // feedwatch.json should be in the "files" directory (served as static)
    const dataPath = path.join(__dirname, '../../files/feedwatch.json');
    
    let data;
    try {
      const raw = fs.readFileSync(dataPath, 'utf8');
      data = JSON.parse(raw);
    } catch (e) {
      // Fallback: try relative path
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Data file not found', detail: e.message }),
      };
    }

    let entries = data.entries || [];

    // Parse query params
    const params = event.queryStringParameters || {};

    // Filter by impact level
    if (params.impact) {
      const levels = params.impact.toLowerCase().split(',');
      entries = entries.filter(e => levels.includes(e.impact));
    }

    // Filter by organization
    if (params.org) {
      const orgs = params.org.toLowerCase().split(',');
      entries = entries.filter(e => orgs.includes(e.organization.toLowerCase()));
    }

    // Filter by category
    if (params.category) {
      const cats = params.category.toLowerCase().split(',');
      entries = entries.filter(e => cats.some(c => e.category.toLowerCase().includes(c)));
    }

    // Filter by action_required
    if (params.action_required !== undefined) {
      const ar = params.action_required === 'true';
      entries = entries.filter(e => e.action_required === ar);
    }

    // Filter by region
    if (params.region) {
      const regions = params.region.toUpperCase().split(',');
      entries = entries.filter(e => regions.includes(e.region.toUpperCase()));
    }

    // Sort by effective_date ascending (TBD/Q-dates go last)
    entries = entries.sort((a, b) => {
      const dateA = a.effective_date.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(a.effective_date) : new Date('2099-12-31');
      const dateB = b.effective_date.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(b.effective_date) : new Date('2099-12-31');
      return dateA - dateB;
    });

    // Limit
    const limit = params.limit ? parseInt(params.limit, 10) : null;
    if (limit && limit > 0) {
      entries = entries.slice(0, limit);
    }

    const response = {
      version: data.version,
      generated: data.generated,
      total: data.entries.length,
      count: entries.length,
      filters_applied: Object.keys(params).filter(k => k !== 'limit'),
      entries,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response, null, 2),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', detail: err.message }),
    };
  }
};
