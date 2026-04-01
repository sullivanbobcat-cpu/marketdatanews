const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let email;
  try {
    const body = JSON.parse(event.body || '{}');
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email || !email.includes('@') || !email.includes('.')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  try {
    const store = getStore({
      name: 'content',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });

    const existing = await store.get('waitlist', { type: 'json' }).catch(() => null);
    const list = Array.isArray(existing) ? existing : [];

    if (list.some(entry => entry.email === email)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "You're already on the waitlist. We'll be in touch." })
      };
    }

    list.push({ email, joinedAt: new Date().toISOString() });
    await store.set('waitlist', JSON.stringify(list));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: "You're on the list. We'll reach out when Professional launches." })
    };
  } catch (err) {
    console.error('[waitlist] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to save. Please try again.' })
    };
  }
};
