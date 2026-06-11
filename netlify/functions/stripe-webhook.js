// stripe-webhook.js
// Verifies Stripe signature, then upserts subscriber rows in Supabase.
// Handles: checkout.session.completed, customer.subscription.updated,
//          customer.subscription.deleted
//
// Setup:
//   1. Stripe Dashboard → Developers → Webhooks → Add endpoint:
//      https://marketdatanews.com/.netlify/functions/stripe-webhook
//   2. Select events: checkout.session.completed,
//      customer.subscription.updated, customer.subscription.deleted
//   3. Copy the signing secret → Netlify env var: STRIPE_WEBHOOK_SECRET

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: class { constructor() {} close() {} } },
  }
);

exports.handler = async (event) => {
  // Stripe requires the raw body string for signature verification.
  // Netlify Functions pass event.body as a raw string — no transformation needed.
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Stripe signature verification failed:', e.message);
    return { statusCode: 400, body: 'Webhook error: ' + e.message };
  }

  const { type, data } = stripeEvent;
  console.log('Stripe event received:', type);

  try {
    if (type === 'checkout.session.completed') {
      const session = data.object;
      const email = session.customer_email || session.customer_details?.email;
      const customerId = session.customer;

      // Fetch subscription for period end
      const subscription = await stripe.subscriptions.retrieve(session.subscription);

      await upsertSubscriber({
        email,
        stripe_customer_id: customerId,
        subscription_status: 'active',
        current_period_end: subscription.current_period_end,
      });

    } else if (type === 'customer.subscription.updated') {
      const subscription = data.object;
      const customer = await stripe.customers.retrieve(subscription.customer);

      await upsertSubscriber({
        email: customer.email,
        stripe_customer_id: subscription.customer,
        subscription_status: subscription.status,
        current_period_end: subscription.current_period_end,
      });

    } else if (type === 'customer.subscription.deleted') {
      const subscription = data.object;
      const customer = await stripe.customers.retrieve(subscription.customer);

      await upsertSubscriber({
        email: customer.email,
        stripe_customer_id: subscription.customer,
        subscription_status: 'cancelled',
        current_period_end: subscription.current_period_end,
      });
    }
  } catch (e) {
    console.error('Supabase upsert failed:', e.message);
    // Return 200 so Stripe does not retry — log the error for investigation
    return {
      statusCode: 200,
      body: JSON.stringify({ received: true, warning: e.message }),
    };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function upsertSubscriber({ email, stripe_customer_id, subscription_status, current_period_end }) {
  if (!email) {
    console.error('upsertSubscriber called with no email — skipping');
    return;
  }

  const { error } = await supabase.from('subscribers').upsert(
    {
      email,
      stripe_customer_id,
      subscription_status,
      plan: 'founding_team',
      current_period_end: new Date(current_period_end * 1000).toISOString(),
    },
    { onConflict: 'email' }
  );

  if (error) throw new Error(error.message);
  console.log(`Subscriber upserted: ${email} → ${subscription_status}`);
}
