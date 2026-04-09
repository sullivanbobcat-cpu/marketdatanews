// get-prediction-market-updates.js
// Returns prediction market tracker entries and comment period status from Blobs.

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const store = getStore({
      name: 'prediction-markets',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const [entries, commentStatus] = await Promise.all([
      store.get('prediction-market-updates', { type: 'json' }).catch(() => []),
      store.get('cftc-comment-status', { type: 'json' }).catch(() => null),
    ]);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        entries: Array.isArray(entries) ? entries : [],
        commentStatus: commentStatus || { open: true, closeDate: '2026-06-10', daysRemaining: 0 },
        count: Array.isArray(entries) ? entries.length : 0,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('[get-pm-updates] Error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message, entries: [], commentStatus: null }),
    };
  }
};
