const { getStore } = require('@netlify/blobs');

const NEW_ENTRIES = [
  {
    id: 'FW-2026-031',
    exchange: 'NYSE',
    title: 'NYSE Pillar Technology Migration — NYSE American Equities Phase 2',
    description: 'NYSE American Equities will complete Pillar technology migration Phase 2 in Q2 2026. Firms must migrate all remaining legacy connectivity to Pillar-based ports. Updated Binary Gateway (BG) and Disaster Recovery (DR) configurations required. Legacy co-lo connectivity for NYSE American will be decommissioned. Market data feed handlers consuming NYSE American Direct Edge feeds must validate Pillar format compatibility.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-01-15',
    severity: 'HIGH',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.nyse.com/trader-update/history',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-032',
    exchange: 'OPRA',
    title: 'OPRA Capacity Increase — New Multicast Line Rate Upgrade (Q2 2026)',
    description: 'OPRA will increase options market data multicast line rates in Q2 2026 to accommodate expanding options volume. Firms receiving OPRA feeds must verify that their network infrastructure and feed handlers can sustain the higher throughput. OPRA announced peak data rates now routinely exceed 20 million messages per second. Connectivity providers must confirm bandwidth availability with OPRA before the cutover.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-02-01',
    severity: 'HIGH',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.opradata.com/specs/technical_specifications.jsp',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-033',
    exchange: 'Nasdaq',
    title: 'Nasdaq TotalView-ITCH 5.0 Deprecation — Migration to ITCH 5.1 Required',
    description: 'Nasdaq will deprecate TotalView-ITCH 5.0 and require all subscribers to migrate to ITCH 5.1 by July 1, 2026. ITCH 5.1 includes new message types for retail liquidity indicators and extended auction information. Firms running TotalView-based feed handlers must update parsers and validate new message handling. Testing available in Nasdaq\'s Global Select Market test environment.',
    effectiveDate: '2026-07-01',
    announcedDate: '2026-01-20',
    severity: 'HIGH',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.nasdaqtrader.com/TraderNews.aspx?id=dpspecs',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-034',
    exchange: 'SEC',
    title: 'CAT NMS Plan — Large Trader ID (LTID) Validation Enhancement Effective June 2026',
    description: 'CAT LLC implementing enhanced LTID validation rules in June 2026. Industry Members must ensure all order events link valid Large Trader IDs for accounts meeting 13H reporting thresholds. CAT will begin rejecting submissions with invalid or missing LTIDs for in-scope accounts. Firms should audit their LTID assignment workflows and confirm data flows from 13H registrations into order routing systems.',
    effectiveDate: '2026-06-01',
    announcedDate: '2026-02-10',
    severity: 'MEDIUM',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://catnmsplan.com/technical-specifications',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-035',
    exchange: 'CBOE',
    title: 'CBOE Options Exchange — New Multicast Top of Book Feed (CTB) Launch',
    description: 'CBOE Global Markets launching a new Cboe Top of Book (CTB) multicast feed for CBOE Options Exchange in Q2 2026. CTB provides best bid/offer data at lower bandwidth than existing full depth feeds. Firms consuming CBOE options data should evaluate CTB for applications requiring lower-latency best-quote data. Full technical specifications available on Cboe\'s developer portal.',
    effectiveDate: '2026-Q2',
    announcedDate: '2026-03-01',
    severity: 'LOW',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.cboe.com/us/options/market_statistics/market_data/',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-036',
    exchange: 'CME Group',
    title: 'CME Globex: MDP 3.0 Channel ID 335 Launch — Second New Equity Index Multicast Group',
    description: 'CME Group will launch the second new MDP 3.0 multicast group Channel ID 335 for the Equity Indices and Alternative Products asset class in H1 2026. This follows the earlier Channel ID 324 launch. Firms must update firewall allow-lists and network configurations. Feed handlers should be configured to subscribe to Channel 335 sessions prior to production launch to avoid missing market data.',
    effectiveDate: '2026-Q2',
    announcedDate: '2025-12-29',
    severity: 'MEDIUM',
    category: 'CONNECTIVITY',
    source: 'seed',
    link: 'https://www.cmegroup.com/notices/electronic-trading/2025/12/20251229.html',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-037',
    exchange: 'FINRA',
    title: 'FINRA TRACE — Treasury Reporting Phase 3 Expansion (July 2026)',
    description: 'FINRA TRACE Treasury reporting requirements expand in July 2026 to include additional categories of US Treasury securities under SEC Rule 6730 amendments. Broker-dealers not currently reporting all Treasury transactions must update TRACE reporting systems and testing. FINRA issued Regulatory Notice 26-05 with full technical specifications. Firms should review TRACE FIX specifications and validate Treasury product mappings.',
    effectiveDate: '2026-07-15',
    announcedDate: '2026-01-30',
    severity: 'MEDIUM',
    category: 'MILESTONE',
    source: 'seed',
    link: 'https://www.finra.org/filing-reporting/trace',
    addedAt: '2026-04-08',
  },
  {
    id: 'FW-2026-038',
    exchange: 'ICE',
    title: 'ICE Data Services — Consolidated Tape Feed Restructuring (Pending SEC Approval)',
    description: 'ICE Data Services has filed proposed changes to its consolidated tape data redistribution licensing structure pending SEC approval. Changes would modify per-subscriber fee tiers for firms redistributing CTA and UTP SIP data. If approved, new fee schedules take effect Q3 2026. Market data managers at broker-dealers and vendors should monitor SEC docket for approval order and plan for potential fee impact on redistribution agreements.',
    effectiveDate: '2026-Q3',
    announcedDate: '2026-03-20',
    severity: 'MEDIUM',
    category: 'FEE',
    source: 'seed',
    link: 'https://www.sec.gov/litigation/sros.shtml',
    addedAt: '2026-04-08',
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
    console.error('[add-feedwatch-entries] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
