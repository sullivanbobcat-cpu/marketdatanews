exports.handler = async (event) => {
  const adminKey = event.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name: 'subscribers',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });
    const { blobs } = await store.list();

    const subscribers = [];
    for (const blob of blobs) {
      const data = await store.get(blob.key);
      if (data) subscribers.push(JSON.parse(data));
    }

    const active = subscribers.filter(s => s.status === 'active');
    const cancelled = subscribers.filter(s => s.status === 'cancelled');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total: subscribers.length,
        active: active.length,
        cancelled: cancelled.length,
        mrr: active.length * 149,
        subscribers
      })
    };
  } catch(e) {
    return { statusCode: 500, body: e.message };
  }
};
