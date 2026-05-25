#!/usr/bin/env node
// scripts/seo-audit.mjs
// SEO audit tool for marketdatanews.com — pure Node.js, no npm dependencies.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FILES_DIR = join(ROOT, 'files');
const REPORTS_DIR = join(ROOT, '_reports');
const REPORT_PATH = join(REPORTS_DIR, 'seo-audit-report.html');
const KEYWORDS_PATH = join(ROOT, 'scripts', 'seo-keywords.json');

// ─── HTML escape ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Regex-based HTML parsers ─────────────────────────────────────────────────
function extractTag(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[0] : null;
}

function extractTagContent(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function extractMeta(html, name) {
  // name="" or property=""
  const patterns = [
    new RegExp(`<meta\\s+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\s+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'),
    new RegExp(`<meta\\s+property=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\s+content=["']([^"']*)["'][^>]*property=["']${name}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractAllMatches(html, regex) {
  const results = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(html)) !== null) {
    results.push(m);
  }
  return results;
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return blocks;
}

function extractHeadings(html) {
  const headings = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1][1], 10);
    // Strip inner tags for text
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    headings.push({ level, text });
  }
  return headings;
}

function extractImages(html) {
  const images = [];
  const re = /<img([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const srcM = attrs.match(/src=["']([^"']*)["']/i);
    const altM = attrs.match(/alt=["']([^"']*)["']/i);
    images.push({
      src: srcM ? srcM[1] : '',
      alt: altM ? altM[1] : null, // null = attribute absent
    });
  }
  return images;
}

function extractInternalLinks(html, baseSlug) {
  const links = [];
  const re = /<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    const hrefM = attrs.match(/href=["']([^"']*)["']/i);
    if (!hrefM) continue;
    const href = hrefM[1];
    // Skip external, mailto, tel, javascript, anchor-only, static assets
    if (/^https?:\/\//i.test(href)) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    if (/\.(js|json|xml|svg|png|ico|css|pdf)(\?.*)?$/i.test(href)) continue;
    // Skip JavaScript template literals embedded in href (dynamic content rendered at runtime)
    if (href.includes('${')) continue;
    links.push({ href, text });
  }
  return links;
}

function extractCanonical(html) {
  const m = html.match(/<link\s[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)
    || html.match(/<link\s[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["']/i);
  return m ? m[1] : null;
}

function extractTitle(html) {
  return extractTagContent(html, 'title');
}

// Strip HTML tags for plain text content
function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Slug / URL helpers ───────────────────────────────────────────────────────
function filePathToUrlSlug(filePath) {
  // files/index.html → /
  // files/nms.html → /nms
  // files/articles/foo.html → /articles/foo
  const rel = filePath.replace(/\\/g, '/').replace(/^.*\/files\//, '');
  if (rel === 'index.html') return '/';
  return '/' + rel.replace(/\.html$/, '');
}

function resolveHref(href, filePath) {
  // Given an href from a page at filePath, compute the path in files/ it points to
  // Strip query/hash
  const clean = href.split('?')[0].split('#')[0];
  if (!clean) return null; // anchor-only after stripping

  let resolved;
  if (clean.startsWith('/')) {
    // Absolute path: /nms → files/nms.html, /articles/foo → files/articles/foo.html
    resolved = join(FILES_DIR, clean);
  } else {
    // Relative path: resolve from the directory of filePath
    const dir = dirname(filePath);
    resolved = resolve(dir, clean);
  }

  // Normalize: if no extension, try .html
  if (extname(resolved) === '') {
    resolved = resolved + '.html';
  }
  // If it ends with / treat as index.html
  if (resolved.endsWith('/')) {
    resolved = resolved + 'index.html';
  }

  return resolved;
}

function hrefExists(href, filePath) {
  const resolved = resolveHref(href, filePath);
  if (!resolved) return true; // anchor-only, treat as fine
  return existsSync(resolved);
}

// ─── Sitemap parser ───────────────────────────────────────────────────────────
function parseSitemap() {
  const sitemapPath = join(FILES_DIR, 'sitemap.xml');
  if (!existsSync(sitemapPath)) return new Set();
  const xml = readFileSync(sitemapPath, 'utf8');
  const paths = new Set();
  const re = /<loc>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    // Strip base URL
    const path = url.replace(/^https?:\/\/marketdatanews\.com/, '').replace(/\/$/, '') || '/';
    paths.add(path);
  }
  // Also handle trailing slash variant for root
  paths.add('/');
  return paths;
}

// ─── Robots.txt checks ───────────────────────────────────────────────────────
function checkRobots() {
  const warnings = [];
  const robotsPath = join(FILES_DIR, 'robots.txt');
  if (!existsSync(robotsPath)) {
    warnings.push('robots.txt not found in files/');
    return warnings;
  }
  const content = readFileSync(robotsPath, 'utf8');
  if (!/^Disallow:/m.test(content)) {
    warnings.push('robots.txt has no Disallow rules');
  }
  if (!/^Sitemap:/m.test(content)) {
    warnings.push('robots.txt has no Sitemap line');
  }
  return warnings;
}

// ─── Keyword dictionary ───────────────────────────────────────────────────────
let KEYWORDS = [];
try {
  KEYWORDS = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8'));
} catch {
  process.stderr.write('[seo-audit] Warning: Could not load seo-keywords.json\n');
}

function findKeywordMatch(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const kw of KEYWORDS) {
    const all = [kw.term, ...(kw.variants || [])];
    for (const variant of all) {
      if (lower.includes(variant.toLowerCase()) && variant.length > bestLen) {
        best = kw;
        bestLen = variant.length;
      }
    }
  }
  return best;
}

function extractPrimaryKeyword(headings, title) {
  // Try H1 text first
  const h1 = headings.find(h => h.level === 1);
  const source = h1 ? h1.text : (title || '');
  return findKeywordMatch(source);
}

function findRelatedKeywords(primaryKw, pageText, count = 5) {
  if (!primaryKw) return [];
  const lower = pageText.toLowerCase();
  const clusters = new Set([primaryKw.cluster]);
  const suggestions = [];
  for (const kw of KEYWORDS) {
    if (!clusters.has(kw.cluster)) continue;
    if (kw.term === primaryKw.term) continue;
    // Check if term appears in page
    const allVariants = [kw.term, ...(kw.variants || [])];
    const inPage = allVariants.some(v => lower.includes(v.toLowerCase()));
    if (!inPage && kw.priority === 'high') {
      suggestions.push(kw.term);
      if (suggestions.length >= count) break;
    }
  }
  // If not enough high priority, add medium
  if (suggestions.length < count) {
    for (const kw of KEYWORDS) {
      if (!clusters.has(kw.cluster)) continue;
      if (kw.term === primaryKw.term) continue;
      if (suggestions.includes(kw.term)) continue;
      const allVariants = [kw.term, ...(kw.variants || [])];
      const inPage = allVariants.some(v => lower.includes(v.toLowerCase()));
      if (!inPage) {
        suggestions.push(kw.term);
        if (suggestions.length >= count) break;
      }
    }
  }
  return suggestions.slice(0, count);
}

// ─── Page discovery ───────────────────────────────────────────────────────────
const SKIP_FILES = new Set([
  'admin-feedwatch.html',
  'seo-audit-report.html',
  'search-results.html',
  'pro-success.html',       // noindex post-subscription landing page, not a crawl target
  'feedwatch.json',
  'chat-widget.js',
  'feedwatch-bar.js',
  'search-global.js',
  'site.webmanifest',
]);

function collectPages(dir, pages = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectPages(full, pages);
    } else if (st.isFile()) {
      if (!entry.endsWith('.html')) continue;
      if (SKIP_FILES.has(entry)) continue;
      pages.push(full);
    }
  }
  return pages;
}

// ─── Per-page audit ───────────────────────────────────────────────────────────
function auditPage(filePath, sitemapPaths) {
  const errors = [];
  const warnings = [];
  const suggestions = [];

  let html;
  try {
    html = readFileSync(filePath, 'utf8');
  } catch (e) {
    warnings.push(`Could not read file: ${e.message}`);
    return { filePath, errors, warnings, suggestions, title: '', primaryKeyword: null };
  }

  const fileSize = Buffer.byteLength(html, 'utf8');
  const title = extractTitle(html) || '';
  const description = extractMeta(html, 'description');
  const canonical = extractCanonical(html);
  const headings = extractHeadings(html);
  const images = extractImages(html);
  const internalLinks = extractInternalLinks(html, filePath);
  const jsonLdBlocks = extractJsonLd(html);
  const pageText = stripTags(html);

  // ERROR checks
  if (!title) errors.push('Missing <title> tag');
  if (!description) errors.push('Missing <meta name="description">');
  if (!canonical) errors.push('Missing <link rel="canonical">');

  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length > 1) errors.push(`Multiple H1 tags found (${h1s.length})`);

  // Broken internal links
  for (const link of internalLinks) {
    const href = link.href;
    const cleanHref = href.split('?')[0].split('#')[0];
    if (!cleanHref) continue; // anchor-only
    if (!hrefExists(href, filePath)) {
      errors.push(`Broken internal link: ${escHtml(href)}`);
    }
  }

  // WARNING checks
  if (title && title.length < 30) warnings.push(`Title too short (${title.length} chars, min 30)`);
  if (title && title.length > 60) warnings.push(`Title too long (${title.length} chars, max 60)`);

  if (description && description.length < 120) warnings.push(`Meta description too short (${description.length} chars, min 120)`);
  if (description && description.length > 160) warnings.push(`Meta description too long (${description.length} chars, max 160)`);

  if (h1s.length === 0) warnings.push('No H1 found');

  // Heading hierarchy checks
  let seenH1 = false, seenH2 = false;
  for (const h of headings) {
    if (h.level === 1) seenH1 = true;
    if (h.level === 2) {
      if (!seenH1) { warnings.push('H2 appears before any H1 (broken heading hierarchy)'); break; }
      seenH2 = true;
    }
    if (h.level === 3 && !seenH2) {
      warnings.push('H3 appears before any H2 (orphan H3)');
      break;
    }
  }

  // Images missing alt
  for (const img of images) {
    if (img.alt === null || img.alt === '') {
      warnings.push(`Image missing alt text: ${escHtml(img.src.slice(0, 80))}`);
    }
  }

  // Internal links count (only for pages > 5KB)
  if (fileSize > 5120 && internalLinks.length < 2) {
    warnings.push(`Fewer than 2 internal links (found ${internalLinks.length})`);
  }

  // Bad anchor text
  const badAnchors = new Set(['click here', 'read more', 'here', 'learn more']);
  for (const link of internalLinks) {
    if (badAnchors.has(link.text.toLowerCase())) {
      warnings.push(`Generic anchor text "${escHtml(link.text)}" on internal link to ${escHtml(link.href)}`);
    }
  }

  // OG tags
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
    if (!extractMeta(html, tag)) warnings.push(`Missing <meta property="${tag}">`);
  }

  // Twitter tags
  for (const tag of ['twitter:card', 'twitter:title', 'twitter:description']) {
    if (!extractMeta(html, tag)) warnings.push(`Missing <meta name="${tag}">`);
  }

  if (jsonLdBlocks.length === 0) warnings.push('No JSON-LD structured data found');

  if (fileSize > 100 * 1024) warnings.push(`File size too large (${Math.round(fileSize / 1024)}KB, max 100KB)`);

  // Sitemap check
  const urlSlug = filePathToUrlSlug(filePath);
  // Handle trailing slash for articles/
  const slugVariants = [urlSlug, urlSlug + '/'];
  const inSitemap = slugVariants.some(s => sitemapPaths.has(s));
  if (!inSitemap) warnings.push(`Page URL "${urlSlug}" not found in sitemap.xml`);

  // SUGGESTION checks
  const primaryKw = extractPrimaryKeyword(headings, title);
  if (!primaryKw) {
    suggestions.push('Primary keyword not found in industry keyword dictionary — consider aligning H1/title to an indexed term');
  } else {
    if (title && !title.toLowerCase().includes(primaryKw.term.toLowerCase())) {
      const variantInTitle = (primaryKw.variants || []).some(v => title.toLowerCase().includes(v.toLowerCase()));
      if (!variantInTitle) suggestions.push(`Title does not contain primary keyword "${primaryKw.term}"`);
    }
    if (description && !description.toLowerCase().includes(primaryKw.term.toLowerCase())) {
      const variantInDesc = (primaryKw.variants || []).some(v => description.toLowerCase().includes(v.toLowerCase()));
      if (!variantInDesc) suggestions.push(`Meta description does not contain primary keyword "${primaryKw.term}"`);
    }
    const related = findRelatedKeywords(primaryKw, pageText);
    if (related.length > 0) {
      suggestions.push(`Consider adding related ${primaryKw.cluster} keywords: ${related.join(', ')}`);
    }
  }

  return { filePath, errors, warnings, suggestions, title, primaryKeyword: primaryKw };
}

