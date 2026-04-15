// seed-feedwatch-april2026.js
// One-time function to add 10 new FeedWatch entries (April 2026)
// Call once via GET — checks for existing IDs to avoid duplicates

const { getStore } = require('@netlify/blobs');

const NEW_ENTRIES = [
  {
    id: 'FW-2026-039',
    exchange: 'CME Group',
    title: 'CME Globex End-of-Life Hub Equipment Replacement',
    description: 'CME Group replacing end-of-life network equipment supporting listed derivatives connectivity at CME Globex Hubs starting April 2026. Customers notified individually if impacted. Firms should review connectivity configurations and ensure contact information is current with their Global Account Manager.',
    effectiveDate: '2026-Q2',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260316.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-040',
    exchange: 'CME Group',
    title: 'CME Copper Handoff Support Ending — 2026 Connectivity Upgrade',
    description: 'As part of CME Globex connectivity upgrades in 2026, CME Group will no longer support copper handoffs. Firms using copper network connections to CME must migrate to fiber. Contact your Global Account Manager for timeline specifics.',
    effectiveDate: '2026-Q3',
    severity: 'HIGH',
    category: 'CONNECTIVITY',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260309.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-041',
    exchange: 'CME Group',
    title: 'CME MDP 3.0 New Multicast Channel 335 — Equity Index Expansion',
    description: 'CME Group launching new MDP 3.0 multicast group Channel ID 335 in first half of 2026 to support Equity Index and Alternative Products expansion. Firms receiving CME equity index market data must update firewall policies and network configurations before launch. Configuration details available via CME login.',
    effectiveDate: '2026-Q2',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260309.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-042',
    exchange: 'CME Group',
    title: 'CME MDP 3.0 New Multicast Channel 350 — Interest Rate Options',
    description: 'CME Group launching new MDP 3.0 multicast group Channel ID 350 in Q2 2026 for a new interest rate options product suite. Firms receiving CME interest rate market data must update network configurations and firewall rules. New Release testing available now.',
    effectiveDate: '2026-Q2',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/03/20260309.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-043',
    exchange: 'CME Group',
    title: 'CME CF Cryptocurrency Pricing Feed Channel 213 Launch',
    description: 'CME Group launched CME CF Cryptocurrency Pricing Market Data feed on Channel 213 in February 2026. Feed provides Nasdaq CME Crypto Settlement Price Index and Nasdaq CME Crypto Index published daily. Firms consuming CME crypto data should verify channel 213 is configured in feed handlers and firewall rules.',
    effectiveDate: '2026-02-02',
    severity: 'LOW',
    category: 'MILESTONE',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/01/20260119.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-044',
    exchange: 'FINRA',
    title: 'SR-FINRA-2026-007 New Issue Allocation Rule Amendment',
    description: 'FINRA filed SR-FINRA-2026-007 on April 10 2026 proposing to amend Rules 5130 and 5131 governing restrictions on purchase and sale of initial equity public offerings. Filing extends exemption to Collective Trust Funds meeting specific criteria. Comment period open until May 1 2026.',
    effectiveDate: '2026-05-01',
    severity: 'LOW',
    category: 'REGULATORY',
    link: 'https://www.federalregister.gov/documents/2026/04/10/2026-06929',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-045',
    exchange: 'FINRA',
    title: 'FINRA Daily Reserve Formula Computation Deadline Extended to June 2026',
    description: 'SEC extended compliance date to June 30 2026 for firms required to compute reserve formula daily under new SEC Rule 15c3-3(e)(3)(i)(B)(1). Firms required as of December 31 2025 now have until June 30 2026. Other firms may elect daily computation with 30 days prior notice to examining authority.',
    effectiveDate: '2026-06-30',
    severity: 'HIGH',
    category: 'REGULATORY',
    link: 'https://www.finra.org/rules-guidance/notices',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-046',
    exchange: 'FINRA',
    title: 'FINRA 2026 CAT Reporting Accuracy — Regulatory Oversight Priority',
    description: 'FINRA 2026 Regulatory Oversight Report identifies CAT reporting accuracy as top compliance priority. Findings include incomplete submissions, weak error correction, and insufficient oversight of third-party reporting agents. Firms should map internal records to CAT fields and review third-party CAT agent agreements.',
    effectiveDate: '2026-Q2',
    severity: 'MEDIUM',
    category: 'REGULATORY',
    link: 'https://www.finra.org/compliance-tools/weekly-archive/12102025',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-047',
    exchange: 'CME Group',
    title: 'CME Friday Holiday Trade Date Alignment Effective June 2026',
    description: 'Effective June 19 2026, CME Group aligning Globex and CME Clearing trade dates when Globex trade date falls on a Friday US holiday. All futures and options trades on Friday holidays reflect Globex trade date aligned to next valid Clearing House trade date. Firms must update trade date logic in order management and reporting systems.',
    effectiveDate: '2026-06-19',
    severity: 'MEDIUM',
    category: 'MILESTONE',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2026/01/20260126.html',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'FW-2026-048',
    exchange: 'SEC',
    title: 'Form SHO Short Position Reporting — Compliance Date January 2028',
    description: 'SEC provided temporary exemption from Rule 13f-2 and Form SHO short position reporting through January 2 2028. First Form SHO reports due within 14 calendar days after January 31 2028. Investment managers should begin assessing monthly whether gross short positions reach applicable reporting thresholds and prepare data infrastructure now.',
    effectiveDate: '2028-01-31',
    severity: 'MEDIUM',
    category: 'REGULATORY',
    link: 'https://www.daypitney.com/2026-annual-and-periodic-reporting-compliance-for-investment-managers',
    source: 'seed',
    addedAt: '2026-04-14T00:00:00.000Z',
  },
];

exports.handler = async function(event) {
  try {
    const store = getStore({
      name: 'feedwatch',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const existing = (await store.get('entries', { type: 'json' }).catch(() => [])) || [];
    const existingIds = new Set(existing.map(e => e.id));

    const toAdd = NEW_ENTRIES.filter(e => !existingIds.has(e.id));

    if (!toAdd.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'All entries already exist', skipped: NEW_ENTRIES.length }),
      };
    }

    const updated = [...toAdd, ...existing];
    await store.set('entries', JSON.stringify(updated));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        added: toAdd.length,
        ids: toAdd.map(e => e.id),
        total: updated.length,
      }),
    };
  } catch (err) {
    console.error('[seed-april2026] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
