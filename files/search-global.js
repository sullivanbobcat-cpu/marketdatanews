(function () {
  var searchTimeout;

  function initSearch() {
    var input = document.getElementById('search-input');
    var dropdown = document.getElementById('search-dropdown');
    var wrap = document.getElementById('search-wrap');
    if (!input || !dropdown) return;

    input.addEventListener('input', function () {
      var q = this.value.trim();
      clearTimeout(searchTimeout);

      if (q.length < 3) {
        dropdown.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(async function () {
        try {
          var res = await fetch('/.netlify/functions/search?q=' + encodeURIComponent(q));
          var data = await res.json();
          var results = (data.results || []).slice(0, 6);

          if (results.length === 0) {
            dropdown.style.display = 'none';
            return;
          }

          dropdown.innerHTML = results.map(function (r) {
            var title = String(r.title || r.url).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var cat = String(r.type || r.category || 'Page').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var url = String(r.url).replace(/"/g,'&quot;');
            return '<a href="' + url + '" style="display:block;padding:10px 14px;text-decoration:none;border-bottom:1px solid #f0ede6;cursor:pointer;background:#fff;" onmouseover="this.style.background=\'#f5f2eb\'" onmouseout="this.style.background=\'#fff\'">'
              + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;color:#0d0d0d;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</div>'
              + '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.08em;">' + cat + '</div>'
              + '</a>';
          }).join('')
          + '<a href="/search-results.html?q=' + encodeURIComponent(q) + '" style="display:block;padding:10px 14px;text-decoration:none;background:#f5f2eb;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;color:#b8860b;text-align:center;">See all results for \u201c' + q.replace(/</g,'&lt;') + '\u201d \u2192</a>';

          dropdown.style.display = 'block';
        } catch (e) {
          dropdown.style.display = 'none';
        }
      }, 300);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = this.value.trim();
        if (q) {
          dropdown.style.display = 'none';
          window.location.href = '/search-results.html?q=' + encodeURIComponent(q);
        }
      }
    });

    input.addEventListener('blur', function () {
      setTimeout(function () {
        dropdown.style.display = 'none';
      }, 200);
    });

    document.addEventListener('click', function (e) {
      if (wrap && !wrap.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearch);
  } else {
    initSearch();
  }
})();

window.doSearch = function () {
  var box = document.getElementById('search-input');
  if (!box) return;
  var q = box.value.trim();
  if (q) window.location.href = '/search-results.html?q=' + encodeURIComponent(q);
};
