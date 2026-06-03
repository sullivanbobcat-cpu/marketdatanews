// get-subscription.js
// Server-side lookup of a subscriber row using the service-role key.
// Called from account.html after the user is confirmed logged in.
// POST body: { email: "user@example.com" }
// Returns: { subscribed, stripe_customer_id, subscription_status, plan, current_period_end }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { email } = JSON.parse(event.body || '{}');
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'email required' }),
      };
    }

    const { data, error } = await supabase
      .from('subscribers')
      .select('stripe_customer_id, subscription_status, plan, current_period_end')
      .eq('email', email)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ subscribed: false }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        subscribed: data.subscription_status === 'active',
        stripe_customer_id: data.stripe_customer_id,
        subscription_status: data.subscription_status,
        plan: data.plan,
        current_period_end: data.current_period_end,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
