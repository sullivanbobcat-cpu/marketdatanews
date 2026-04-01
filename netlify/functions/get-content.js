// get-content.js
// GET endpoint: returns the latest digest, weekly roundup, and fee alerts as a single JSON response.
// Reads from Netlify Blobs store 'content' — persisted across function invocations.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const store = getStore({
    name: 'content',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  const [feedwatch, regulatory, feeAlerts] = await Promise.all([
    store.get('feedwatch-digest', { type: 'json' }).catch((err) => {
      console.error('[get-content] Failed to read feedwatch-digest:', err.message);
      return null;
    }),
    store.get('weekly-regulatory', { type: 'json' }).catch((err) => {
      console.error('[get-content] Failed to read weekly-regulatory:', err.message);
      return null;
    }),
    store.get('fee-alerts', { type: 'json' }).catch((err) => {
      console.error('[get-content] Failed to read fee-alerts:', err.message);
      return null;
    }),
  ]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify({
      retrievedAt: new Date().toISOString(),
      available: {
        feedwatch: !!feedwatch,
        regulatory: !!regulatory,
        feeAlerts: !!feeAlerts,
      },
      feedwatch: feedwatch ?? { message: 'No digest available yet. Runs daily at 6am ET.' },
      regulatory: regulatory ?? { message: 'No roundup available yet. Runs every Monday at 7am ET.' },
      feeAlerts: feeAlerts ?? { message: 'No fee change alerts on file. Monitor runs daily at 8am ET.' },
    }),
  };
};
