const { TwitterApi } = require('twitter-api-v2');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { message, replyToId } = JSON.parse(event.body);
    if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message provided' }) };
    if (message.length > 280) return { statusCode: 400, body: JSON.stringify({ error: 'Tweet too long' }) };

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweetData = { text: message };
    if (replyToId) tweetData.reply = { in_reply_to_tweet_id: replyToId };
    const tweet = await client.v2.tweet(tweetData);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, id: tweet.data.id })
    };
  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
