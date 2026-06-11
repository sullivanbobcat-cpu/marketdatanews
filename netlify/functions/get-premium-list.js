// get-premium-list.js
// PUBLIC endpoint — no auth required.
// Returns slug, title, summary, category, published_at for all is_published rows.
// Never returns body. Powers the public intelligence index page.
// GET /.netlify/functions/get-premium-list

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
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const { data, error } = await supabase
    .from('premium_content')
    .select('slug, title, summary, category, published_at')
    .eq('is_published', true)
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[get-premium-list]', error.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Failed to fetch content list' }),
    };
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
};
