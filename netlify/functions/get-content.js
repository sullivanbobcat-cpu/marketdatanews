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

  // Cache-busting: flag the digest as stale if its date doesn't match today.
  // The frontend will trigger ?refresh=true regeneration when it sees stale=true.
  const today = new Date().toISOString().split('T')[0];
  const digestStale = !feedwatch || !feedwatch.date || feedwatch.date !== today;

  const feedwatchOut = feedwatch
    ? { ...feedwatch, stale: digestStale }
    : { message: 'No digest available yet. Runs daily at 6am ET.', stale: true };

  // Don't let CDN cache a stale response — let the browser always re-check.
  const cacheControl = digestStale ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
    },
    body: JSON.stringify({
      retrievedAt: new Date().toISOString(),
      available: {
        feedwatch: !!feedwatch,
        regulatory: !!regulatory,
        feeAlerts: !!feeAlerts,
      },
      feedwatch: feedwatchOut,
      regulatory: regulatory ?? { message: 'No roundup available yet. Runs every Monday at 7am ET.' },
      feeAlerts: feeAlerts ?? { message: 'No fee change alerts on file. Monitor runs daily at 8am ET.' },
    }),
  };
};
