const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / 86400000);
}

function statusLabel(contract) {
  const d = daysUntil(contract.renewalDate);
  if (d === null) return 'UNKNOWN';
  if (d < 0) return 'EXPIRED';
  if (d <= 90) return 'RENEWING SOON';
  return 'ACTIVE';
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const contracts = Array.isArray(body.contracts) ? body.contracts : [];
  const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const totalSpend = contracts.reduce((s, c) => s + (Number(c.monthlyFee) * 12 || 0), 0);
  const activeCount = contracts.filter(c => statusLabel(c) !== 'EXPIRED').length;
  const renewingSoon = contracts.filter(c => { const d = daysUntil(c.renewalDate); return d !== null && d >= 0 && d <= 90; });

  // Spend by exchange
  const byExchange = {};
  contracts.forEach(c => {
    const ex = c.exchange || 'Other';
    byExchange[ex] = (byExchange[ex] || 0) + (Number(c.monthlyFee) * 12 || 0);
  });
  const exchangeEntries = Object.entries(byExchange).sort((a, b) => b[1] - a[1]);
  const maxSpend = exchangeEntries[0]?.[1] || 1;

  // Renewal calendar: next 12 months
  const upcoming12 = contracts
    .filter(c => { const d = daysUntil(c.renewalDate); return d !== null && d >= 0 && d <= 365; })
    .sort((a, b) => new Date(a.renewalDate) - new Date(b.renewalDate));

  // Build bar chart SVG rows
  const barRows = exchangeEntries.map(([ex, spend]) => {
    const pct = Math.round((spend / maxSpend) * 100);
    return `<tr>
      <td style="padding:6px 12px 6px 0;font-size:12px;font-family:'IBM Plex Sans',sans-serif;white-space:nowrap;width:140px">${ex}</td>
      <td style="padding:6px 0;width:100%">
        <div style="height:20px;background:#b8860b;width:${pct}%;border-radius:2px;min-width:4px"></div>
      </td>
      <td style="padding:6px 0 6px 12px;font-size:12px;font-family:'IBM Plex Mono',monospace;white-space:nowrap;text-align:right">${fmt(spend)}</td>
    </tr>`;
  }).join('');

  // Renewal calendar rows
  const calRows = upcoming12.map(c => {
    const d = daysUntil(c.renewalDate);
    const color = d <= 90 ? '#c0392b' : d <= 180 ? '#e67e22' : '#2e7d32';
    return `<tr>
      <td style="padding:7px 12px 7px 0;font-size:12px;font-family:'IBM Plex Sans',sans-serif">${c.productName || '—'}</td>
      <td style="padding:7px 12px 7px 0;font-size:12px;font-family:'IBM Plex Mono',monospace">${c.exchange || '—'}</td>
      <td style="padding:7px 12px 7px 0;font-size:12px;font-family:'IBM Plex Mono',monospace">${c.renewalDate || '—'}</td>
      <td style="padding:7px 12px 7px 0;font-size:12px;font-family:'IBM Plex Mono',monospace;color:${color};font-weight:600">${d} days</td>
      <td style="padding:7px 0;font-size:12px;font-family:'IBM Plex Mono',monospace;text-align:right">${fmt(Number(c.monthlyFee || 0) * 12)}/yr</td>
    </tr>`;
  }).join('');

  // Compliance summary
  const COMPLIANCE = {
    NYSE: ['Annual attestation required', 'Usage reporting quarterly', 'Audit rights clause', '90-day termination notice'],
    Nasdaq: ['Annual certification', 'Monthly usage reports for professional users', 'External distributor agreements required', '60-day termination notice'],
    Cboe: ['Annual usage declaration', 'Quarterly professional user counts', 'Sub-distributor agreements required', '30-day termination notice'],
    OPRA: ['Annual subscriber certification', 'Monthly options volume reporting', 'Vendor of record designation required'],
    CME: ['Annual market data audit', 'Usage reporting for automated systems', 'Derived data restrictions apply'],
    ICE: ['Annual renewal review', 'Usage reporting required', '30-day termination notice'],
  };

  const contractExchanges = [...new Set(contracts.map(c => c.exchange).filter(Boolean))];
  const compRows = contractExchanges.flatMap(ex => {
    const items = COMPLIANCE[ex] || ['Review contract terms for compliance requirements'];
    return items.map(item => `<tr>
      <td style="padding:6px 12px 6px 0;font-size:12px;font-family:'IBM Plex Mono',monospace;white-space:nowrap">${ex}</td>
      <td style="padding:6px 0;font-size:12px;font-family:'IBM Plex Sans',sans-serif">${item}</td>
    </tr>`);
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Market Data Contract Intelligence — CFO Report ${reportDate}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #f5f2eb; color: #0d0d0d; font-family: 'IBM Plex Sans', sans-serif; padding: 0; }
  .report-header { background: #0d0d0d; color: white; padding: 40px 64px; }
  .report-brand { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 900; color: #b8860b; margin-bottom: 8px; }
  .report-title { font-family: 'Playfair Display', serif; font-size: 36px; font-weight: 900; line-height: 1.15; margin-bottom: 8px; }
  .report-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #666; letter-spacing: 0.08em; }
  .report-body { max-width: 900px; margin: 0 auto; padding: 48px 64px; }
  .section { margin-bottom: 48px; }
  .section-title { font-family: 'IBM Plex Sans', sans-serif; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #b8860b; border-bottom: 2px solid #0d0d0d; padding-bottom: 8px; margin-bottom: 20px; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .kpi { background: white; border: 1px solid #d4c9b0; border-radius: 4px; padding: 16px; }
  .kpi-val { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 900; color: #0d0d0d; }
  .kpi-val.gold { color: #b8860b; }
  .kpi-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #6b6555; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
  .exec-summary { background: white; border: 1px solid #d4c9b0; border-radius: 4px; padding: 20px 24px; font-size: 14px; line-height: 1.7; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  th { font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6555; text-align: left; padding-bottom: 8px; border-bottom: 1px solid #d4c9b0; }
  tr { border-bottom: 1px solid #e8e0d0; }
  .report-footer { background: #0d0d0d; color: #555; padding: 24px 64px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; display: flex; justify-content: space-between; margin-top: 48px; }
  .bar-table { width: 100%; border-collapse: collapse; }
  .no-data { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #aaa; padding: 16px 0; }
  @media print { .report-header, .report-footer { background: #0d0d0d !important; } }
</style>
</head>
<body>
<div class="report-header">
  <div class="report-brand">Market Data <span style="color:white">News</span></div>
  <div class="report-title">CFO Market Data Report</div>
  <div class="report-meta">GENERATED ${reportDate.toUpperCase()} &nbsp;·&nbsp; CONFIDENTIAL &nbsp;·&nbsp; MARKET DATA CONTRACT INTELLIGENCE</div>
</div>

<div class="report-body">

  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val">${contracts.length}</div><div class="kpi-label">Total Agreements</div></div>
      <div class="kpi"><div class="kpi-val">${activeCount}</div><div class="kpi-label">Active Contracts</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#e67e22">${renewingSoon.length}</div><div class="kpi-label">Renewing &lt;90 Days</div></div>
      <div class="kpi"><div class="kpi-val gold">${fmt(totalSpend)}</div><div class="kpi-label">Total Annual Spend</div></div>
    </div>
    <div class="exec-summary">
      Your organization holds <strong>${contracts.length} market data agreement${contracts.length !== 1 ? 's' : ''}</strong> with a combined annual spend of <strong>${fmt(totalSpend)}</strong>.
      ${activeCount} contract${activeCount !== 1 ? 's' : ''} ${activeCount !== 1 ? 'are' : 'is'} currently active.
      ${renewingSoon.length > 0
        ? `<strong style="color:#c0392b">${renewingSoon.length} contract${renewingSoon.length !== 1 ? 's require' : ' requires'} immediate attention</strong> with renewal deadlines within 90 days: ${renewingSoon.map(c => c.productName || c.exchange).join(', ')}.`
        : 'No contracts are renewing within the next 90 days.'}
      ${exchangeEntries.length > 0
        ? ` The largest spend is with <strong>${exchangeEntries[0][0]}</strong> at <strong>${fmt(exchangeEntries[0][1])}/year</strong>.`
        : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Cost Breakdown by Exchange</div>
    ${exchangeEntries.length > 0
      ? `<table class="bar-table"><tbody>${barRows}</tbody></table>`
      : '<div class="no-data">No contract data available.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Renewal Calendar — Next 12 Months</div>
    ${upcoming12.length > 0
      ? `<table><thead><tr><th>Product</th><th>Exchange</th><th>Renewal Date</th><th>Days Remaining</th><th style="text-align:right">Annual Cost</th></tr></thead><tbody>${calRows}</tbody></table>`
      : '<div class="no-data">No contracts renewing in the next 12 months.</div>'}
  </div>

  <div class="section">
    <div class="section-title">Cost Optimization Opportunities</div>
    <div class="exec-summary">
      ${contracts.length === 0
        ? 'Add contracts to identify optimization opportunities.'
        : (() => {
            const tips = [];
            const highSpend = contracts.filter(c => Number(c.monthlyFee) * 12 > 50000);
            if (highSpend.length) tips.push(`<strong>${highSpend.length} product${highSpend.length !== 1 ? 's' : ''}</strong> exceed $50,000/year — review whether Indirect access could reduce costs.`);
            const directContracts = contracts.filter(c => c.accessType === 'Direct');
            if (directContracts.length > 1) tips.push(`<strong>${directContracts.length} Direct access agreements</strong> detected — consolidating to a single venue or co-location may reduce connectivity costs.`);
            const noAutoRenewal = contracts.filter(c => c.autoRenewal === 'yes' || c.autoRenewal === true);
            if (noAutoRenewal.length) tips.push(`<strong>${noAutoRenewal.length} contract${noAutoRenewal.length !== 1 ? 's have' : ' has'} auto-renewal enabled</strong> — ensure notice periods are calendared to preserve renegotiation leverage.`);
            if (!tips.length) tips.push('No immediate optimization opportunities identified based on current contract data.');
            return '<ul style="padding-left:20px;line-height:2">' + tips.map(t => `<li>${t}</li>`).join('') + '</ul>';
          })()
      }
    </div>
  </div>

  <div class="section">
    <div class="section-title">Compliance Status</div>
    ${compRows
      ? `<table><thead><tr><th>Exchange</th><th>Requirement</th></tr></thead><tbody>${compRows}</tbody></table>`
      : '<div class="no-data">No exchanges found in contracts. Add contracts to see compliance requirements.</div>'}
  </div>

</div>

<div class="report-footer">
  <span>© 2026 MarketDataNews.com — For market data professionals</span>
  <span>Generated by Market Data Contract Intelligence</span>
</div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ html }),
  };
};
