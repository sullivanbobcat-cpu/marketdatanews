const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const data = await store.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    entries.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ count: entries.length, entries }),
    };
  } catch (err) {
    console.error('[get-feedwatch] Error:', err.message);
    return {
      statusCode: 500,
      headers: { ...CORS },
      body: JSON.stringify({ error: 'Failed to load entries' }),
    };
  }
};
