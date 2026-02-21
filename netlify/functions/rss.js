exports.handler = async function(event) {
  const feedUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!feedUrl) return { statusCode: 400, body: JSON.stringify({ error: 'Missing url' }) };

  // List of feeds known to work server-side
  const RELIABLE_FEEDS = [
    'https://feeds.reuters.com/reuters/businessNews',
    'https://feeds.reuters.com/reuters/technologyNews', 
    'https://www.sec.gov/rss/press/pressreleases.rss',
    'https://www.finra.org/rss/newsreleases.xml',
    'https://ir.nasdaq.com/rss/news-releases.xml',
    'https://feeds.feedburner.com/TechCrunchFintech',
    'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
  ];

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketDataNews/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
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
        // Try CDATA first, then plain
        const cdata = block.match(new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i'));
        if (cdata) return cdata[1].trim();
        const plain = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
        return plain ? plain[1].replace(/<[^>]+>/g, '').trim() : '';
      };

      const title = get('title');
      const link  = get('link') || get('guid');
      const desc  = get('description') || get('summary') || '';
      const pubDate = get('pubDate') || get('dc:date') || get('published') || '';

      if (title.length > 5) {
        items.push({ title, link, desc: desc.replace(/<[^>]+>/g,'').slice(0,300), pubDate });
      }
      if (items.length >= 15) break;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({ items, count: items.length }),
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ items: [], error: err.message }),
    };
  }
};
