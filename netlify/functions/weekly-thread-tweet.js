// weekly-thread-tweet.js
// Schedule: '0 14 * * 3'  (Wednesday 9am ET = 14:00 UTC)
// Picks the most significant FeedWatch entry from the last 7 days and posts a 4-tweet thread.

const { getStore } = require('@netlify/blobs');
const { Anthropic } = require('@anthropic-ai/sdk');

const DAILY_LIMIT = 12;

async function postTweet(message, replyToId) {
  const base = process.env.URL || 'https://marketdatanews.com';
  const body = { message };
  if (replyToId) body.replyToId = replyToId;
  const res = await fetch(`${base}/.netlify/functions/post-to-twitter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

function severityScore(e) {
  const s = (e.severity || '').toUpperCase();
  if (s === 'CRITICAL') return 3;
  if (s === 'HIGH') return 2;
  if (s === 'MEDIUM') return 1;
  return 0;
}

exports.handler = async function () {
  const stateStore = getStore({
    name: 'tweet-state',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  const today = new Date().toISOString().split('T')[0];

  try {
    // Check daily tweet limit
    const dailyCount = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
    if (dailyCount >= DAILY_LIMIT) {
      console.log('[weekly-thread] Daily tweet limit reached:', dailyCount);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'daily limit' }) };
    }

    // Deduplication: only post one thread per week
    const weekKey = `weekly-thread-posted-${today.slice(0, 7)}`; // YYYY-MM
    // Use ISO week instead: Monday of this week
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const weekId = monday.toISOString().split('T')[0];
    const weekKey2 = `weekly-thread-posted-${weekId}`;
    const alreadyPosted = await stateStore.get(weekKey2, { type: 'json' }).catch(() => null);
    if (alreadyPosted) {
      console.log('[weekly-thread] Already posted this week:', weekId);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'already posted this week' }) };
    }

    // Fetch FeedWatch entries
    const fwStore = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await fwStore.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    // Filter to entries added in last 7 days with CRITICAL or HIGH severity
    const cutoff = sevenDaysAgo();
    const recent = entries.filter(e => {
      const sev = (e.severity || '').toUpperCase();
      if (!['CRITICAL', 'HIGH'].includes(sev)) return false;
      const added = e.createdAt || e.addedAt || e.date || '';
      if (!added) return true; // include if no date (assume recent)
      const d = new Date(added);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

    // If no recent entries, fall back to most significant overall CRITICAL/HIGH
    const pool = recent.length > 0 ? recent : entries.filter(e => ['CRITICAL', 'HIGH'].includes((e.severity || '').toUpperCase()));

    if (!pool.length) {
      console.log('[weekly-thread] No CRITICAL/HIGH entries found');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no entries' }) };
    }

    // Pick most significant: highest severity, then most recent
    pool.sort((a, b) => {
      const diff = severityScore(b) - severityScore(a);
      if (diff !== 0) return diff;
      const da = new Date(a.createdAt || a.date || 0);
      const db = new Date(b.createdAt || b.date || 0);
      return db - da;
    });
    const entry = pool[0];

    console.log('[weekly-thread] Selected entry:', entry.title);

    // Build user message for Claude
    const userMsg = [
      `Title: ${entry.title || 'Unknown'}`,
      `Severity: ${entry.severity || 'HIGH'}`,
      `Exchange/Source: ${entry.exchange || entry.source || 'Unknown'}`,
      `Effective Date: ${entry.effectiveDate || entry.deadline || 'TBD'}`,
      `Description: ${entry.description || entry.body || entry.summary || 'No description available'}`,
      entry.actionRequired ? `Action Required: ${entry.actionRequired}` : '',
    ].filter(Boolean).join('\n');

    // Call Claude to generate the 4-tweet thread
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `You are the editor of Market Data News. Write a 4-tweet thread breaking down this regulatory change for market data professionals.

Return a JSON array of exactly 4 strings, each under 270 characters.

Tweet 1: Hook - what happened and why it matters in plain English
Tweet 2: The technical detail - what specifically changed
Tweet 3: Who is affected and what action they need to take
Tweet 4: Broader context - where this fits in the industry

Rules: No em dashes. No hashtags. End tweet 4 with marketdatanews.com. Write like a knowledgeable insider not a press release. Return only valid JSON, no other text.`,
      messages: [{ role: 'user', content: userMsg }],
    });

    let tweets;
    try {
      const raw = msg.content[0]?.text || '[]';
      // Strip any markdown code fences if present
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      tweets = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[weekly-thread] Failed to parse Claude response:', msg.content[0]?.text);
      return { statusCode: 500, body: JSON.stringify({ error: 'Claude response parse failed' }) };
    }

    if (!Array.isArray(tweets) || tweets.length !== 4) {
      console.error('[weekly-thread] Unexpected tweet array length:', tweets?.length);
      return { statusCode: 500, body: JSON.stringify({ error: 'Expected 4 tweets from Claude' }) };
    }

    // Validate all tweets are under 280 chars
    for (let i = 0; i < tweets.length; i++) {
      if (typeof tweets[i] !== 'string') tweets[i] = String(tweets[i]);
      if (tweets[i].length > 280) {
        tweets[i] = tweets[i].slice(0, 277) + '...';
      }
    }

    // Post the thread
    const postedIds = [];
    let replyToId = null;

    for (let i = 0; i < tweets.length; i++) {
      const result = await postTweet(tweets[i], replyToId);
      if (!result.success) {
        console.error(`[weekly-thread] Failed to post tweet ${i + 1}:`, result.error);
        return { statusCode: 500, body: JSON.stringify({ error: `Tweet ${i + 1} failed: ${result.error}`, posted: postedIds }) };
      }
      postedIds.push(result.id);
      replyToId = result.id;
      console.log(`[weekly-thread] Posted tweet ${i + 1}:`, result.id);

      // Increment daily count for each tweet in thread
      const count = (await stateStore.get(`daily-tweet-count-${today}`, { type: 'json' }).catch(() => 0)) || 0;
      await stateStore.set(`daily-tweet-count-${today}`, JSON.stringify(count + 1));

      if (i < tweets.length - 1) {
        await sleep(30000); // 30 second delay between thread tweets
      }
    }

    // Mark as posted for this week
    await stateStore.set(weekKey2, JSON.stringify({ postedAt: new Date().toISOString(), entryTitle: entry.title, ids: postedIds }));

    return { statusCode: 200, body: JSON.stringify({ success: true, ids: postedIds, entry: entry.title }) };
  } catch (err) {
    console.error('[weekly-thread] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
