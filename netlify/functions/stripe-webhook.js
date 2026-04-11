// To get STRIPE_WEBHOOK_SECRET:
// 1. Go to Stripe Dashboard → Developers → Webhooks
// 2. Add endpoint: https://marketdatanews.com/.netlify/functions/stripe-webhook
// 3. Select events: checkout.session.completed, customer.subscription.deleted
// 4. Copy the webhook signing secret and add to Netlify env vars as STRIPE_WEBHOOK_SECRET

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body, sig, webhookSecret
    );
  } catch(e) {
    return { statusCode: 400, body: 'Webhook error: ' + e.message };
  }

  const { getStore } = require('@netlify/blobs');
  const store = getStore('subscribers');

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const subscriptionId = session.subscription;

    if (email) {
      await store.set(email, JSON.stringify({
        email,
        subscriptionId,
        status: 'active',
        plan: 'pro',
        createdAt: new Date().toISOString(),
        sessionId: session.id
      }));
      console.log('New Pro subscriber:', email);
    }
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    const customerId = subscription.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email;

    if (email) {
      await store.set(email, JSON.stringify({
        email,
        subscriptionId: subscription.id,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
      }));
      console.log('Cancelled subscriber:', email);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
