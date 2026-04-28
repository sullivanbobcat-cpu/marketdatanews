// daily-reply-digest.js
// Schedule: '0 13 * * 1-5'  (8am ET weekdays = 13:00 UTC)
// Searches Twitter for relevant tweets, drafts Claude replies, saves to Blobs,
// and emails a digest via Resend API.
//
// Required env var: RESEND_API_KEY (optional - if not set, saves to Blobs only)

const { TwitterApi } = require('twitter-api-v2');
const { getStore } = require('@netlify/blobs');
const { Anthropic } = require('@anthropic-ai/sdk');

const RECIPIENT_EMAIL = 'hello@marketdatanews.com';
const SENDER_EMAIL = 'digest@marketdatanews.com';
const TOP_N = 10;

const SEARCH_QUERIES = [
  'from:themarketear',
  'from:unusual_whales',
  'from:tyler_gellasch',
  'from:dave_lauer',
  'market structure -is:retweet lang:en',
  'market data -is:retweet lang:en',
  'maker taker -is:retweet lang:en',
  'dark pool -is:retweet lang:en',
  'NMS plans -is:retweet lang:en',
  'OPRA -is:retweet lang:en',
  'CME connectivity -is:retweet lang:en',
  'SIP feed -is:retweet lang:en',
  'rule 605 -is:retweet lang:en',
  '"24 hour trading" -is:retweet lang:en',
];

// Relevance scoring keywords
const RELEVANCE_KEYWORDS = [
  'market data', 'market structure', 'maker-taker', 'maker taker', 'dark pool',
  'NMS', 'SIP', 'OPRA', 'CME', 'NYSE', 'Nasdaq', 'exchange', 'ATS',
  'rule 605', 'FINRA', 'SEC', 'CFTC', 'connectivity', 'feed', 'latency',
  'order routing', 'execution quality', '24 hour', 'IEX', 'MEMX', 'TXSE',
  'maker rebate', 'taker fee', 'co-location', 'consolidated tape', 'iLink',
];

function scoreTweet(tweet) {
  const text = (tweet.text || '').toLowerCase();
  let score = 0;

  // Keyword relevance
  for (const kw of RELEVANCE_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) score += 2;
  }

  // Engagement signals (public_metrics)
  const m = tweet.public_metrics || {};
  score += Math.min(Math.log10((m.like_count || 0) + 1) * 3, 8);
  score += Math.min(Math.log10((m.retweet_count || 0) + 1) * 2, 5);
  score += Math.min(Math.log10((m.reply_count || 0) + 1) * 1.5, 4);

  // Slight bonus for known accounts
  const knownAccounts = ['themarketear', 'unusual_whales', 'tyler_gellasch', 'dave_lauer'];
  const authorName = ((tweet._author_username) || '').toLowerCase();
  if (knownAccounts.includes(authorName)) score += 5;

  return score;
}

async function searchTweets(client) {
  const seen = new Set();
  const collected = [];

  for (const q of SEARCH_QUERIES) {
    try {
      const res = await client.v2.search(q, {
        max_results: 10,
        'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text'],
        'user.fields': ['username', 'name'],
        expansions: ['author_id'],
        start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      const users = {};
      if (res.includes?.users) {
        for (const u of res.includes.users) users[u.id] = u;
      }

      const tweets = res.data?.data || [];
      for (const t of tweets) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const author = users[t.author_id] || {};
        t._author_username = author.username || '';
        t._author_name = author.name || '';
        collected.push(t);
      }
    } catch (err) {
      console.warn(`[daily-reply-digest] Search failed for query "${q}":`, err.message);
    }
  }

  return collected;
}

async function generateReply(tweet) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userMsg = `Author: @${tweet._author_username || 'unknown'}\n\nTweet: ${tweet.text}`;
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    system: `You are the founder of Market Data News. Draft a genuine knowledgeable reply that adds real insight - a specific fact, nuance, or perspective. Under 240 characters. Not promotional. Do not mention your site unless it directly adds value. No em dashes. No hashtags. Sound like a practitioner not a brand account.`,
    messages: [{ role: 'user', content: userMsg }],
  });
  return (msg.content[0]?.text || '').trim().replace(/\n/g, ' ');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso || '';
  }
}

