const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Email required' })
    };

    const { getStore } = require('@netlify/blobs');
    const store = getStore({
      name: 'subscribers',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN
    });
    const data = await store.get(email);

    if (!data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ subscribed: false })
      };
    }

    const subscriber = JSON.parse(data);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        subscribed: subscriber.status === 'active',
        plan: subscriber.plan,
        status: subscriber.status
      })
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
