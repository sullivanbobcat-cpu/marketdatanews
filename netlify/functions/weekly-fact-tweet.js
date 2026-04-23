// weekly-fact-tweet.js
// Schedule: 0 0 * * 0  (Sunday 8pm ET = Monday 00:00 UTC)
// Rotates through 12 market data facts by week number.

const { getStore } = require('@netlify/blobs');

const FACTS = [
  'OPRA is the highest-volume market data feed in US markets - regularly exceeding 100 billion messages per day across 96 multicast channels. marketdatanews.com/feed-status #MarketData #OPRA',
  'There are 8 separate NMS Plans governing US market data - CTA, CQ, UTP, OPRA, CAT, LULD, ISRA, and Rule 605. Most market data professionals only know 2 or 3. marketdatanews.com/nms #MarketData',
  'CME deprecated 1Gbps support for MDP 3.0 multicast in March 2026. Any firm still on 1Gbps receiving multicast market data is at risk of packet loss at market open. marketdatanews.com/feed-status #MarketData #CME',
  'The CTA SIP handles Tape A and B. The UTP SIP handles Tape C. Together they consolidate quotes and trades from 17 exchanges into the NBBO every US equity investor relies on. marketdatanews.com/learn #MarketData',
  'Rule 605 compliance deadline: August 1 2026. Large broker-dealers with 100,000+ customer accounts must file monthly execution quality reports for the first time. marketdatanews.com/execution-quality #MarketData #Rule605',
  'The NYSE MDC port fee increase (SR-NYSE-2025-37) was the first co-location fee increase since 2017 - up to 11.1% based on Data PPI inflation tracking. marketdatanews.com/calendar #MarketData #NYSE',
  'FINRA SLATE launched January 2 2026 - securities lending transaction data reporting under Rule 10c-1a. A separate reporting system from CAT with its own connectivity requirements. marketdatanews.com/regulation #MarketData #FINRA',
  'The OPRA feed recently expanded from 48 to 96 multicast lines - the largest infrastructure change in options data in years. Every firm receiving options data had to reconfigure. marketdatanews.com/learn #MarketData #OPRA',
  'Market data fees are not just per-user. Exchanges charge for display use, non-display use, derived data, redistribution, and co-location separately. Most firms underestimate total cost. marketdatanews.com/market-data-fees #MarketData',
  'CAT - the Consolidated Audit Trail - tracks every order event across all US equity and options markets. 27 SROs participate. It is the largest regulatory database ever built. marketdatanews.com/nms #MarketData #CAT',
  'CME Globex is migrating to Google Cloud in 2026. Client sandbox testing open in Dallas region now. This will change how firms connect to futures market data permanently. marketdatanews.com/calendar #MarketData #CME',
  'The professional user definition determines your per-seat market data fees. NYSE, Nasdaq, and Cboe each define it slightly differently - and audit you annually on your count. marketdatanews.com/rulebook-navigator #MarketData',
];

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
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
    const today = new Date().toISOString().split('T')[0];
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= 12) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    const week = getISOWeekNumber(new Date());
    const message = FACTS[week % FACTS.length];

    const result = await postTweet(message);
    if (!result.success) throw new Error(result.error || 'Post failed');

    await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(dailyCount + 1));
    console.log('[weekly-fact] Posted week', week, 'fact. id:', result.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: result.id, week }) };
  } catch (err) {
    console.error('[weekly-fact] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