function buildEmailHtml(date, drafts) {
  const rows = drafts.map((d, i) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:16px 8px;vertical-align:top;font-family:monospace;font-size:11px;color:#888;width:24px;">${i + 1}</td>
      <td style="padding:16px 8px;">
        <div style="margin-bottom:6px;">
          <strong style="font-family:monospace;font-size:12px;">@${d.authorUsername}</strong>
          <span style="font-family:monospace;font-size:11px;color:#888;margin-left:8px;">${formatDate(d.createdAt)}</span>
        </div>
        <div style="font-size:13px;color:#333;margin-bottom:10px;padding:10px;background:#f9f9f9;border-left:3px solid #ddd;">${d.tweetText}</div>
        <div style="font-size:12px;font-weight:600;color:#b8860b;margin-bottom:4px;">Suggested reply:</div>
        <div style="font-size:13px;color:#0d0d0d;padding:10px;background:#fffdf5;border-left:3px solid #b8860b;">${d.suggestedReply}</div>
        <div style="margin-top:8px;">
          <a href="https://twitter.com/intent/tweet?in_reply_to=${d.tweetId}&text=${encodeURIComponent(d.suggestedReply)}" style="font-family:monospace;font-size:10px;color:#b8860b;text-decoration:none;">Reply on Twitter →</a>
        </div>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>MDN Daily Reply Digest ${date}</title></head>
<body style="font-family:'IBM Plex Sans',sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#faf8f3;color:#0d0d0d;">
  <div style="background:#0d0d0d;padding:20px 24px;margin-bottom:24px;">
    <h1 style="font-family:Georgia,serif;color:#b8860b;margin:0;font-size:22px;">Market Data <span style="color:white;">News</span></h1>
    <p style="font-family:monospace;font-size:11px;color:#888;margin:4px 0 0;">Daily Reply Digest - ${date}</p>
  </div>
  <p style="font-size:13px;color:#555;margin-bottom:20px;">Top ${drafts.length} tweets from the last 24 hours with suggested replies. Click a link to reply directly on Twitter.</p>
  <table style="width:100%;border-collapse:collapse;">
    ${rows}
  </table>
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-family:monospace;font-size:10px;color:#aaa;">
    Generated by MDN automation - marketdatanews.com
  </div>
</body>
</html>`;
}

function buildEmailText(date, drafts) {
  return drafts.map((d, i) => [
    `${i + 1}. @${d.authorUsername} (${formatDate(d.createdAt)})`,
    `Tweet: ${d.tweetText}`,
    `Suggested reply: ${d.suggestedReply}`,
    `Reply link: https://twitter.com/intent/tweet?in_reply_to=${d.tweetId}&text=${encodeURIComponent(d.suggestedReply)}`,
    '---',
  ].join('\n')).join('\n\n');
}

async function sendEmail(date, drafts) {
  const html = buildEmailHtml(date, drafts);
  const text = buildEmailText(date, drafts);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: SENDER_EMAIL,
      to: RECIPIENT_EMAIL,
      subject: `MDN Daily Reply Digest ${date}`,
      html,
      text,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json();
}

exports.handler = async function () {
  const date = new Date().toISOString().split('T')[0];

  const store = getStore({
    name: 'reply-drafts',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    // Dedup: only run once per day
    const alreadyRan = await store.get(`ran-${date}`, { type: 'json' }).catch(() => null);
    if (alreadyRan) {
      console.log('[daily-reply-digest] Already ran today:', date);
      return { statusCode: 200, body: JSON.stringify({ skipped: 'already ran today' }) };
    }

    if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_BEARER_TOKEN) {
      console.error('[daily-reply-digest] Missing Twitter credentials');
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing Twitter credentials' }) };
    }

    const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

    // Search Twitter
    console.log('[daily-reply-digest] Searching Twitter...');
    const allTweets = await searchTweets(client);
    console.log('[daily-reply-digest] Found', allTweets.length, 'tweets');

    if (!allTweets.length) {
      console.log('[daily-reply-digest] No tweets found');
      return { statusCode: 200, body: JSON.stringify({ skipped: 'no tweets found' }) };
    }

    // Score and pick top N
    allTweets.sort((a, b) => scoreTweet(b) - scoreTweet(a));
    const top = allTweets.slice(0, TOP_N);

    // Generate reply for each
    const drafts = [];
    for (const tweet of top) {
      let reply = '';
      try {
        reply = await generateReply(tweet);
        if (reply.length > 240) reply = reply.slice(0, 237) + '...';
      } catch (err) {
        console.warn('[daily-reply-digest] Claude reply failed for tweet', tweet.id, ':', err.message);
        reply = '(Reply generation failed)';
      }
      drafts.push({
        tweetId: tweet.id,
        tweetText: tweet.text,
        authorUsername: tweet._author_username || tweet.author_id,
        authorName: tweet._author_name || '',
        createdAt: tweet.created_at || '',
        score: Math.round(scoreTweet(tweet) * 10) / 10,
        suggestedReply: reply,
      });
    }

    // Save drafts to Blobs
    await store.set(`daily-reply-drafts-${date}`, JSON.stringify({ date, drafts, generatedAt: new Date().toISOString() }));
    console.log('[daily-reply-digest] Saved', drafts.length, 'drafts to Blobs');

    // Send email if RESEND_API_KEY is configured
    if (process.env.RESEND_API_KEY) {
      try {
        await sendEmail(date, drafts);
        console.log('[daily-reply-digest] Email sent to', RECIPIENT_EMAIL);
      } catch (emailErr) {
        console.error('[daily-reply-digest] Email send failed:', emailErr.message);
        // Don't fail the function - drafts are saved to Blobs
      }
    } else {
      console.log('[daily-reply-digest] RESEND_API_KEY not set. Drafts saved to Blobs only.');
      console.log('[daily-reply-digest] To enable email: add RESEND_API_KEY to Netlify environment variables.');
      console.log('[daily-reply-digest] Get a free key at resend.com (3000 emails/month free).');
    }

    // Mark as ran for today
    await store.set(`ran-${date}`, JSON.stringify({ ranAt: new Date().toISOString(), draftsCount: drafts.length }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        date,
        draftsCount: drafts.length,
        emailSent: !!process.env.RESEND_API_KEY,
      }),
    };
  } catch (err) {
    console.error('[daily-reply-digest] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
