// get-premium-content.js
// Auth-gated endpoint. Returns full article including body.
// Checks: (1) valid Supabase access token, (2) active subscription in subscribers table.
// Body is NEVER returned without passing both checks.
//
// GET /.netlify/functions/get-premium-content?slug=<slug>
// Headers: Authorization: Bearer <supabase_access_token>

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: class { constructor() {} close() {} } },
  }
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  // 1. Extract Bearer token from Authorization header.
  //    Netlify normalises header names to lowercase.
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return {
      statusCode: 401,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Authentication required' }),
    };
  }

  // 2. Verify token with Supabase Auth (server-side call — validates the JWT).
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      statusCode: 401,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Invalid or expired session' }),
    };
  }

  // 3. Require active subscription in subscribers table.
  const { data: sub, error: subError } = await supabase
    .from('subscribers')
    .select('subscription_status')
    .eq('email', user.email)
    .maybeSingle();

  if (subError) {
    console.error('[get-premium-content] subscription lookup:', subError.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Subscription check failed' }),
    };
  }

  if (!sub || sub.subscription_status !== 'active') {
    return {
      statusCode: 403,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Active subscription required' }),
    };
  }

  // 4. Fetch article — only published rows.
  const slug = event.queryStringParameters?.slug;

  if (!slug) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'slug parameter required' }),
    };
  }

  const { data: article, error: articleError } = await supabase
    .from('premium_content')
    .select('slug, title, summary, body, category, published_at')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();

  if (articleError) {
    console.error('[get-premium-content] article fetch:', articleError.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Failed to fetch article' }),
    };
  }

  if (!article) {
    return {
      statusCode: 404,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Article not found' }),
    };
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(article) };
};
