// portal.js
// Creates a Stripe Billing Portal session so subscribers can manage or cancel.
// POST body: { stripe_customer_id: "cus_xxx" }
// Returns: { url: "https://billing.stripe.com/..." }

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { stripe_customer_id } = JSON.parse(event.body || '{}');
    if (!stripe_customer_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'stripe_customer_id required' }),
      };
    }

    const siteUrl = process.env.SITE_URL || 'https://marketdatanews.com';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripe_customer_id,
      return_url: `${siteUrl}/account`,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: portalSession.url }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
