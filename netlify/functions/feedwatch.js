// netlify/functions/feedwatch.js
const fs = require('fs');
const path = require('path');

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

  // In Netlify, the publish directory ("files") is available at process.cwd()
  // The function lives at netlify/functions/feedwatch.js
  // So feedwatch.json (in /files/) is at ../../feedwatch.json relative to this file,
  // OR at path.join(process.cwd(), 'feedwatch.json') since cwd = publish dir at runtime

  let data;
  const attempts = [];

  const tryPaths = [
    path.join(process.cwd(), 'feedwatch.json'),
    path.join(__dirname, '../../files/feedwatch.json'),
    path.join(__dirname, '../../../files/feedwatch.json'),
    '/opt/build/repo/files/feedwatch.json',
  ];

  for (const p of tryPaths) {
    attempts.push(p);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      data = JSON.parse(raw);
      break;
    } catch (e) {
      // try next
    }
  }

  if (!data) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'feedwatch.json not found',
        tried: attempts,
        cwd: process.cwd(),
        dirname: __dirname,
      }),
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

  entries.sort((a, b) => {
    const parse = (v) => {
      if (!v) return 9999999999999;
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
