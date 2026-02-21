exports.handler = async function(event) {
  const feedUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!feedUrl) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketDataNews/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const xml = await response.text();
    if (!xml || xml.length < 100) throw new Error('Empty response');

    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const cdata = block.match(new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i'));
        if (cdata) return cdata[1].trim();
        const plain = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
        return plain ? plain[1].replace(/<[^>]+>/g, '').trim() : '';
      };
      const title = get('title');
      if (title.length > 5) {
        items.push({
          title,
          link: get('link') || get('guid'),
          desc: (get('description') || get('summary') || '').replace(/<[^>]+>/g,'').slice(0, 300),
          pubDate: get('pubDate') || get('dc:date') || '',
        });
      }
      if (items.length >= 15) break;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Tell CDN/browser to cache for 10 minutes
        'Cache-Control': 'public, max-age=600, s-maxage=600',
        'Netlify-CDN-Cache-Control': 'public, max-age=600, stale-while-revalidate=300',
      },
      body: JSON.stringify({ items, fetchedAt: Date.now() }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ items: [], error: err.message }),
    };
  }
};
