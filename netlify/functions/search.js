const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const PAGE_INDEX = [
  {
    title: 'FeedWatch Calendar',
    description: 'Market infrastructure intelligence — exchange notices, feed changes, port migrations, regulatory deadlines, and NMS plan updates consolidated into one operational reference.',
    url: '/calendar.html',
    category: 'Pages',
    keywords: ['feedwatch', 'calendar', 'market data', 'exchange notices', 'port migration', 'connectivity', 'ilink', 'mdp', 'multicast'],
  },
  {
    title: 'All News',
    description: 'Live feed of market data industry news from Reuters, Bloomberg, WSJ, SEC, FINRA, NASDAQ, NYSE, and more.',
    url: '/index.html',
    category: 'Pages',
    keywords: ['news', 'feed', 'bloomberg', 'reuters', 'wsj', 'market data', 'industry', 'breaking'],
  },
  {
    title: 'Exchanges',
    description: 'NYSE Group trading session schedules, 2026 holiday calendar, and market data feed implications for all NYSE Group markets.',
    url: '/exchanges.html',
    category: 'Pages',
    keywords: ['nyse', 'exchange', 'trading hours', 'holidays', 'schedule', '2026', 'session', 'arca', 'american', 'national'],
  },
  {
    title: 'Regulation',
    description: 'SEC, FINRA, CFTC, MiFID II — tracking active rulemakings, compliance deadlines, and enforcement actions affecting market data professionals.',
    url: '/regulation.html',
    category: 'Pages',
    keywords: ['regulation', 'sec', 'finra', 'cftc', 'compliance', 'rulemaking', 'enforcement', 'mifid', 'reporting'],
  },
  {
    title: 'NMS / SIP Plans',
    description: 'UTP Plan, CTA Plan, OPRA Plan — consolidated tape and options price reporting authority tracking and amendments.',
    url: '/nms.html',
    category: 'Pages',
    keywords: ['nms', 'sip', 'utp', 'cta', 'opra', 'consolidated tape', 'plan', 'price reporting', 'national market system'],
  },
  {
    title: 'Feed Status',
    description: 'Live market data feed status, latency monitoring, Sankey fee flow chart, and monthly fee calculator for NYSE, NASDAQ, and Cboe.',
    url: '/feed-status.html',
    category: 'Pages',
    keywords: ['feed status', 'latency', 'uptime', 'sankey', 'fee calculator', 'nyse', 'nasdaq', 'cboe', 'display fees', 'non-display'],
  },
  {
    title: 'Prediction Markets',
    description: 'Kalshi and Polymarket — tracking financial regulation, Fed policy, and market structure prediction contracts.',
    url: '/prediction-markets.html',
    category: 'Pages',
    keywords: ['prediction markets', 'kalshi', 'polymarket', 'fed', 'federal reserve', 'regulation', 'contracts', 'cftc', 'probability'],
  },
  {
    title: 'About',
    description: 'About Market Data News — mission, philosophy, FeedWatch, and contact information.',
    url: '/about.html',
    category: 'Pages',
    keywords: ['about', 'mission', 'contact', 'team', 'philosophy', 'market data news'],
  },
  {
    title: 'Subscribe / Pricing',
    description: 'Subscribe to Market Data News — Standard free tier and Professional plan at $149/month or $1,499/year.',
    url: '/subscribe.html',
    category: 'Pages',
    keywords: ['subscribe', 'pricing', 'professional', 'plan', 'waitlist', 'standard', 'free', '$149'],
  },
  {
    title: 'AI Digest',
    description: 'AI-generated daily briefing on market data industry developments, compiled from regulatory filings and exchange notices.',
    url: '/ai-digest.html',
    category: 'Pages',
    keywords: ['ai', 'digest', 'briefing', 'daily', 'summary', 'artificial intelligence'],
  },
  {
    title: 'NMS Plan Tracker',
    description: 'Track NMS plan proposals, amendments, and SEC filings across UTP, CTA, OPRA, and CAT plans.',
    url: '/plan-tracker.html',
    category: 'Pages',
    keywords: ['plan tracker', 'nms', 'proposals', 'amendments', 'sec filings', 'cat', 'consolidated audit trail'],
  },
];

