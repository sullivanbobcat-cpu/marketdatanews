const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function storeKey(sessionId) {
  // Sanitize sessionId to safe blob key characters
  return 'contracts-' + String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const sessionId = params.sessionId || 'default';
  const key = storeKey(sessionId);

  const store = getStore({
    name: 'contracts',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get(key, { type: 'json' }).catch(() => []);
      const contracts = Array.isArray(data) ? data : [];
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ contracts }),
      };
    } catch (err) {
      console.error('[contracts GET] Error:', err.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { contract } = body;
    if (!contract || typeof contract !== 'object') {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'contract object required' }) };
    }

    try {
      const existing = await store.get(key, { type: 'json' }).catch(() => []);
      const contracts = Array.isArray(existing) ? existing : [];

      // Assign id if not present
      if (!contract.id) {
        contract.id = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      }
      contract.createdAt = contract.createdAt || new Date().toISOString();

      contracts.push(contract);
      await store.set(key, JSON.stringify(contracts));

      return {
        statusCode: 201,
        headers: CORS,
        body: JSON.stringify({ contract }),
      };
    } catch (err) {
      console.error('[contracts POST] Error:', err.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { id } = body;
    if (!id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id required' }) };
    }

    try {
      const existing = await store.get(key, { type: 'json' }).catch(() => []);
      const contracts = Array.isArray(existing) ? existing : [];
      const filtered = contracts.filter(c => c.id !== id);
      await store.set(key, JSON.stringify(filtered));

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ deleted: id, remaining: filtered.length }),
      };
    } catch (err) {
      console.error('[contracts DELETE] Error:', err.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
