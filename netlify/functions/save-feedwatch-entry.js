// save-feedwatch-entry.js
// POST endpoint — validates ADMIN_KEY, saves a new FeedWatch entry to Blobs

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Content-Type': 'application/json',
};

const VALID_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const VALID_CATEGORIES = ['CONNECTIVITY', 'PROTOCOL', 'FEE', 'MILESTONE', 'REGULATORY'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth check
  const adminKey = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { exchange, title, description, effectiveDate, severity, category, link } = body;

  if (!exchange || !title || !description) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'exchange, title, and description are required' }) };
  }

  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const existing = (await store.get('entries', { type: 'json' }).catch(() => [])) || [];

    // Determine next ID
    const maxNum = existing.reduce((max, e) => {
      const num = parseInt((e.id || '').replace('FW-2026-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 38);

    const newId = `FW-2026-${String(maxNum + 1).padStart(3, '0')}`;
    const now = new Date().toISOString();

    const newEntry = {
      id: newId,
      exchange: String(exchange).trim(),
      title: String(title).trim().slice(0, 120),
      description: String(description).trim(),
      effectiveDate: effectiveDate || 'TBD',
      severity: VALID_SEVERITIES.includes(severity) ? severity : 'MEDIUM',
      category: VALID_CATEGORIES.includes(category) ? category : 'REGULATORY',
      link: link ? String(link).trim() : '',
      source: 'manual',
      addedAt: now,
    };

    const updated = [newEntry, ...existing];
    await store.set('entries', JSON.stringify(updated));

    console.log(`[save-feedwatch] Saved ${newId}: ${newEntry.title}`);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, entry: newEntry }),
    };
  } catch (e) {
    console.error('[save-feedwatch] Error:', e.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
