// crypto-pm-tweet.js
// Schedule: '0 13,16,19 * * 1-5'  (8am, 11am, 2pm ET on weekdays)
// 13 UTC = 8am ET  → prediction market Kalshi tweet
// 16 UTC = 11am ET → crypto/CFTC news tweet
// 19 UTC = 2pm ET  → best available

const { getStore } = require('@netlify/blobs');

const KALSHI_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=100';
const FR_CFTC_URL = 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=html_url&per_page=5&order=newest&agencies[]=commodity-futures-trading-commission';
const COINDESK_RSS_URL = 'https://www.coindesk.com/arc/outboundfeeds/rss/';

const KALSHI_KEYWORDS = [
  'bitcoin', 'btc', 'eth', 'ethereum', 'crypto', 'fed rate', 'inflation',
  'recession', 'oil', 'gold', 'sp500', 's&p', 'nasdaq', 'dow', 'tariff',
  'china', 'iran', 'war', 'interest rate', 'cpi', 'gdp', 'treasury',
];

const NEWS_RELEVANCE_KEYWORDS = [
  { w: 'prediction market', s: 6 }, { w: 'event contract', s: 6 },
  { w: 'CFTC', s: 5 }, { w: 'kalshi', s: 5 }, { w: 'polymarket', s: 5 },
  { w: 'crypto regulation', s: 5 }, { w: 'bitcoin etf', s: 4 },
  { w: 'sec crypto', s: 4 }, { w: 'stablecoin', s: 4 },
  { w: 'bitcoin', s: 3 }, { w: 'ethereum', s: 3 }, { w: 'crypto', s: 2 },
  { w: 'blockchain', s: 1 }, { w: 'defi', s: 1 },
];

const DAILY_LIMIT = 12;
const DEDUP_DAYS = 14;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MarketDataNews/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MarketDataNews/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function parseRssItems(xml) {
  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
  const pull = (tag, src) => [...src.matchAll(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'gi'))].map(m => strip(m[1])).filter(Boolean);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(b => ({
    id: pull('guid', b[1])[0] || pull('link', b[1])[0] || '',
    title: pull('title', b[1])[0] || '',
    description: pull('description', b[1])[0] || '',
    link: pull('link', b[1])[0] || '',
    pubDate: pull('pubDate', b[1])[0] || '',
  }));
}

function scoreNewsItem(item) {
  const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
  return NEWS_RELEVANCE_KEYWORDS.reduce((sum, { w, s }) => text.includes(w.toLowerCase()) ? sum + s : sum, 0);
}

function isRecentHours(dateStr, hours) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d) && (Date.now() - d.getTime()) < hours * 60 * 60 * 1000;
}

function fmtVolume(v) {
  if (!v) return '$0';
  if (v >= 1000000) return `$${(v/1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v/1000).toFixed(0)}K`;
  return `$${v}`;
}

