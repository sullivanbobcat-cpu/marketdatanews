exports.handler = async function(event) {
  const feedUrl = event.queryStringParameters && event.queryStringParameters.url;

  if (!feedUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing url parameter' }) };
  }

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'MarketDataNews RSS Reader/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error('Feed returned HTTP ' + response.status);
    }

    const xml = await response.text();

    // Parse XML into items
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
      const link  = get('link') || get('guid');
      const desc  = get('description').replace(/<[^>]+>/g, '').trim();
      const pubDate = get('pubDate') || get('dc:date') || '';
      if (title.length > 5) {
        items.push({ title, link, desc, pubDate });
      }
      if (items.length >= 15) break;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // cache 5 mins
      },
      body: JSON.stringify({ items }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ items: [], error: err.message }),
    };
  }
};
