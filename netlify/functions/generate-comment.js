// generate-comment.js
// POST /.netlify/functions/generate-comment
// Generates a formal SEC comment letter for an SRO rule filing using Claude.
// Body: { filing_title, filing_abstract, document_number, file_number, user_perspective }

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { filing_title, filing_abstract, document_number, file_number, user_perspective } = body;

  if (!filing_title) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'filing_title is required' }) };
  }

  const systemPrompt = `You are an expert market data professional drafting a formal comment letter to the SEC regarding an SRO rule filing.

Write a formal, professional comment letter that:
- Opens with a salutation to the Secretary of the Commission
- Identifies the commenter as a market data professional (use "the undersigned" as placeholder)
- States the filing reference number and title clearly
- Provides substantive, technically grounded comments in exactly 3 paragraphs:
  Paragraph 1: Summary of the filing and its market data implications
  Paragraph 2: Specific technical or operational concerns or support, grounded in market data infrastructure realities
  Paragraph 3: Recommended modifications or endorsement with specific suggestions
- Closes formally with "Respectfully submitted," followed by placeholder lines for name and organization
- Total length: under 300 words
- Tone: formal, precise, expert — not generic

Do NOT include any preamble, explanation, or meta-commentary. Output only the letter itself.`;

  const userPrompt = [
    `Filing: ${filing_title}`,
    file_number ? `File Number: ${file_number}` : '',
    document_number ? `Document Number: ${document_number}` : '',
    filing_abstract ? `\nAbstract:\n${filing_abstract}` : '',
    user_perspective ? `\nMy perspective / specific concerns:\n${user_perspective}` : '',
  ].filter(Boolean).join('\n');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error('[generate-comment] Claude API error:', detail);
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Claude API error', detail }) };
    }

    const data = await apiRes.json();
    const comment = data.content?.[0]?.text ?? '';

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    };
  } catch (err) {
    console.error('[generate-comment] Error:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
