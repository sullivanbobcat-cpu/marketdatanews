exports.handler = async function(event) {
  const feedUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!feedUrl) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'MarketDataNews/1.0', 'Accept': 'application/rss+xml, text/xml, */*' },
      signal: AbortSignal.timeout(8000),
    });
    const xml = await response.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp('<' + tag + '[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/' + tag + '>', 'i'));
        return m ? m[1].trim() : '';
      };
      const title = get('title');
      if (title.length > 5) {
        items.push({ title, link: get('link') || get('guid'), desc: get('description').replace(/<[^>]+>/g,'').trim(), pubDate: get('pubDate') });
      }
      if (items.length >= 15) break;
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ items }),
    };
  } catch(err) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ items: [], error: err.message }) };
  }
};