const TOPIC_INDEX = [
  {
    title: 'NYSE Trading Hours',
    description: 'NYSE regular session: 9:30am–4:00pm ET. Pre-market: 4:00am–9:30am ET. After-hours: 4:00pm–8:00pm ET.',
    url: '/exchanges.html',
    category: 'Topics',
    keywords: ['trading hours', 'nyse hours', 'market hours', 'open close', 'session', 'pre-market', 'after-hours'],
  },
  {
    title: '2026 Market Holidays',
    description: 'NYSE, NASDAQ, and Cboe 2026 holiday schedule: MLK Day, Presidents Day, Good Friday, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas.',
    url: '/exchanges.html',
    category: 'Topics',
    keywords: ['holidays', 'market holidays', '2026', 'mlk', 'presidents day', 'good friday', 'memorial day', 'independence day', 'labor day', 'thanksgiving', 'christmas', 'closed'],
  },
  {
    title: 'Fee Calculator',
    description: 'Estimate monthly market data fees across NYSE, NASDAQ, and Cboe based on professional/non-professional user counts and machine license types.',
    url: '/feed-status.html',
    category: 'Topics',
    keywords: ['fee calculator', 'fees', 'market data fees', 'monthly cost', 'professional users', 'non-professional', 'display fees', 'non-display', 'distribution'],
  },
  {
    title: 'UTP Plan',
    description: 'Unlisted Trading Privileges Plan — governs distribution of NASDAQ and other exchange data via the SIP. Administered by FINRA.',
    url: '/nms.html',
    category: 'Topics',
    keywords: ['utp', 'unlisted trading privileges', 'nasdaq sip', 'tape c', 'finra', 'market data plan'],
  },
  {
    title: 'CTA Plan',
    description: 'Consolidated Tape Association Plan — governs NYSE and other exchange last-sale and quote data. Covers Tape A and Tape B.',
    url: '/nms.html',
    category: 'Topics',
    keywords: ['cta', 'consolidated tape association', 'tape a', 'tape b', 'nyse sip', 'last sale', 'quote data'],
  },
  {
    title: 'OPRA Plan',
    description: 'Options Price Reporting Authority — consolidated options market data from all U.S. options exchanges including CBOE, NASDAQ, NYSE Arca.',
    url: '/nms.html',
    category: 'Topics',
    keywords: ['opra', 'options price reporting', 'options data', 'cboe', 'options exchanges', 'consolidated options'],
  },
  {
    title: 'Kalshi Prediction Markets',
    description: 'CFTC-regulated prediction market contracts on financial regulation, Fed policy, and market structure events.',
    url: '/prediction-markets.html',
    category: 'Topics',
    keywords: ['kalshi', 'cftc regulated', 'prediction contracts', 'fed rate', 'interest rate', 'regulation probability'],
  },
  {
    title: 'Polymarket',
    description: 'Decentralized prediction market platform covering regulatory and financial market outcomes.',
    url: '/prediction-markets.html',
    category: 'Topics',
    keywords: ['polymarket', 'decentralized', 'prediction', 'crypto', 'probability markets'],
  },
  {
    title: 'Rule 605 Execution Quality',
    description: 'SEC Rule 605 amendments expand reporting to larger broker-dealers. Compliance deadline August 1, 2026.',
    url: '/regulation.html',
    category: 'Topics',
    keywords: ['rule 605', 'execution quality', 'broker-dealer', 'order execution', 'nms plan', 'sec rule'],
  },
  {
    title: 'FINRA SLATE — Rule 10c-1a',
    description: 'Securities Lending and Transparency Engine — FINRA reporting system for securities loan transactions. Launched January 2, 2026.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['slate', 'finra', 'rule 10c-1a', 'securities lending', 'transparency engine', 'reporting'],
  },
  {
    title: 'CAT NMS Plan',
    description: 'Consolidated Audit Trail — tracking FINRA CAT reporting requirements, CAIS exemptive relief, and pending amendments to eliminate customer info reporting.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['cat', 'consolidated audit trail', 'cais', 'finra reporting', 'customer information', 'audit trail'],
  },
  {
    title: 'CME Google Cloud Migration',
    description: 'CME Globex migration to Google Cloud Chicago — preview phase launching 2026. Clients must plan iLink, Drop Copy, and MDP 3.0 IP migrations.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['cme', 'google cloud', 'globex', 'migration', 'cloud', 'ilink', 'drop copy', 'mdp 3.0'],
  },
  {
    title: 'MDP 3.0 Multicast — 10Gbps Requirement',
    description: 'CME Globex MDP 3.0 market data feed — 1Gbps connections no longer supported for multicast from March 2026. Firms must upgrade to 10Gbps.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['mdp 3.0', 'multicast', 'market data protocol', '1gbps', '10gbps', 'bandwidth', 'cme feed'],
  },
  {
    title: 'Regulation S-P Cybersecurity',
    description: 'SEC Regulation S-P amendments require written incident response programs. Smaller RIAs (under $1.5B AUM) must comply by June 3, 2026.',
    url: '/regulation.html',
    category: 'Topics',
    keywords: ['regulation s-p', 'safeguards rule', 'cybersecurity', 'ria', 'incident response', 'sec', 'compliance deadline'],
  },
  {
    title: 'NYSE Port Fees',
    description: 'NYSE filed SR-NYSE-2025-37 to increase MDC co-location port fees by up to 11.1%. First increase since 2017, effective October 2025.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['nyse', 'port fees', 'co-location', 'mdc', 'connectivity fees', 'sr-nyse-2025-37'],
  },
  {
    title: 'Nasdaq PHLX Technology Migration',
    description: 'Nasdaq PHLX technology infrastructure migration. SQF, FIX, OTTO port transitions with billing effective January 1, 2026.',
    url: '/calendar.html',
    category: 'Topics',
    keywords: ['nasdaq', 'phlx', 'sqf', 'fix', 'otto', 'port migration', 'technology migration', 'connectivity'],
  },
];

