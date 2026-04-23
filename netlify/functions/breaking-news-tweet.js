const https = require('https');
const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');
const { Anthropic } = require('@anthropic-ai/sdk');

function get(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 9000);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 MarketDataNews/1.0' } }, (res) => {
      // follow one redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { clearTimeout(timeout); resolve({ body, status: res.statusCode }); });
    });
    req.on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

// Lightweight RSS/XML item extractor
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const extract = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (block.match(r) || [])[1]?.trim() || '';
    };
    const title   = extract('title');
    const link    = extract('link') || extract('guid');
    const pubDate = extract('pubDate') || extract('dc:date') || extract('updated');
    const guid    = extract('guid') || link;
    if (title) items.push({ id: guid, title, link, pubDate });
  }
  return items;
}

const KEYWORDS = [
  'SR-', 'market data', 'connectivity', 'SIP', 'NMS', 'OPRA', 'CME', 'NYSE',
  'Nasdaq', 'fee', 'port', 'MDP', 'iLink', 'FINRA', 'CAT', 'CFTC', 'rule filing',
  'exchange', 'securities', 'trading', 'regulation', 'clearing', 'order routing',
  'rate', 'inflation', 'monetary policy', 'federal funds', 'balance sheet',
  'quantitative', 'reserve', 'payment system', 'financial stability', 'stress test',
];

function score(item) {
  const text = (item.title + ' ' + (item.description || '')).toLowerCase();
  return KEYWORDS.reduce((s, kw) => s + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
}

function isRecent(dateStr, minutes = 15) {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) < minutes * 60 * 1000;
  } catch { return false; }
}

const FEEDS = [
  {
    url: 'https://www.federalregister.gov/api/v1/articles.json?fields[]=title&fields[]=publication_date&fields[]=html_url&fields[]=document_number&per_page=5&order=newest&agencies[]=securities-and-exchange-commission&conditions[term]=SR-',
    type: 'json',
  },
  { url: 'https://www.cmegroup.com/rss/notices.xml',               type: 'rss' },
  { url: 'https://www.sec.gov/rss/news/press.rss',                 type: 'rss' },
  { url: 'https://www.finra.org/rss/news',                         type: 'rss' },
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml',     type: 'rss' },
];

exports.handler = async () => {
  try {
    const store = getStore({
      name: 'tweet-state',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    // ── Shared daily limit ─────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 12) {
      console.log('[breaking-news] Daily limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    // ── Rate limit: max 3 tweets per hour ──────────────────────────────────
    const hourKey = 'rate-' + new Date().toISOString().slice(0, 13); // "2026-04-08T14"
    const hourCount = (await store.get(hourKey, { type: 'json' }).catch(() => 0)) || 0;
    if (hourCount >= 3) {
      console.log('[breaking-news] Rate limit reached for hour:', hourKey);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'rate limit', hour: hourKey }) };
    }

    // ── Load tweeted-items set ─────────────────────────────────────────────
    const tweetedArr = await store.get('tweeted-items', { type: 'json' }).catch(() => []);
    const tweeted = new Set(Array.isArray(tweetedArr) ? tweetedArr : []);

    // ── Fetch all feeds ────────────────────────────────────────────────────
    const allItems = [];
    const results = await Promise.allSettled(FEEDS.map(f => get(f.url).then(r => ({ ...r, feed: f }))));

    for (const r of results) {
      if (r.status !== 'fulfilled') { console.error('[breaking-news] Feed fetch failed:', r.reason?.message); continue; }
      const { body, feed } = r.value;
      try {
        if (feed.type === 'json') {
          const data = JSON.parse(body);
          for (const a of (data.results || [])) {
            allItems.push({
              id: a.document_number || a.html_url,
              title: (a.title || '').trim(),
              link: a.html_url || '',
              pubDate: a.publication_date || '',
            });
          }
        } else {
          allItems.push(...parseRSS(body));
        }
      } catch (e) { console.error('[breaking-news] Parse error:', e.message); }
    }

    console.log('[breaking-news] Total items fetched:', allItems.length);

    // ── Filter candidates ──────────────────────────────────────────────────
    const candidates = allItems
      .filter(item => item.id && !tweeted.has(item.id) && isRecent(item.pubDate) && score(item) >= 1)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3 - hourCount);

    console.log('[breaking-news] Candidates:', candidates.length);

    if (candidates.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ checked: allItems.length, candidates: 0 }) };
    }

    // ── Tweet each candidate ───────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const twitterClient = new TwitterApi({
      appKey:       process.env.TWITTER_API_KEY,
      appSecret:    process.env.TWITTER_API_SECRET,
      accessToken:  process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    let tweetsPosted = 0;
    const newIds = [];

    for (const item of candidates) {
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: 'You are a market data infrastructure news account on X. Write a breaking news tweet under 240 characters. Lead with the key fact. End with the URL and 2-3 relevant hashtags from: #MarketData #MarketStructure #NYSE #Nasdaq #CME #OPRA #CAT #FINRA #SEC #CFTC #FinTech. Output only the tweet text, nothing else. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.',
          messages: [{ role: 'user', content: `Title: ${item.title}\nURL: ${item.link}` }],
        });

        const tweetText = msg.content[0].text.trim().slice(0, 280);
        await twitterClient.v2.tweet(tweetText);
        newIds.push(item.id);
        tweetsPosted++;
        console.log('[breaking-news] Tweeted:', item.title);
      } catch (e) {
        console.error('[breaking-news] Failed to tweet item:', item.id, e.message);
      }
    }

    // ── Update blobs ───────────────────────────────────────────────────────
    if (tweetsPosted > 0) {
      const updated = [...tweeted, ...newIds].slice(-500); // cap at 500 IDs
      await store.set('tweeted-items', JSON.stringify(updated));
      await store.set(hourKey, JSON.stringify(hourCount + tweetsPosted));
      await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + tweetsPosted));
      // expire rate-limit key after 2 hours by overwriting only if needed - Blobs has no TTL,
      // but the key is unique per hour so stale keys are naturally abandoned
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ checked: allItems.length, candidates: candidates.length, tweeted: tweetsPosted }),
    };
  } catch (e) {
    console.error('[breaking-news] Fatal error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
