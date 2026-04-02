const { getStore } = require('@netlify/blobs');
const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function callClaude(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse Claude response'));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { message, history = [] } = body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Message is required' }) };
  }

  try {
    // Fetch current FeedWatch entries from Blobs
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const data = await store.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    // Build system prompt with entries
    const entriesJson = JSON.stringify(entries.slice(0, 50), null, 2); // cap at 50 entries
    const systemPrompt = `You are FeedWatch, an expert AI assistant for market data infrastructure professionals. You have deep knowledge of exchange connectivity, NMS plans, SIP feeds, market data fees, regulatory requirements, and the following current FeedWatch calendar entries: ${entriesJson}

Answer questions concisely and accurately. Focus on practical implications for market data engineers, connectivity teams, and compliance professionals. If asked about something not in your knowledge base, say so clearly. Always cite specific effective dates and reference numbers when available. Keep responses focused and well-structured — use short paragraphs or bullet points when listing multiple items. Do not use markdown headers. Today's date is ${new Date().toISOString().split('T')[0]}.`;

    // Build messages array — keep last 10 messages for context
    const conversationHistory = (Array.isArray(history) ? history : []).slice(-10);
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message.trim() },
    ];

    const claudeResponse = await callClaude(systemPrompt, messages);

    if (claudeResponse.error) {
      console.error('[ask-feedwatch] Claude API error:', claudeResponse.error);
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'FeedWatch is temporarily unavailable. Please try again.' }),
      };
    }

    const reply = claudeResponse.content?.[0]?.text || 'No response received.';

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('[ask-feedwatch] Error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'FeedWatch is temporarily unavailable. Please try again.' }),
    };
  }
};