// ─── Keyword coverage matrix ──────────────────────────────────────────────────
const TOP_TERMS = [
  'NMS plan', 'SIP feed', 'Reg NMS', 'OPRA feed', 'consolidated tape',
  'market data fee', 'co-location fee', 'FIX protocol', 'ITCH feed', 'feed handler',
  'NBBO', 'depth of book', 'maker-taker', 'dark pool', 'ATS',
  'HFT', 'best execution', 'DTCC', 'LULD', 'co-lo',
];

function buildCoverageMatrix(results) {
  // For each page × top term: did the term appear?
  return results.map(r => {
    let pageText = '';
    try { pageText = stripTags(readFileSync(r.filePath, 'utf8')).toLowerCase(); } catch {}
    const coverage = {};
    for (const term of TOP_TERMS) {
      const kw = KEYWORDS.find(k => k.term === term);
      if (!kw) { coverage[term] = false; continue; }
      const allVariants = [kw.term, ...(kw.variants || [])];
      coverage[term] = allVariants.some(v => pageText.includes(v.toLowerCase()));
    }
    return { filePath: r.filePath, title: r.title, coverage };
  });
}

// ─── Quick wins computation ───────────────────────────────────────────────────
function computeQuickWins(results) {
  const wins = [];

  // Errors first
  const errorMap = {};
  for (const r of results) {
    for (const e of r.errors) {
      errorMap[e] = (errorMap[e] || []);
      errorMap[e].push(r.filePath);
    }
  }

  // Warnings affecting multiple pages
  const warnMap = {};
  for (const r of results) {
    for (const w of r.warnings) {
      const key = w.replace(/\(.*?\)/g, '').trim();
      if (!warnMap[key]) warnMap[key] = [];
      warnMap[key].push(r.filePath);
    }
  }

  // Add common errors
  for (const [msg, pages] of Object.entries(errorMap)) {
    if (pages.length > 0) wins.push({ severity: 'error', msg, count: pages.length });
  }

  // Add warnings with highest page counts
  const warnEntries = Object.entries(warnMap)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
  for (const [msg, pages] of warnEntries) {
    wins.push({ severity: 'warning', msg, count: pages.length });
  }

  return wins.slice(0, 10);
}

