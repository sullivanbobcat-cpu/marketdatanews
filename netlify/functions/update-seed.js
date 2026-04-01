const { getStore } = require('@netlify/blobs');

const NEW_ENTRIES = [
  {
    id: 'FW-2026-021',
    exchange: 'CME Group',
    title: 'CME iLink Version 8 Messages Sunset — April 24 2026 Deadline',
    description: 'CME Globex completed iLink SBE Schema v9 launch February 22. Client systems can send v8 or v9 until April 24 2026 after which ONLY version 9 messages accepted. Firms still sending v8 must migrate immediately.',
    effectiveDate: '2026-04-24',
    announcedDate: '2026-02-23',
    severity: 'CRITICAL',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/02/20260223.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-022',
    exchange: 'CME Group',
    title: 'CME STP FIX API — Mandatory Google Cloud Migration by April 26 2026',
    description: 'All clients must complete migration and connect to CME STP FIX API Production using only Google Cloud hostnames by April 26 2026. On-prem instance will be decommissioned. Mandatory supplemental certification for message recovery required.',
    effectiveDate: '2026-04-26',
    announcedDate: '2026-01-26',
    severity: 'CRITICAL',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/01/20260126.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-023',
    exchange: 'CME Group',
    title: 'CME Mass Quote Protection Session Linking — Q2 2026 Launch',
    description: 'CME Group introducing new Mass Quote Protection MQP Session Linking for all CME Globex options on futures in Q2 2026. Links multiple iLink sessions under same GFID. When MQP event triggered protection actions extend across all linked sessions. Customer testing begins April 2 in New Release.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-03-16',
    severity: 'MEDIUM',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260316.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-024',
    exchange: 'CME Group',
    title: 'CME Single Stock Futures Launch — New Market Segment Gateway Required',
    description: 'Pending regulatory review CME Group will list Single Stock Futures SSF for select publicly listed companies on CME Globex and CME Direct. New Market Segment Gateway and Drop Copy Gateway Service introduced. Firms must review client impact assessment and plan new connectivity.',
    effectiveDate: '2026-TBD',
    announcedDate: '2026-03-16',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260316.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-025',
    exchange: 'CME Group',
    title: 'CME Globex Google Cloud Sandbox Testing — Client Onboarding Open',
    description: 'Client testing beginning in new CME Globex on Google Cloud Sandbox environment in Google Cloud Dallas Region ultra low latency zones. Production readiness checklist and onboarding process available in Client Systems Wiki. All firms planning Google Cloud connectivity should begin onboarding now.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-03-16',
    severity: 'HIGH',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260316.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-026',
    exchange: 'CME Group',
    title: 'CME Cryptocurrency Futures Expansion to 24/7 Trading — May 29 2026',
    description: 'Starting 4pm CT Friday May 29 CME Group expanding Cryptocurrency futures and options to 24/7 trading pending regulatory review. Continuous trading on CME Globex with minimum two-hour weekly maintenance window. Holiday and weekend trades reflect following business day trade date. Feed handlers must be active 24/7 for affected channels.',
    effectiveDate: '2026-05-29',
    announcedDate: '2026-02-23',
    severity: 'HIGH',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/02/20260223.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-027',
    exchange: 'CME Group',
    title: 'New MDP 3.0 Multicast Channel ID 350 — Interest Rate Options Q2 2026',
    description: 'CME Group launching new market data multicast group for interest rate options asset class in Q2 2026 using MDP 3.0 Channel ID 350. Firms must update firewall policies and network configurations. Configuration details available via CME Group login.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-03-02',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260302.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-028',
    exchange: 'CME Group',
    title: 'CME Globex Friday Holiday Trade Date Alignment — June 19 2026',
    description: 'Effective June 19 2026 CME Group implementing change to align CME Globex and CME Clearing trade dates when Globex trade date falls on Friday US holiday. All futures and options trades on Friday holidays reflect Globex trade date aligned to next valid Clearing House trade date. Review client impact assessment for full technical details.',
    effectiveDate: '2026-06-19',
    announcedDate: '2026-01-26',
    severity: 'LOW',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/01/20260126.html',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-029',
    exchange: 'ICE',
    title: 'ICE Endex — European Natural Gas Hub Migration Post Iran War Supply Disruption',
    description: 'ICE Endex implementing emergency feed configuration updates following Iran war disruption to European LNG supplies. Market data volumes for TTF Natural Gas futures have increased 340% since February 28. Firms receiving ICE Endex feeds should verify capacity and connection stability. ICE has extended trading hours for key energy contracts.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-03-01',
    severity: 'HIGH',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.theice.com/market-data',
    addedAt: '2026-04-01',
  },
  {
    id: 'FW-2026-030',
    exchange: 'CFTC',
    title: 'CFTC Prediction Markets ANPRM — Comment Period Open Until May 2026',
    description: 'CFTC issued Advance Notice of Proposed Rulemaking March 12 2026 seeking public comment on event contract regulation. DCMs must review Advisory 26-08 on manipulation resistance surveillance and enforcement. Comment period open — firms with prediction market exposure should participate. Final rules expected Q3-Q4 2026.',
    effectiveDate: '2026-05-01',
    announcedDate: '2026-03-12',
    severity: 'MEDIUM',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cftc.gov/PressRoom/PressReleases/9185-26',
    addedAt: '2026-04-01',
  },
];

exports.handler = async function(event) {
  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const existing = await store.get('entries', { type: 'json' }).catch(() => []);
    const existingEntries = Array.isArray(existing) ? existing : [];
    const existingIds = new Set(existingEntries.map(e => e.id));

    const fresh = NEW_ENTRIES.filter(e => !existingIds.has(e.id));
    const merged = [...existingEntries, ...fresh];
    await store.set('entries', JSON.stringify(merged));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        added: fresh.length,
        skipped: NEW_ENTRIES.length - fresh.length,
        total: merged.length,
      }),
    };
  } catch (err) {
    console.error('[update-seed] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
