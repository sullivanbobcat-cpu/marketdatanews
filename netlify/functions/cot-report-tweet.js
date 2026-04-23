// cot-report-tweet.js
// Schedule: '0 21 * * 5' (4pm ET Fridays - when COT releases)
// Tweets notable positioning changes from CFTC Commitment of Traders report

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MarketDataNews/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('[cot-tweet] fetchJson error:', e.message);
    return null;
  }
}

async function callClaude(summary) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'You are a futures market intelligence account. Write a tweet under 230 chars summarizing the most notable positioning change in this week\'s CFTC Commitment of Traders report. Be specific with numbers. No hashtags. No emojis. End with marketdatanews.com. Never use em dashes in your response. Use a hyphen (-) or colon (:) instead.',
      messages: [{ role: 'user', content: summary }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

exports.handler = async () => {
  try {
    const store = getStore({ name: 'tweet-state', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await store.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 15) return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };

    // Only run once per week
    const alreadyTweeted = await store.get(`cot-tweeted-${today}`, { type: 'json' }).catch(() => null);
    if (alreadyTweeted) return { statusCode: 200, body: JSON.stringify({ skipped: 'already tweeted this week' }) };

    // CFTC OData API for disaggregated futures positions
    // Focus on financial futures: S&P 500, T-Notes, and commodities
    const MARKETS = [
      { name: 'S&P 500 E-mini', cftcCode: '13874+' },
      { name: '10Y T-Note', cftcCode: '43874+' },
      { name: 'Corn', cftcCode: '002602' },
      { name: 'Wheat', cftcCode: '001602' },
      { name: 'Soybeans', cftcCode: '005602' },
      { name: 'Gold', cftcCode: '088691' },
      { name: 'Crude Oil WTI', cftcCode: '067651' },
    ];

    const data = await fetchJson(
      'https://publicreporting.cftc.gov/api/odata/v1/TriWeeklyReports?$top=20&$orderby=Report_Date_as_YYYY_MM_DD desc&$select=Market_and_Exchange_Names,NonComm_Positions_Long_All,NonComm_Positions_Short_All,Report_Date_as_YYYY_MM_DD'
    );

    let summaryLines = [];
    if (data && data.value && data.value.length) {
      // Group by market name, compare current vs prior
      const byMarket = {};
      for (const row of data.value) {
        const name = row.Market_and_Exchange_Names || '';
        const date = row.Report_Date_as_YYYY_MM_DD || '';
        if (!byMarket[name]) byMarket[name] = [];
        byMarket[name].push({ date, long: Number(row.NonComm_Positions_Long_All || 0), short: Number(row.NonComm_Positions_Short_All || 0) });
      }

      for (const [name, rows] of Object.entries(byMarket)) {
        if (rows.length < 2) continue;
        rows.sort((a, b) => b.date.localeCompare(a.date));
        const curr = rows[0];
        const prev = rows[1];
        const currNet = curr.long - curr.short;
        const prevNet = prev.long - prev.short;
        const change = currNet - prevNet;
        if (Math.abs(change) > 10000) {
          summaryLines.push(`${name}: net ${currNet > 0 ? '+' : ''}${(currNet / 1000).toFixed(0)}K contracts (${change > 0 ? '+' : ''}${(change / 1000).toFixed(0)}K wk/wk)`);
        }
      }
    }

    if (!summaryLines.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no notable positioning changes' }) };
    }

    const prompt = `CFTC COT report (week ending ~${today}):\n${summaryLines.join('\n')}`;
    const message = await callClaude(prompt);
    if (!message) return { statusCode: 200, body: JSON.stringify({ skipped: 'claude empty' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweet = await client.v2.tweet(message);
    await store.set(`cot-tweeted-${today}`, JSON.stringify({ tweeted: true }));
    await store.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[cot-tweet] Tweeted:', tweet.data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: tweet.data.id }) };
  } catch (e) {
    console.error('[cot-tweet] Error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ error: e.message }) };
  }
};