// ─── Report generation ────────────────────────────────────────────────────────
function generateReport(results, robotsWarnings, totalErrors, totalWarnings, totalSuggestions) {
  const pass = totalErrors === 0;
  const timestamp = new Date().toISOString();
  const nodeVersion = process.version;

  const matrix = buildCoverageMatrix(results);
  const quickWins = computeQuickWins(results);

  // Summary banner
  const statusLabel = pass ? 'PASS' : 'FAIL';
  const statusColor = pass ? '#00ff88' : '#ff4444';

  // Per-page sections
  const pageSections = results.map(r => {
    const relPath = r.filePath.replace(ROOT + '/', '');
    const slug = filePathToUrlSlug(r.filePath);
    const hasErrors = r.errors.length > 0;
    const icon = hasErrors ? '✗' : (r.warnings.length > 0 ? '⚠' : '✓');
    const iconColor = hasErrors ? '#ff4444' : (r.warnings.length > 0 ? '#ffaa00' : '#00ff88');

    const errorHtml = r.errors.map(e =>
      `<div class="finding finding-error"><span class="badge-sev sev-error">ERROR</span> ${escHtml(e)}</div>`
    ).join('');

    const warnHtml = r.warnings.map(w =>
      `<div class="finding finding-warn"><span class="badge-sev sev-warn">WARN</span> ${escHtml(w)}</div>`
    ).join('');

    const suggestHtml = r.suggestions.map(s =>
      `<div class="finding finding-suggest"><span class="badge-sev sev-suggest">SUGGEST</span> ${escHtml(s)}</div>`
    ).join('');

    const kwLabel = r.primaryKeyword
      ? `<span class="kw-chip">${escHtml(r.primaryKeyword.term)} <em>${escHtml(r.primaryKeyword.cluster)}</em></span>`
      : '<span class="kw-chip kw-none">no keyword match</span>';

    return `
<details class="page-section ${hasErrors ? 'has-errors' : ''}">
  <summary>
    <span class="page-icon" style="color:${iconColor}">${icon}</span>
    <span class="page-path">${escHtml(relPath)}</span>
    <span class="page-slug">${escHtml(slug)}</span>
    ${kwLabel}
    <span class="page-counts">
      ${r.errors.length > 0 ? `<span class="cnt cnt-error">${r.errors.length}E</span>` : ''}
      ${r.warnings.length > 0 ? `<span class="cnt cnt-warn">${r.warnings.length}W</span>` : ''}
      ${r.suggestions.length > 0 ? `<span class="cnt cnt-suggest">${r.suggestions.length}S</span>` : ''}
    </span>
  </summary>
  <div class="page-title-row">Title: <strong>${escHtml(r.title || '(none)')}</strong></div>
  <div class="findings-block">
    ${errorHtml}${warnHtml}${suggestHtml}
    ${(!r.errors.length && !r.warnings.length && !r.suggestions.length)
      ? '<div class="finding finding-pass">✓ All checks passed</div>' : ''}
  </div>
</details>`;
  }).join('\n');

  // Keyword coverage matrix
  const termHeaders = TOP_TERMS.map(t => `<th class="matrix-th" title="${escHtml(t)}">${escHtml(t)}</th>`).join('');
  const matrixRows = matrix.map(m => {
    const relPath = m.filePath.replace(ROOT + '/', '').replace('files/', '');
    const cells = TOP_TERMS.map(t =>
      `<td class="${m.coverage[t] ? 'cov-yes' : 'cov-no'}">${m.coverage[t] ? '✓' : ''}</td>`
    ).join('');
    return `<tr><td class="matrix-page">${escHtml(relPath)}</td>${cells}</tr>`;
  }).join('\n');

  // Quick wins
  const quickWinsHtml = quickWins.map(w => {
    const cls = w.severity === 'error' ? 'qw-error' : 'qw-warn';
    const label = w.severity === 'error' ? 'ERROR' : 'WARNING';
    return `<div class="quick-win ${cls}">
      <span class="qw-badge">${label}</span>
      <span class="qw-msg">${escHtml(w.msg)}</span>
      <span class="qw-count">${w.count} page${w.count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('\n');

  // Robots warnings
  const robotsHtml = robotsWarnings.length > 0
    ? robotsWarnings.map(w => `<div class="finding finding-warn"><span class="badge-sev sev-warn">WARN</span> robots.txt: ${escHtml(w)}</div>`).join('')
    : '<div class="finding finding-pass">✓ robots.txt checks passed</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SEO Audit Report — marketdatanews.com</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
  :root {
    --bg: #0a0a0a; --surface: #111; --border: #222; --text: #ccc; --muted: #666;
    --green: #00ff88; --red: #ff4444; --yellow: #ffaa00; --blue: #5b9bd5;
    --purple: #9b59b6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; line-height: 1.6; }
  a { color: var(--green); }

  .header { background: #0d0d0d; border-bottom: 2px solid var(--green); padding: 32px 48px; }
  .header h1 { font-family: 'IBM Plex Mono', monospace; font-size: 22px; color: white; margin-bottom: 8px; }
  .header .subtitle { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); }

  .summary-banner { display: flex; align-items: center; gap: 32px; padding: 24px 48px; background: #0d0d0d; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .summary-stat { text-align: center; }
  .summary-stat .stat-num { font-family: 'IBM Plex Mono', monospace; font-size: 32px; font-weight: 700; display: block; }
  .summary-stat .stat-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
  .stat-pages { color: white; }
  .stat-error { color: var(--red); }
  .stat-warn { color: var(--yellow); }
  .stat-suggest { color: var(--blue); }
  .status-pill { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 700; padding: 10px 28px; border: 2px solid; border-radius: 3px; }
  .status-pass { color: var(--green); border-color: var(--green); }
  .status-fail { color: var(--red); border-color: var(--red); }

  .section { padding: 32px 48px; border-bottom: 1px solid var(--border); }
  .section h2 { font-family: 'IBM Plex Mono', monospace; font-size: 14px; color: var(--green); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 20px; }

  .quick-win { display: flex; align-items: baseline; gap: 12px; padding: 10px 14px; border: 1px solid var(--border); margin-bottom: 8px; border-radius: 2px; }
  .qw-error { border-left: 3px solid var(--red); }
  .qw-warn { border-left: 3px solid var(--yellow); }
  .qw-badge { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; flex-shrink: 0; }
  .qw-error .qw-badge { color: var(--red); }
  .qw-warn .qw-badge { color: var(--yellow); }
  .qw-msg { flex: 1; }
  .qw-count { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); white-space: nowrap; }

  .page-section { border: 1px solid var(--border); margin-bottom: 8px; border-radius: 2px; }
  .page-section.has-errors { border-left: 3px solid var(--red); }
  .page-section > summary { cursor: pointer; padding: 10px 14px; display: flex; align-items: center; gap: 12px; list-style: none; user-select: none; }
  .page-section > summary:hover { background: #111; }
  .page-section > summary::-webkit-details-marker { display: none; }
  .page-icon { font-size: 14px; flex-shrink: 0; }
  .page-path { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text); flex-shrink: 0; }
  .page-slug { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); }
  .page-counts { margin-left: auto; display: flex; gap: 6px; flex-shrink: 0; }
  .cnt { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 2px; }
  .cnt-error { background: rgba(255,68,68,0.15); color: var(--red); }
  .cnt-warn { background: rgba(255,170,0,0.15); color: var(--yellow); }
  .cnt-suggest { background: rgba(91,155,213,0.15); color: var(--blue); }
  .kw-chip { font-family: 'IBM Plex Mono', monospace; font-size: 9px; padding: 2px 8px; background: rgba(0,255,136,0.08); color: var(--green); border: 1px solid rgba(0,255,136,0.2); border-radius: 2px; white-space: nowrap; }
  .kw-chip em { color: var(--muted); font-style: normal; }
  .kw-none { background: rgba(102,102,102,0.1); color: var(--muted); border-color: var(--border); }
  .page-title-row { padding: 8px 14px; font-size: 12px; color: var(--muted); background: #0d0d0d; border-top: 1px solid var(--border); }
  .findings-block { padding: 8px 14px 12px; }
  .finding { padding: 6px 10px; margin-bottom: 4px; border-radius: 2px; display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
  .finding-error { background: rgba(255,68,68,0.06); border-left: 2px solid var(--red); }
  .finding-warn { background: rgba(255,170,0,0.06); border-left: 2px solid var(--yellow); }
  .finding-suggest { background: rgba(91,155,213,0.06); border-left: 2px solid var(--blue); }
  .finding-pass { background: rgba(0,255,136,0.05); border-left: 2px solid var(--green); color: var(--green); }
  .badge-sev { font-family: 'IBM Plex Mono', monospace; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 1px 5px; border-radius: 2px; flex-shrink: 0; }
  .sev-error { background: rgba(255,68,68,0.2); color: var(--red); }
  .sev-warn { background: rgba(255,170,0,0.2); color: var(--yellow); }
  .sev-suggest { background: rgba(91,155,213,0.2); color: var(--blue); }

  .matrix-wrap { overflow-x: auto; }
  table.matrix { border-collapse: collapse; font-size: 11px; }
  table.matrix th, table.matrix td { border: 1px solid var(--border); padding: 6px 8px; text-align: center; white-space: nowrap; }
  .matrix-th { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--muted); writing-mode: vertical-lr; transform: rotate(180deg); max-width: 28px; padding: 8px 4px; background: #0d0d0d; }
  .matrix-page { text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); background: #0d0d0d; white-space: nowrap; }
  .cov-yes { background: rgba(0,255,136,0.12); color: var(--green); font-weight: 700; }
  .cov-no { color: #2a2a2a; }

  .footer { padding: 24px 48px; border-top: 1px solid var(--border); font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); display: flex; justify-content: space-between; }

  @media (max-width: 768px) {
    .header, .summary-banner, .section, .footer { padding: 20px; }
    .summary-banner { gap: 16px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>SEO Audit Report — marketdatanews.com</h1>
  <div class="subtitle">Generated: ${escHtml(timestamp)} | Node: ${escHtml(nodeVersion)}</div>
</div>

<div class="summary-banner">
  <div class="summary-stat">
    <span class="stat-num stat-pages">${results.length}</span>
    <span class="stat-label">Pages Audited</span>
  </div>
  <div class="summary-stat">
    <span class="stat-num stat-error">${totalErrors}</span>
    <span class="stat-label">Errors</span>
  </div>
  <div class="summary-stat">
    <span class="stat-num stat-warn">${totalWarnings}</span>
    <span class="stat-label">Warnings</span>
  </div>
  <div class="summary-stat">
    <span class="stat-num stat-suggest">${totalSuggestions}</span>
    <span class="stat-label">Suggestions</span>
  </div>
  <div class="status-pill ${pass ? 'status-pass' : 'status-fail'}" style="color:${statusColor};border-color:${statusColor}">${statusLabel}</div>
</div>

<div class="section">
  <h2>Quick Wins</h2>
  ${quickWinsHtml || '<div class="finding finding-pass">✓ No major recurring issues found</div>'}
</div>

<div class="section">
  <h2>robots.txt</h2>
  ${robotsHtml}
</div>

<div class="section">
  <h2>Pages (${results.length})</h2>
  ${pageSections}
</div>

<div class="section">
  <h2>Keyword Coverage Matrix — Top 20 Terms</h2>
  <div class="matrix-wrap">
    <table class="matrix">
      <thead>
        <tr>
          <th class="matrix-page" style="writing-mode:horizontal-tb;transform:none;">Page</th>
          ${termHeaders}
        </tr>
      </thead>
      <tbody>
        ${matrixRows}
      </tbody>
    </table>
  </div>
</div>

<div class="footer">
  <span>marketdatanews.com SEO Audit</span>
  <span>Generated ${escHtml(timestamp)} · Node ${escHtml(nodeVersion)}</span>
</div>

</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const pages = collectPages(FILES_DIR);
  const sitemapPaths = parseSitemap();
  const robotsWarnings = checkRobots();

  process.stdout.write(`[seo-audit] Auditing ${pages.length} pages...\n`);

  const results = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalSuggestions = 0;

  for (const page of pages.sort()) {
    const relPath = page.replace(ROOT + '/', '');
    let result;
    try {
      result = auditPage(page, sitemapPaths);
    } catch (e) {
      process.stdout.write(`[seo-audit] ⚠ WARNING: ${relPath} — Parse error: ${e.message}\n`);
      result = { filePath: page, errors: [], warnings: [`Parse error: ${e.message}`], suggestions: [], title: '', primaryKeyword: null };
    }

    results.push(result);
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
    totalSuggestions += result.suggestions.length;

    // Print per-page findings
    for (const e of result.errors) {
      process.stdout.write(`[seo-audit] ✗ ERROR: ${relPath} — ${e}\n`);
    }
    for (const w of result.warnings) {
      process.stdout.write(`[seo-audit] ⚠ WARNING: ${relPath} — ${w}\n`);
    }
    if (result.errors.length === 0 && result.warnings.length === 0) {
      process.stdout.write(`[seo-audit] ✓ PASS: ${relPath}\n`);
    }
  }

  // Robots warnings
  for (const w of robotsWarnings) {
    process.stdout.write(`[seo-audit] ⚠ WARNING: files/robots.txt — ${w}\n`);
    totalWarnings++;
  }

  process.stdout.write('[seo-audit] ─────────────────────────────\n');
  const resultLine = totalErrors > 0 ? 'FAIL' : 'PASS';
  process.stdout.write(`[seo-audit] Result: ${resultLine} | ${totalErrors} errors, ${totalWarnings} warnings, ${totalSuggestions} suggestions\n`);

  // Generate report
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportHtml = generateReport(results, robotsWarnings, totalErrors, totalWarnings, totalSuggestions);
  writeFileSync(REPORT_PATH, reportHtml, 'utf8');
  process.stdout.write(`[seo-audit] Report: ${REPORT_PATH}\n`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  process.stderr.write(`[seo-audit] Fatal error: ${e.message}\n${e.stack}\n`);
  process.exit(2);
});
