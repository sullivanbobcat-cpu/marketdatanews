// rule-filings.js
// GET /.netlify/functions/rule-filings
// Fetches SEC SRO rule filings from the Federal Register API, filters for
// market-data-relevant filings, scores by relevance, and returns structured JSON.
// Results are cached in-memory for 6 hours.

const SR_PREFIXES = [
  'SR-NYSE', 'SR-NASDAQ', 'SR-CBOE', 'SR-FINRA', 'SR-CME',
  'SR-MEMX', 'SR-IEX', 'SR-MIAX', 'SR-BOX', 'SR-BX',
  'SR-PHLX', 'SR-C2', 'SR-CFE', 'SR-BYX', 'SR-BZX',
  'SR-EDGA', 'SR-EDGX', 'SR-CboeBYX', 'SR-CboeBZX',
];

const HIGH_KEYWORDS = [
  'market data', 'data feed', 'connectivity', 'fee', 'port fee', 'access fee',
  'SIP', 'NMS plan', 'co-location', 'colocation', 'MDP', 'ITCH', 'Pillar',
  'data dissemination', 'latency', 'infrastructure', 'network', 'tape',
  'OPRA', 'CTA', 'UTP', 'consolidated tape', 'real-time data',
];

const MEDIUM_KEYWORDS = [
  'trading hours', 'order type', 'routing', 'matching engine', 'price improvement',
  'market maker', 'liquidity', 'rebate', 'maker-taker', 'transaction fee',
  'membership', 'participant', 'technology', 'system', 'platform',
];

const EXCHANGE_MAP = {
  'NYSE': 'NYSE', 'NASDAQ': 'NASDAQ', 'CBOE': 'Cboe', 'FINRA': 'FINRA',
  'CME': 'CME', 'MEMX': 'MEMX', 'IEX': 'IEX', 'MIAX': 'MIAX',
  'BOX': 'BOX', 'BX': 'Nasdaq BX', 'PHLX': 'Nasdaq PHLX',
  'C2': 'Cboe C2', 'CFE': 'Cboe CFE', 'BYX': 'Cboe BYX', 'BZX': 'Cboe BZX',
  'EDGA': 'Cboe EDGA', 'EDGX': 'Cboe EDGX',
  'CboeBYX': 'Cboe BYX', 'CboeBZX': 'Cboe BZX',
};

// In-memory cache
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 6 * 3600 * 1000;

function scoreRelevance(title, abstract) {
  const text = ((title || '') + ' ' + (abstract || '')).toLowerCase();
  if (HIGH_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) return 'HIGH';
  if (MEDIUM_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) return 'MEDIUM';
  return 'LOW';
}

function extractFileNumber(title) {
  if (!title) return null;
  const match = title.match(/\bSR-[A-Z][A-Za-z0-9]+(?:Cboe[A-Z]+)?-\d{4}-\d+\b/);
  return match ? match[0] : null;
}

function extractExchange(fileNumber) {
  if (!fileNumber) return null;
  const parts = fileNumber.split('-');
  if (parts.length < 2) return null;
  // SR-EXCHANGE-YEAR-NUM → parts[1] is exchange key
  const key = parts[1];
  return EXCHANGE_MAP[key] || key;
}

function isSROFiling(title, abstract) {
  const text = ((title || '') + ' ' + (abstract || '')).toLowerCase();
  if (SR_PREFIXES.some((p) => (title || '').includes(p))) return true;
  if (text.includes('self-regulatory organization') || text.includes('sro')) return true;
  return false;
}

async function fetchFilings() {
  const apiUrl =
    'https://www.federalregister.gov/api/v1/articles.json' +
    '?fields[]=title&fields[]=abstract&fields[]=publication_date&fields[]=agency_names' +
    '&fields[]=document_number&fields[]=comments_close_on&fields[]=html_url&fields[]=pdf_url' +
    '&per_page=80&order=newest&agencies[]=securities-and-exchange-commission';

  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'MarketDataNews-RuleFilings/1.0' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Federal Register API: HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

function processFilings(raw) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return raw
    .filter((a) => isSROFiling(a.title, a.abstract))
    .map((a) => {
      const fileNumber = extractFileNumber(a.title);
      const exchange = extractExchange(fileNumber);
      const relevance = scoreRelevance(a.title, a.abstract);

      let isOpenForComment = false;
      let daysUntilClose = null;
      if (a.comments_close_on) {
        const closeDate = new Date(a.comments_close_on);
        closeDate.setHours(0, 0, 0, 0);
        daysUntilClose = Math.round((closeDate - today) / 86400000);
        isOpenForComment = daysUntilClose >= 0;
      }

      return {
        document_number: a.document_number || null,
        file_number: fileNumber,
        exchange: exchange,
        title: a.title || '',
        abstract: a.abstract || '',
        publication_date: a.publication_date || null,
        comments_close_on: a.comments_close_on || null,
        is_open_for_comment: isOpenForComment,
        days_until_comment_close: daysUntilClose,
        relevance,
        html_url: a.html_url || null,
        pdf_url: a.pdf_url || null,
      };
    })
    .sort((a, b) => {
      // Sort: HIGH first, then by date desc
      const rv = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      if (rv[a.relevance] !== rv[b.relevance]) return rv[a.relevance] - rv[b.relevance];
      return (b.publication_date || '').localeCompare(a.publication_date || '');
    });
}

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Serve from cache if fresh
  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      body: JSON.stringify({ retrievedAt: new Date().toISOString(), cached: true, filings: cache }),
    };
  }

  try {
    const raw = await fetchFilings();
    const filings = processFilings(raw);
    cache = filings;
    cacheTime = Date.now();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      body: JSON.stringify({ retrievedAt: new Date().toISOString(), cached: false, filings }),
    };
  } catch (err) {
    console.error('[rule-filings] Error:', err.message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
