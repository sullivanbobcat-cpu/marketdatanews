const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: 'price_1TKpsO0HTCVn1yXVAcMzVubY',
        quantity: 1,
      }],
      customer_email: email || undefined,
      success_url: 'https://marketdatanews.com/pro-success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://marketdatanews.com/subscribe.html',
      metadata: {
        product: 'Market Data News Professional',
        source: 'website'
      },
      subscription_data: {
        metadata: {
          product: 'Market Data News Professional'
        }
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
