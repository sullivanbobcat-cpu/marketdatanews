(function () {
  var MIN_Q = 3;
  var debounceTimer = null;
  var activeIndex = -1;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    var box = document.getElementById('searchBox');
    var drop = document.getElementById('searchDrop');
    var wrap = document.getElementById('searchWrap');
    if (!box || !drop) return;

    // Remove any legacy oninput that might conflict
    box.removeAttribute('oninput');

    box.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var q = box.value.trim();
      if (q.length < MIN_Q) { close(drop); return; }
      debounceTimer = setTimeout(function () { doSearch(q, drop); }, 220);
    });

    box.addEventListener('keydown', function (e) {
      var items = drop.querySelectorAll('.search-drop-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        updateActive(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex] && items[activeIndex].dataset.url) {
          window.location.href = items[activeIndex].dataset.url;
        } else if (box.value.trim()) {
          window.location.href = '/search-results.html?q=' + encodeURIComponent(box.value.trim());
        }
      } else if (e.key === 'Escape') {
        close(drop);
        box.blur();
      }
    });

    document.addEventListener('click', function (e) {
      if (wrap && !wrap.contains(e.target)) close(drop);
    });
  }

  function updateActive(items) {
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  function close(drop) {
    if (drop) { drop.classList.remove('open'); drop.innerHTML = ''; }
    activeIndex = -1;
  }

  async function doSearch(q, drop) {
    try {
      var res = await fetch('/.netlify/functions/search?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var results = await res.json();
      renderDrop(results, q, drop);
    } catch (err) {
      drop.innerHTML = '<div class="search-drop-empty">Search unavailable</div>';
      drop.classList.add('open');
    }
  }

  function renderDrop(results, q, drop) {
    activeIndex = -1;
    if (!results.length) {
      drop.innerHTML = '<div class="search-drop-empty">No results for &ldquo;' + esc(q) + '&rdquo;</div>';
      drop.classList.add('open');
      return;
    }

    // Cap at 8, group by category
    var capped = results.slice(0, 8);
    var order = ['Pages', 'FeedWatch', 'Topics'];
    var grouped = {};
    capped.forEach(function (r) {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    });

    var html = '';
    order.forEach(function (cat) {
      var group = grouped[cat];
      if (!group || !group.length) return;
      html += '<div class="search-drop-group">' + esc(cat) + '</div>';
      group.forEach(function (r) {
        var catClass = cat.toLowerCase().replace(/\s+/g, '');
        var snippet = r.description.length > 90 ? r.description.slice(0, 90) + '\u2026' : r.description;
        var url = esc(r.url);
        html += '<a class="search-drop-item" href="' + url + '" data-url="' + url + '">'
          + '<div class="search-drop-title">' + esc(r.title)
          + '<span class="search-drop-cat ' + catClass + '">' + esc(cat) + '</span></div>'
          + '<div class="search-drop-snippet">' + esc(snippet) + '</div>'
          + '</a>';
      });
    });

    html += '<div class="search-drop-footer"><a href="/search-results.html?q='
      + encodeURIComponent(q) + '">View all results for &ldquo;' + esc(q) + '&rdquo; \u2192</a></div>';

    drop.innerHTML = html;
    drop.classList.add('open');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
