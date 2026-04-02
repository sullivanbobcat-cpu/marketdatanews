// rule-filings.js
// GET /.netlify/functions/rule-filings

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  let liveFilings = [];

  try {
    // Federal Register API — SEC SRO filings filtered by SR- term
    const url =
      'https://www.federalregister.gov/api/v1/articles.json?' +
      'fields[]=title&fields[]=abstract&fields[]=publication_date&' +
      'fields[]=document_number&fields[]=html_url&fields[]=comments_close_on&' +
      'fields[]=comment_url&fields[]=docket_ids&' +
      'per_page=40&order=newest&' +
      'agencies[]=securities-and-exchange-commission&' +
      'conditions[term]=SR-';

    const r = await fetch(url, {
      headers: { 'User-Agent': 'marketdatanews.com/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (r.ok) {
      const d = await r.json();
      liveFilings = (d.results || []).map((f) => {
        // Extract file number from title
        const match = (f.title || '').match(/SR-[A-Z0-9a-z]+-\d{4}-\d+/);
        const fileNumber = match ? match[0] : '';
        const exchange = fileNumber ? fileNumber.split('-')[1] || 'OTHER' : 'OTHER';

        // Determine relevance
        const combined = ((f.title || '') + ' ' + (f.abstract || '')).toLowerCase();
        let relevance = 'LOW';
        if (
          ['market data', 'connectivity', 'fee', 'port fee', 'co-location', 'colocation',
           'data feed', 'trading hours', 'mdp', 'itch', 'pillar', 'sip', 'nms plan',
           'co-lo', 'data dissemination', 'consolidated tape'].some((k) => combined.includes(k))
        ) {
          relevance = 'HIGH';
        } else if (
          ['proposed rule', 'immediate effectiveness', 'rule change', 'fee schedule'].some((k) =>
            combined.includes(k)
          )
        ) {
          relevance = 'MEDIUM';
        }

        // Comment status
        const commentsClose = f.comments_close_on ? new Date(f.comments_close_on) : null;
        const isOpenForComment = !!(commentsClose && commentsClose > new Date());
        const daysUntilClose = isOpenForComment
          ? Math.ceil((commentsClose - new Date()) / (1000 * 60 * 60 * 24))
          : 0;

        return {
          title: f.title || '',
          abstract: f.abstract || '',
          publication_date: f.publication_date || '',
          document_number: f.document_number || '',
          html_url: f.html_url || '',
          comments_close_on: f.comments_close_on || null,
          is_open_for_comment: isOpenForComment,
          days_until_close: daysUntilClose,
          file_number: fileNumber,
          exchange: exchange,
          relevance: relevance,
          source: 'federal_register',
        };
      });
    } else {
      console.error('Federal Register API returned', r.status);
    }
  } catch (e) {
    console.error('Federal Register fetch failed:', e.message);
  }

  // Merge live + seeded, dedup by file_number
  const seeded = getSeededFilings();
  const liveNumbers = new Set(liveFilings.map((f) => f.file_number).filter(Boolean));
  const combined = [
    ...liveFilings,
    ...seeded.filter((f) => !liveNumbers.has(f.file_number)),
  ].sort((a, b) => new Date(b.publication_date) - new Date(a.publication_date));

  return {
    statusCode: 200,
    headers: { ...headers, 'Cache-Control': 'public, max-age=600' },
    body: JSON.stringify({
      filings: combined,
      live_count: liveFilings.length,
      seeded_count: seeded.length,
      fetched_at: new Date().toISOString(),
    }),
  };
};

function getSeededFilings() {
  return [
    {
      title: 'Self-Regulatory Organizations; NYSE Arca, Inc.; Notice of Filing and Immediate Effectiveness of Proposed Rule Change to Amend the NYSE Arca Equities Fees and Credits Schedule',
      abstract: 'NYSE Arca filed a proposed rule change to amend its Equities Fees and Credits Schedule relating to co-location services and market data port fees at the NYSE data center. The changes affect monthly recurring fees for co-location connectivity.',
      publication_date: '2026-03-28',
      document_number: '2026-06891',
      html_url: 'https://www.federalregister.gov/documents/2026/03/28',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NYSEArca-2026-18',
      exchange: 'NYSEArca',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Filing and Immediate Effectiveness of Proposed Rule Change to Amend Options 7 Relating to Market Data Fees',
      abstract: 'Nasdaq filed a proposed rule change to amend its fee schedule relating to market data fees for Nasdaq TotalView and Nasdaq Basic. The filing modifies professional user fees and machine-readable data fees effective February 2026.',
      publication_date: '2026-02-17',
      document_number: '2026-03018',
      html_url: 'https://www.federalregister.gov/documents/2026/02/17/2026-03018',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NASDAQ-2026-006',
      exchange: 'NASDAQ',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; NYSE; Notice of Filing of Proposed Rule Change to Extend Trading Hours to 22 Hours Per Day',
      abstract: 'NYSE filed a proposed rule change to extend its trading session to 22 hours per day to compete with 24X National Exchange and Nasdaq extended hours proposals. The filing has significant implications for market data feed infrastructure, requiring continuous feed handler operations and SIP connectivity outside standard hours.',
      publication_date: '2026-03-15',
      document_number: '2026-05442',
      html_url: 'https://www.federalregister.gov/documents/2026/03/15',
      comments_close_on: '2026-04-15',
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NYSE-2026-11',
      exchange: 'NYSE',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Cboe BZX Exchange; Notice of Filing and Immediate Effectiveness of Proposed Rule Change to Amend BZX Rule 11.22 Relating to Market Data',
      abstract: 'Cboe BZX filed a proposed rule change to amend its market data rules relating to the distribution of BZX depth of book data. The filing modifies requirements for professional subscribers and non-display use of BZX PITCH data.',
      publication_date: '2026-03-10',
      document_number: '2026-04891',
      html_url: 'https://www.federalregister.gov/documents/2026/03/10',
      comments_close_on: '2026-04-10',
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-CboeBZX-2026-014',
      exchange: 'CboeBZX',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Financial Industry Regulatory Authority; Notice of Filing of Proposed Rule Change to Amend FINRA Rule 6830 Relating to CAT Reporting',
      abstract: 'FINRA filed a proposed rule change to amend Rule 6830 to require CAT reporting of reliance on the Bona Fide Market Making Locate Exception under Regulation SHO. Firms engaged in bona fide market making must record and report to the Central Repository when the BFMM Locate Exception is claimed.',
      publication_date: '2025-12-31',
      document_number: '2025-24048',
      html_url: 'https://www.federalregister.gov/documents/2025/12/31/2025-24048',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-FINRA-2025-016',
      exchange: 'FINRA',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; NYSE; Notice of Filing and Immediate Effectiveness of Proposed Rule Change to Increase Port Fees for MDC Co-location Connectivity',
      abstract: 'NYSE filed SR-NYSE-2025-37 to increase monthly recurring port fees for co-location hall connections at the MDC by up to 11.1%, based on Data PPI inflation tracking. First fee increase since 2017. Applies to NYSE, NYSE American, NYSE Arca, NYSE National, and NYSE Texas.',
      publication_date: '2025-09-30',
      document_number: '2025-18952',
      html_url: 'https://www.federalregister.gov/documents/2025/09/30/2025-18952',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NYSE-2025-37',
      exchange: 'NYSE',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Nasdaq PHLX LLC; Notice of Filing and Immediate Effectiveness of Proposed Rule Change Relating to PHLX Technology Migration — SQF and FIX Port Transition',
      abstract: 'Nasdaq PHLX filed a proposed rule change relating to its technology infrastructure migration. During the transition period, members can acquire duplicate SQF Ports, SQF Purge Ports, and CTI Ports at no additional cost. New OTTO and FIX Drop Port fees apply from November 1 2025.',
      publication_date: '2025-08-04',
      document_number: '2025-14674',
      html_url: 'https://www.federalregister.gov/documents/2025/08/04/2025-14674',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-Phlx-2025-41',
      exchange: 'PHLX',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Options Price Reporting Authority; Notice of Filing of Proposed Amendment to Modify OPRA Fee Schedule Regarding Port Fee Caps',
      abstract: 'OPRA filed a proposed amendment to modify its fee schedule regarding caps on port fees. The SEC instituted proceedings to determine whether to approve or disapprove the amendment. The filing relates to connectivity fees charged to market data recipients accessing the OPRA consolidated options feed.',
      publication_date: '2025-06-15',
      document_number: '2025-11203',
      html_url: 'https://www.federalregister.gov/documents/2025/06/15',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-OPRA-2025-02',
      exchange: 'OPRA',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Filing of Proposed Rule Change to Extend US Equities Trading Hours to 23 Hours Per Day Five Days Per Week',
      abstract: 'Nasdaq filed a proposed rule change to extend trading to 23 hours per day five days per week with a Night Session from 8pm to 4am ET. The filing has major implications for market data infrastructure — feed handlers must operate continuously, SIP connectivity required outside standard hours, and firms must review their market data agreements for extended hours coverage.',
      publication_date: '2026-01-13',
      document_number: '2026-00416',
      html_url: 'https://www.federalregister.gov/documents/2026/01/13/2026-00416',
      comments_close_on: '2026-04-20',
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NASDAQ-2025-109',
      exchange: 'NASDAQ',
      relevance: 'HIGH',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Cboe Exchange Inc; Notice of Filing of Proposed Rule Change to Adopt Fees for Trading Options on MSCI Indexes',
      abstract: 'Cboe filed a proposed rule change to adopt fees for trading in options overlying MSCI indexes including MSCI EAFE, MSCI Emerging Markets, MSCI World, and MSCI ACWI. The filing adds new market data distribution requirements for index options data.',
      publication_date: '2026-03-26',
      document_number: '2026-06712',
      html_url: 'https://www.federalregister.gov/documents/2026/03/26',
      comments_close_on: '2026-04-25',
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-CBOE-2026-023',
      exchange: 'CBOE',
      relevance: 'MEDIUM',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Nasdaq BX Inc; Notice of Filing of Amendment and Order Granting Accelerated Approval to Remove Existing Listing Rules and Establish New Listing Standards for Nasdaq Texas',
      abstract: 'Nasdaq BX filed amendments to remove existing listing rules and establish new listing standards as Nasdaq Texas. The new exchange listing standards affect how securities symbols are reserved and traded, with implications for market data feed symbology and SIP reporting.',
      publication_date: '2026-03-04',
      document_number: '2026-04224',
      html_url: 'https://www.federalregister.gov/documents/2026/03/04/2026-04224',
      comments_close_on: null,
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-BX-2026-004',
      exchange: 'NASDAQ',
      relevance: 'MEDIUM',
      source: 'seeded',
    },
    {
      title: 'Self-Regulatory Organizations; Nasdaq Stock Market LLC; Notice of Filing of Proposed Rule Change to Enable Trading of Securities in Tokenized Form',
      abstract: 'Nasdaq filed a proposed rule change to amend its rules to enable trading of securities on the exchange in tokenized form using distributed ledger technology. The filing raises novel questions about market data dissemination, SIP reporting, and connectivity requirements for tokenized securities.',
      publication_date: '2026-01-30',
      document_number: '2026-01823',
      html_url: 'https://www.federalregister.gov/documents/2026/01/30/2026-01823',
      comments_close_on: '2026-04-18',
      is_open_for_comment: false,
      days_until_close: 0,
      file_number: 'SR-NASDAQ-2025-072',
      exchange: 'NASDAQ',
      relevance: 'MEDIUM',
      source: 'seeded',
    },
  ];
}