async function callClaude(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function postTweet(message) {
  const res = await fetch('https://marketdatanews.com/.netlify/functions/post-to-twitter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

// ── Tweet: Prediction Market ───────────────────────────────────────────────────

async function tweetPredictionMarket(store, tweetedIds) {
  const data = await fetchJson(KALSHI_URL);
  const markets = data.markets || [];

  const cutoff14 = Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000;
  const recentIds = new Set(tweetedIds.filter(t => new Date(t.date).getTime() > cutoff14).map(t => t.id));

  const candidates = markets.filter(m => {
    const yes = m.yes_price != null ? m.yes_price : (m.last_price ?? null);
    if (yes == null) return false;
    const prob = yes > 1 ? yes / 100 : yes;
    if (prob < 0.15 || prob > 0.85) return false;
    const titleLower = (m.title || '').toLowerCase();
    if (!KALSHI_KEYWORDS.some(kw => titleLower.includes(kw))) return false;
    if ((m.title || '').includes(',')) return false;
    const vol = m.volume_24h || m.volume || 0;
    if (vol < 10000) return false;
    if (recentIds.has(m.ticker)) return false;
    return true;
  }).map(m => {
    const yes = m.yes_price != null ? m.yes_price : (m.last_price ?? 0);
    const prob = yes > 1 ? yes / 100 : yes;
    return { ...m, prob };
  }).sort((a, b) => Math.abs(a.prob - 0.5) - Math.abs(b.prob - 0.5)); // closest to 50% first

  if (!candidates.length) return { skipped: 'no eligible kalshi markets' };

  const m = candidates[0];
  const vol = m.volume_24h || m.volume || 0;
  const probPct = Math.round(m.prob * 100);
  const expiry = m.close_time ? new Date(m.close_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'open';

  const system = 'You are a market intelligence account covering prediction markets and macro finance. Write a punchy tweet under 240 chars about this prediction market. Include the probability, why it matters to financial professionals, and end with marketdatanews.com/prediction-markets-live and hashtags #PredictionMarkets #Kalshi #MacroMarkets. Be direct and insightful not hype-y. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.';
  const user = `Market: ${m.title} | Probability: ${probPct}% YES | Volume: ${fmtVolume(vol)} | Expiry: ${expiry}`;

  const tweet = await callClaude(system, user);
  if (!tweet || tweet.length > 280) return { skipped: 'tweet too long or empty', len: tweet?.length };

  const result = await postTweet(tweet);
  if (!result.success) throw new Error(result.error || 'Post failed');

  return { success: true, id: result.id, ticker: m.ticker, tweet };
}

// ── Tweet: Crypto / CFTC News ─────────────────────────────────────────────────

async function tweetCryptoNews(store, tweetedIds) {
  const cutoff14 = Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000;
  const recentIds = new Set(tweetedIds.filter(t => new Date(t.date).getTime() > cutoff14).map(t => t.id));

  const [cftcData, rssText] = await Promise.allSettled([
    fetchJson(FR_CFTC_URL),
    fetchText(COINDESK_RSS_URL),
  ]);

  const newsItems = [];

  if (cftcData.status === 'fulfilled') {
    (cftcData.value.results || []).forEach(a => newsItems.push({
      id: a.document_number || a.html_url || a.title,
      title: a.title || '',
      description: a.abstract || '',
      link: a.html_url || 'https://www.federalregister.gov',
      pubDate: a.publication_date || '',
      source: 'CFTC',
    }));
  }
  if (rssText.status === 'fulfilled') {
    parseRssItems(rssText.value).forEach(item => newsItems.push({ ...item, source: 'CoinDesk' }));
  }

  const eligible = newsItems
    .filter(item => {
      if (recentIds.has(item.id)) return false;
      // Accept CFTC items from today; CoinDesk from last 6 hours
      if (item.source === 'CFTC') return isRecentHours(item.pubDate + 'T00:00:00Z', 36);
      return isRecentHours(item.pubDate, 6);
    })
    .map(item => ({ ...item, score: scoreNewsItem(item) }))
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (!eligible.length) return { skipped: 'no eligible news items' };

  const item = eligible[0];
  const system = 'You are a market data and fintech intelligence account. Write a punchy tweet under 240 chars about this crypto or regulatory news relevant to financial market professionals. End with the source URL and 2-3 hashtags from: #Crypto #MarketData #FinTech #CFTC #Bitcoin #PredictionMarkets. No hype, just the key fact and why it matters. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.';
  const user = `Title: ${item.title}\nDescription: ${(item.description || '').slice(0, 400)}\nURL: ${item.link}`;

  const tweet = await callClaude(system, user);
  if (!tweet || tweet.length > 280) return { skipped: 'tweet too long or empty', len: tweet?.length };

  const result = await postTweet(tweet);
  if (!result.success) throw new Error(result.error || 'Post failed');

  return { success: true, id: result.id, itemId: item.id, tweet };
}

// ── Main Handler ──────────────────────────────────────────────────────────────

exports.handler = async function () {
  const store = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= DAILY_LIMIT) {
      console.log('[crypto-pm] Daily limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit', count: dailyCount }) };
    }

    // Load dedup list, prune entries older than 30 days
    const raw = (await store.get('crypto-pm-tweeted', { type: 'json' }).catch(() => [])) || [];
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const tweetedIds = Array.isArray(raw) ? raw.filter(t => new Date(t.date).getTime() > cutoff30) : [];

    // Determine which run based on current UTC hour
    const utcHour = new Date().getUTCHours();
    let runType;
    if (utcHour === 13) runType = 'pm';       // 8am ET
    else if (utcHour === 16) runType = 'news'; // 11am ET
    else runType = 'best';                      // 2pm ET or manual

    console.log(`[crypto-pm] UTC hour ${utcHour} → run type: ${runType}`);

    let outcome;
    let tweetedId = null;

    if (runType === 'pm') {
      outcome = await tweetPredictionMarket(store, tweetedIds).catch(e => ({ error: e.message }));
      if (outcome.success) tweetedId = outcome.ticker;
    } else if (runType === 'news') {
      outcome = await tweetCryptoNews(store, tweetedIds).catch(e => ({ error: e.message }));
      if (outcome.success) tweetedId = outcome.itemId;
    } else {
      // Try PM first, fall back to news
      outcome = await tweetPredictionMarket(store, tweetedIds).catch(e => ({ error: e.message }));
      if (outcome.success) {
        tweetedId = outcome.ticker;
      } else {
        console.log('[crypto-pm] PM fallback to news. Reason:', outcome.skipped || outcome.error);
        outcome = await tweetCryptoNews(store, tweetedIds).catch(e => ({ error: e.message }));
        if (outcome.success) tweetedId = outcome.itemId;
      }
    }

    if (outcome.success && tweetedId) {
      // Save dedup entry
      tweetedIds.push({ id: tweetedId, date: new Date().toISOString() });
      await store.set('crypto-pm-tweeted', JSON.stringify(tweetedIds));
      // Increment daily count
      await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
      console.log('[crypto-pm] Posted. id:', outcome.id);
    } else {
      console.log('[crypto-pm] Skipped:', outcome.skipped || outcome.error);
    }

    return { statusCode: 200, body: JSON.stringify({ runType, ...outcome }) };
  } catch (err) {
    console.error('[crypto-pm] Unexpected error:', err.message);
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
