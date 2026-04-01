const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const store = getStore({
      name: 'content',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });

    const list = await store.get('waitlist', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(list) ? list : [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: entries.length, entries })
    };
  } catch (err) {
    console.error('[get-waitlist] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to read waitlist' })
    };
  }
};