function score(item, terms) {
  let s = 0;
  const titleLow = (item.title || '').toLowerCase();
  const descLow = (item.description || '').toLowerCase();
  const kwLow = (item.keywords || []).map(k => k.toLowerCase());

  for (const term of terms) {
    if (titleLow === term) s += 20;
    else if (titleLow.startsWith(term)) s += 14;
    else if (titleLow.includes(term)) s += 10;

    if (descLow.includes(term)) s += 4;

    for (const kw of kwLow) {
      if (kw === term) s += 6;
      else if (kw.includes(term)) s += 3;
    }
  }
  return s;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const q = (event.queryStringParameters && event.queryStringParameters.q || '').trim();
  if (!q || q.length < 2) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify([]) };
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  // Search static index
  const staticResults = [...PAGE_INDEX, ...TOPIC_INDEX]
    .map(item => ({ ...item, relevanceScore: score(item, terms) }))
    .filter(item => item.relevanceScore > 0);

  // Search FeedWatch entries from Blobs
  let fwResults = [];
  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const data = await store.get('entries', { type: 'json' }).catch(() => []);
    const entries = Array.isArray(data) ? data : [];

    fwResults = entries
      .map(e => {
        const item = {
          title: e.title || '',
          description: e.description || '',
          url: `/calendar.html?filter=${encodeURIComponent((e.exchange || '').toLowerCase())}`,
          category: 'FeedWatch',
          keywords: [e.exchange || '', e.category || '', e.severity || '', e.effectiveDate || ''],
        };
        return { ...item, relevanceScore: score(item, terms) };
      })
      .filter(item => item.relevanceScore > 0);
  } catch (err) {
    console.warn('[search] FeedWatch load failed:', err.message);
  }

  const all = [...staticResults, ...fwResults]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 20)
    .map(({ keywords, ...rest }) => rest); // strip keywords from output

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(all),
  };
};
