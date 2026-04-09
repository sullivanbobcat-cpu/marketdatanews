// rule-filing-alert-tweet.js
// Schedule: */15 13-21 * * 1-5  (every 15 min, 8am-4pm ET weekdays)
// Fetches new SEC SR- rule filings from Federal Register, scores for market data relevance, tweets new ones.

const { getStore } = require('@netlify/blobs');

const FR_URL = 'https://www.federalregister.gov/api/v1/articles.json' +
  '?fields[]=title&fields[]=publication_date&fields[]=html_url&fields[]=document_number&fields[]=agencies' +
  '&per_page=5&order=newest&agencies[]=securities-and-exchange-commission&conditions[term]=SR-';

const RELEVANCE_KEYWORDS = [
  { word: 'market data', score: 5 },
  { word: 'fee', score: 4 },
  { word: 'connectivity', score: 4 },
  { word: 'co-location', score: 4 },
  { word: 'colocation', score: 4 },
  { word: 'SIP', score: 4 },
  { word: 'NMS', score: 3 },
  { word: 'port', score: 3 },
  { word: 'data feed', score: 4 },
  { word: 'OPRA', score: 5 },
  { word: 'CAT', score: 3 },
  { word: 'UTP', score: 4 },
  { word: 'CTA', score: 4 },
  { word: 'execution quality', score: 3 },
  { word: 'routing', score: 2 },
  { word: 'order', score: 1 },
  { word: 'trading', score: 1 },
];

const EXCHANGE_TAGS = {
  NYSE: 'NYSE', NASDAQ: 'Nasdaq', CBOE: 'Cboe', FINRA: 'FINRA',
  CME: 'CME', MEMX: 'MEMX', MIAX: 'MIAX', IEX: 'IEX', LTSE: 'LTSE',
};

function scoreRelevance(title) {
  const lower = (title || '').toLowerCase();
  return RELEVANCE_KEYWORDS.reduce((sum, { word, score }) =>
    lower.includes(word.toLowerCase()) ? sum + score : sum, 0);
}

function extractExchangeTag(title) {
  const upper = (title || '').toUpperCase();
  for (const [key, tag] of Object.entries(EXCHANGE_TAGS)) {
    if (upper.includes(key)) return tag;
  }
  return 'SECFiling';
}

function extractFileNumber(title) {
  const m = (title || '').match(/SR-[A-Z]+-\d{4}-\d+/i);
  return m ? m[0].toUpperCase() : null;
}

async function postTweet(message) {
  const base = process.env.URL || 'https://marketdatanews.com';
  const res = await fetch(`${base}/.netlify/functions/post-to-twitter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

exports.handler = async function () {
  const stateStore = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    // Daily rate limit
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 10) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    // Per-hour rate limit (max 3/hour for this function)
    const hourKey = `rule-filing-hour-${new Date().toISOString().slice(0, 13)}`;
    const hourCount = (await stateStore.get(hourKey, { type: 'json' }).catch(() => 0)) || 0;
    if (hourCount >= 3) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'hourly limit' }) };
    }

    // Fetch already-tweeted document numbers
    const tweetedFilings = (await stateStore.get('tweeted-filings', { type: 'json' }).catch(() => [])) || [];
    const tweetedSet = new Set(Array.isArray(tweetedFilings) ? tweetedFilings : []);

    // Fetch Federal Register
    const res = await fetch(FR_URL, {
      headers: { 'User-Agent': 'MarketDataNews/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`FR API ${res.status}`);
    const data = await res.json();
    const articles = data.results || [];

    // Filter to last 20 minutes
    const cutoff = new Date(Date.now() - 20 * 60 * 1000);
    const recent = articles.filter(a => {
      if (!a.publication_date) return false;
      // Federal Register dates are YYYY-MM-DD — treat as published today if date is today
      const pub = new Date(a.publication_date + 'T00:00:00Z');
      // Accept anything published today (FR API doesn't provide time)
      return pub >= new Date(today + 'T00:00:00Z');
    });

    // Score and filter
    const candidates = recent
      .filter(a => !tweetedSet.has(a.document_number))
      .map(a => ({ ...a, relevance: scoreRelevance(a.title) }))
      .filter(a => a.relevance >= 3)
      .sort((a, b) => b.relevance - a.relevance);

    if (!candidates.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no new relevant filings' }) };
    }

    const article = candidates[0];
    const fileNum = extractFileNumber(article.title) || 'SR- Filing';
    const tag = extractExchangeTag(article.title);
    const title = (article.title || '').length > 120
      ? article.title.slice(0, 117) + '...'
      : article.title;

    const message = `NEW FILING: ${fileNum}\n${title}\n\nComment period open — full filing:\nmarketdatanews.com/rule-filings\n#MarketData #${tag} #MarketStructure`;
    if (message.length > 280) {
      console.warn('[rule-filing-alert] Tweet too long:', message.length);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'tweet too long' }) };
    }

    const result = await postTweet(message);
    if (!result.success) throw new Error(result.error || 'Post failed');

    // Save tweeted doc number (keep last 500)
    const updated = [...tweetedSet, article.document_number].slice(-500);
    await stateStore.set('tweeted-filings', JSON.stringify(updated));
    await stateStore.set(hourKey, JSON.stringify(hourCount + 1));
    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));

    console.log('[rule-filing-alert] Posted:', fileNum, result.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id, filing: fileNum }) };
  } catch (err) {
    console.error('[rule-filing-alert] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
