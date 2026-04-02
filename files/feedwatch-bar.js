(function () {
  'use strict';

  var CACHE_KEY = 'mdn_feedwatch_bar';
  var CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmtDate(dateStr) {
    // dateStr is YYYY-MM-DD
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    return MONTHS[m] + ' ' + d + ', ' + y;
  }

  function isRealDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    // Only accept YYYY-MM-DD format — skip Q1/Q2/TBD etc.
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  }

  function parseDate(dateStr) {
    var parts = dateStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max).trimEnd() + '…' : str;
  }

  function updateBar(entries) {
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    var ninety = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // Count badges
    var critical = 0, high = 0, action = 0;
    entries.forEach(function (e) {
      var sev = (e.severity || '').toUpperCase();
      if (sev === 'CRITICAL') critical++;
      if (sev === 'HIGH') high++;
      // action required: real upcoming date within 90 days
      if (isRealDate(e.effectiveDate)) {
        var d = parseDate(e.effectiveDate);
        if (d >= now && d <= ninety) action++;
      }
    });

    // Next upcoming deadline — real dates only, in the future
    var upcoming = entries.filter(function (e) {
      if (!isRealDate(e.effectiveDate)) return false;
      var d = parseDate(e.effectiveDate);
      return d >= now;
    });

    upcoming.sort(function (a, b) {
      return parseDate(a.effectiveDate) - parseDate(b.effectiveDate);
    });

    var next = upcoming[0];

    // Update DOM
    var elCritical = document.getElementById('fw-critical-count');
    var elHigh     = document.getElementById('fw-high-count');
    var elAction   = document.getElementById('fw-action-count');
    var elActive   = document.getElementById('fw-active-count');
    var elNext     = document.getElementById('fw-next-deadline');

    if (elCritical) elCritical.textContent = critical;
    if (elHigh)     elHigh.textContent = high;
    if (elAction)   elAction.textContent = action;
    if (elActive)   elActive.textContent = entries.length;

    if (elNext && next) {
      var exchange = next.exchange || '';
      // Shorten common exchange names
      var shortEx = exchange.replace('CME Group', 'CME').replace('Nasdaq', 'Nasdaq')
                            .replace('NYSE', 'NYSE').replace('Cboe', 'Cboe').replace('ICE', 'ICE');
      var title = truncate(next.title || '', 40);
      elNext.textContent = shortEx + ' — ' + title + ' — ' + fmtDate(next.effectiveDate);
    }
  }

  function loadAndUpdate() {
    // Check session cache
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        var obj = JSON.parse(cached);
        if (obj && obj.ts && (Date.now() - obj.ts < CACHE_TTL) && Array.isArray(obj.entries)) {
          updateBar(obj.entries);
          return;
        }
      }
    } catch (e) { /* ignore storage errors */ }

    fetch('/.netlify/functions/get-feedwatch')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var entries = Array.isArray(data.entries) ? data.entries : [];
        // Cache result
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), entries: entries }));
        } catch (e) { /* ignore */ }
        updateBar(entries);
      })
      .catch(function () { /* silently fail — keep static fallback values */ });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndUpdate);
  } else {
    loadAndUpdate();
  }
})();
