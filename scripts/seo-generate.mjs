#!/usr/bin/env node
// scripts/seo-generate.mjs
// SEO content generator for marketdatanews.com — uses @anthropic-ai/sdk.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FILES_DIR = join(ROOT, 'files');
const KEYWORDS_PATH = join(ROOT, 'scripts', 'seo-keywords.json');

const VALID_TYPES = ['article', 'deep-dive', 'glossary', 'exchange-page', 'plan-page', 'regulatory-tracker'];

// ─── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { topic: null, type: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) { result.topic = args[++i]; }
    else if (args[i] === '--type' && args[i + 1]) { result.type = args[++i]; }
    else if (args[i] === '--dry-run') { result.dryRun = true; }
  }
  return result;
}

function validateArgs(args) {
  const errors = [];
  if (!args.topic) errors.push('--topic is required');
  if (!args.type) errors.push('--type is required');
  else if (!VALID_TYPES.includes(args.type)) {
    errors.push(`--type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  return errors;
}

// ─── Slug derivation ──────────────────────────────────────────────────────────
function deriveSlug(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ─── Extract title from HTML file ────────────────────────────────────────────
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return m[1].trim().replace(/\s*\|\s*Market Data News.*$/i, '').trim();
}

function extractMeta(html, name) {
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

// ─── Site page map ────────────────────────────────────────────────────────────
function scanPages(dir, pages = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return pages; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      scanPages(full, pages);
    } else if (entry.endsWith('.html')) {
      let html = '';
      try { html = readFileSync(full, 'utf8'); } catch {}
      const title = extractTitle(html) || entry.replace('.html', '');
      const description = extractMeta(html, 'description') || '';
      // Compute slug (path relative to files/, no extension, leading /)
      const rel = full.replace(/\\/g, '/').replace(/^.*\/files\//, '');
      let slug;
      if (rel === 'index.html') slug = '/';
      else slug = '/' + rel.replace(/\.html$/, '');
      pages.push({ path: full, slug, title, description });
    }
  }
  return pages;
}

// ─── Output path computation ──────────────────────────────────────────────────
function computeOutputPath(type, slug) {
  if (['article', 'deep-dive', 'glossary'].includes(type)) {
    return join(FILES_DIR, 'articles', `${slug}.html`);
  }
  return join(FILES_DIR, `${slug}.html`);
}

function computePageUrl(type, slug) {
  if (['article', 'deep-dive', 'glossary'].includes(type)) {
    return `https://marketdatanews.com/articles/${slug}`;
  }
  return `https://marketdatanews.com/${slug}`;
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Claude API helpers ───────────────────────────────────────────────────────
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

const SEO_SYSTEM = `You are an SEO specialist for a niche B2B market data industry website targeting professionals at banks, HFTs, exchanges, and market data vendors. The site covers: NMS plans, SIP feeds, exchange connectivity, market data fees, regulatory filings, and market infrastructure. Keyword research must focus on industry-specific terminology, not consumer-facing finance terms. Avoid generic financial terms that don't reflect how practitioners actually search.`;

const CONTENT_SYSTEM = `You are an SEO specialist for a niche B2B market data industry website targeting professionals at banks, HFTs, exchanges, and market data vendors. The site covers: NMS plans, SIP feeds, exchange connectivity, market data fees, regulatory filings, and market infrastructure. Keyword research must focus on industry-specific terminology, not consumer-facing finance terms. Avoid generic financial terms that don't reflect how practitioners actually search.

Write in a precise, practitioner-first voice. No marketing fluff. No "In today's fast-paced world" openers. No "As we can see". Use industry terminology correctly (as a professional who builds and operates these systems would). Each H2 section should be 150-300 words. Use [VERIFY: description] placeholders instead of stating specific figures, dates, or names you're not certain of — this is critical, do not fabricate regulatory details, fee amounts, or filing references.`;

async function callClaude(client, systemPrompt, userPrompt, maxTokens) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = message.content.find(b => b.type === 'text');
  return block ? block.text : '';
}

function extractJson(text) {
  // Extract JSON from markdown code blocks or raw JSON
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  // Try to find raw JSON object
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    try { return JSON.parse(text.slice(jsonStart, jsonEnd + 1)); } catch {}
  }
  throw new Error('Could not parse JSON from Claude response:\n' + text.slice(0, 500));
}

// ─── Compact keyword dict (term + cluster only) ───────────────────────────────
function buildCompactKeywords(keywords) {
  return keywords.map(k => ({ term: k.term, cluster: k.cluster, priority: k.priority }));
}

// ─── Page map summary for prompts ────────────────────────────────────────────
function buildPageMapSummary(pageMap) {
  return pageMap
    .filter(p => p.slug !== '/' && !p.slug.includes('admin') && !p.slug.includes('search'))
    .slice(0, 40)
    .map(p => `${p.slug} — ${p.title}`)
    .join('\n');
}

// ─── JSON-LD builders ─────────────────────────────────────────────────────────
function buildArticleJsonLd(headline, description, url, dateStr, keywords) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    url,
    datePublished: dateStr,
    dateModified: dateStr,
    author: { '@type': 'Organization', name: 'Market Data News' },
    publisher: {
      '@type': 'Organization',
      name: 'Market Data News',
      logo: { '@type': 'ImageObject', url: 'https://marketdatanews.com/favicon.svg' },
    },
    keywords,
  }, null, 2);
}

function buildFaqJsonLd(questions) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(q => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: '[VERIFY: answer text]' },
    })),
  }, null, 2);
}

// ─── Full HTML assembly ───────────────────────────────────────────────────────
function assembleHtml(opts) {
  const {
    title, metaDescription, canonical, slug, pageUrl,
    ogTitle, ogDescription, ogUrl,
    primaryKeyword, secondaryKeywords, articleJsonLd, faqJsonLd,
    bodyContent, today, type, h1,
  } = opts;

  const isArticle = ['article', 'deep-dive', 'glossary'].includes(type);
  const articlePathPrefix = isArticle ? '../' : '';

  const typeLabel = {
    'article': 'Analysis',
    'deep-dive': 'Deep Dive',
    'glossary': 'Glossary',
    'exchange-page': 'Exchange Intelligence',
    'plan-page': 'NMS Plan',
    'regulatory-tracker': 'Regulatory Tracker',
  }[type] || 'Analysis';

  // Breadcrumb
  const breadcrumbHtml = isArticle
    ? `<div class="breadcrumb">
      <a href="${articlePathPrefix}index.html">Home</a><span>›</span>
      <a href="index.html">Articles</a><span>›</span>
      ${esc(h1)}
    </div>`
    : `<div class="breadcrumb">
      <a href="index.html">Home</a><span>›</span>
      ${esc(h1)}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/svg+xml" href="${articlePathPrefix}favicon.svg">
<link rel="icon" type="image/png" href="${articlePathPrefix}favicon.png" sizes="32x32">
<link rel="apple-touch-icon" href="${articlePathPrefix}favicon.png" sizes="180x180">
<link rel="manifest" href="${articlePathPrefix}site.webmanifest">
<meta name="theme-color" content="#0d0d0d">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDescription)}">
<meta name="keywords" content="${esc([primaryKeyword, ...secondaryKeywords].join(', '))}">
<meta name="robots" content="index, follow">
<meta name="author" content="Market Data News">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(ogDescription || metaDescription)}">
<meta property="og:site_name" content="Market Data News">
<meta property="og:image" content="https://marketdatanews.com/og-image.png?v=2">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Market Data News | Market Infrastructure Intelligence">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@MDNintelligence">
<meta name="twitter:title" content="${esc(ogTitle || title)}">
<meta name="twitter:description" content="${esc(ogDescription || metaDescription)}">
<meta name="twitter:image" content="https://marketdatanews.com/og-image.png?v=2">
<link rel="sitemap" type="application/xml" href="${articlePathPrefix}sitemap.xml">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0d0d0d; --paper: #f5f2eb; --cream: #faf8f3; --rule: #d4c9b0;
    --accent: #b8860b; --accent-dark: #8b6508; --muted: #6b6555;
    --red: #c0392b; --surface: #ffffff; --border: #e8e0d0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--paper); color: var(--ink); font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }

  .ticker-wrap { background: var(--ink); color: var(--accent); padding: 7px 0; overflow: hidden; position: relative; }
  .ticker-wrap::before, .ticker-wrap::after { content: ''; position: absolute; top: 0; bottom: 0; width: 60px; z-index: 2; }
  .ticker-wrap::before { left: 0; background: linear-gradient(90deg, var(--ink), transparent); }
  .ticker-wrap::after { right: 0; background: linear-gradient(-90deg, var(--ink), transparent); }
  .ticker { display: flex; animation: ticker 40s linear infinite; white-space: nowrap; }
  .ticker-item { font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 0 32px; letter-spacing: 0.05em; }
  @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

  .masthead { background: var(--cream); border-bottom: 3px solid var(--ink); }
  .masthead-top { display: flex; align-items: center; justify-content: space-between; padding: 20px 48px 16px; border-bottom: 1px solid var(--rule); }
  .date-line { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .site-title { font-family: 'Playfair Display', serif; font-size: clamp(32px, 5vw, 58px); font-weight: 900; letter-spacing: -0.02em; line-height: 1; text-align: center; text-decoration: none; color: var(--ink); }
  .site-title span { color: var(--accent); }
  .tagline { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); text-align: right; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.6; }

  nav { display: flex; align-items: stretch; padding: 0 48px; border-bottom: 1px solid var(--rule); position: relative; flex-wrap: nowrap; overflow: visible; background: var(--cream); }
  .nav-item { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; padding: 0 14px; cursor: pointer; transition: background 0.15s, color 0.15s; color: var(--ink); border: none; background: none; font-family: 'IBM Plex Sans', sans-serif; border-right: 1px solid var(--rule); text-decoration: none; display: inline-flex; align-items: center; white-space: nowrap; min-height: 40px; user-select: none; }
  a.nav-item:first-child { border-left: 1px solid var(--rule); }
  .nav-item.active, .nav-item:hover { background: var(--ink); color: var(--accent); }
  .nav-dropdown { position: relative; display: flex; align-items: stretch; }
  .nav-dropdown > .nav-item { border-left: none; }
  .nav-dropdown-menu { display: block; position: absolute; top: 100%; left: 0; opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease; min-width: 220px; background: var(--ink); border-top: 2px solid var(--accent); z-index: 1000; box-shadow: 0 6px 24px rgba(0,0,0,0.35); }
  .nav-dropdown-menu.nav-dropdown-right { left: auto; right: 0; }
  .nav-dropdown:hover .nav-dropdown-menu { opacity: 1; visibility: visible; transform: translateY(0); }
  .nav-drop-item { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #aaa; text-decoration: none; padding: 10px 20px; border-bottom: 1px solid #1e1e1e; transition: color 0.15s, background 0.15s; white-space: nowrap; }
  .nav-drop-item:last-child { border-bottom: none; }
  .nav-drop-item:hover, .nav-drop-item.active { color: var(--accent); background: #111; }
  .nav-right { margin-left: auto; display: flex; align-items: center; gap: 16px; padding-left: 16px; }
  .search-box { background: transparent; border: 1px solid var(--rule); padding: 5px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink); border-radius: 2px; width: 180px; }
  .search-box:focus { outline: none; border-color: var(--accent); }
  .search-box::placeholder { color: var(--muted); }
  .hamburger { background: none; border: none; cursor: pointer; display: flex; flex-direction: column; gap: 5px; padding: 4px; }
  .hamburger span { display: block; width: 22px; height: 2px; background: var(--ink); transition: 0.2s; }
  .mobile-nav { display: none; flex-direction: column; background: var(--ink); padding: 12px 20px; border-bottom: 2px solid var(--accent); }
  .mobile-nav.open { display: flex; }
  .mobile-nav a { color: #aaa; text-decoration: none; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #1a1a1a; }
  .mobile-nav a:hover, .mobile-nav a.active { color: var(--accent); }
  .mob-group-label { font-family: 'IBM Plex Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #555; padding: 12px 0 4px; }
  .nav-comp { font-family: 'IBM Plex Mono', monospace; font-size: 10px; }

  .fw-alertbar { background: #1a0a00; border-bottom: 2px solid var(--accent); padding: 0 48px; }
  .fw-alertbar-inner { max-width: 1280px; margin: 0 auto; display: flex; align-items: center; height: 38px; }
  .fw-alertbar-brand { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 900; color: white; text-decoration: none; padding-right: 16px; white-space: nowrap; }
  .fw-alertbar-brand span { color: var(--accent); }
  .fw-alertbar-divider { width: 1px; height: 20px; background: #3a2a10; margin: 0 16px; flex-shrink: 0; }
  .fw-alertbar-stats { display: flex; align-items: center; gap: 4px; }
  .fw-alertbar-stat { display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 2px; text-decoration: none; transition: background 0.15s; white-space: nowrap; }
  .fw-alertbar-stat:hover { background: rgba(255,255,255,0.08); }
  .fw-alertbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #ff4444; animation: pulse 2s infinite; flex-shrink: 0; }
  .fw-alertbar-num { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600; color: white; }
  .fw-alertbar-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
  .fw-alertbar-stat.critical .fw-alertbar-num { color: #ff4444; }
  .fw-alertbar-stat.high .fw-alertbar-num { color: var(--accent); }
  .fw-alertbar-stat.action .fw-alertbar-num { color: #5b9bd5; }
  .fw-alertbar-next { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .fw-alertbar-next-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.08em; }
  .fw-alertbar-next-val { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--accent); }
  .fw-alertbar-cta { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--accent); text-decoration: none; border: 1px solid #3a2a10; padding: 4px 10px; margin-left: 16px; white-space: nowrap; transition: background 0.15s; }
  .fw-alertbar-cta:hover { background: rgba(184,134,11,0.15); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  footer { background: var(--ink); color: #aaa; padding: 40px 48px; }
  .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 40px; max-width: 1280px; margin: 0 auto 32px; }
  .footer-brand { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 900; color: white; margin-bottom: 10px; }
  .footer-brand span { color: var(--accent); }
  .footer-desc { font-size: 12px; line-height: 1.7; max-width: 260px; }
  .footer-col h4 { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: white; margin-bottom: 12px; font-family: 'IBM Plex Sans', sans-serif; }
  .footer-col a { display: block; font-size: 12px; color: #888; text-decoration: none; margin-bottom: 7px; transition: color 0.15s; }
  .footer-col a:hover { color: var(--accent); }
  .footer-bottom { border-top: 1px solid #222; padding-top: 20px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; display: flex; justify-content: space-between; max-width: 1280px; margin: 0 auto; }

  .article-hero { background: var(--ink); color: white; padding: 56px 48px 48px; border-bottom: 3px solid var(--accent); }
  .article-hero-inner { max-width: 960px; margin: 0 auto; }
  .breadcrumb { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #555; margin-bottom: 20px; }
  .breadcrumb a { color: var(--accent); text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .breadcrumb span { margin: 0 8px; }
  .article-hero-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 16px; }
  .article-hero-title { font-family: 'Playfair Display', serif; font-size: clamp(28px, 4vw, 48px); font-weight: 900; line-height: 1.1; margin-bottom: 20px; }
  .article-hero-meta { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .article-hero-meta-item { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.08em; }
  .article-hero-meta-item strong { color: #aaa; }

  .article-body { max-width: 960px; margin: 0 auto; padding: 48px; }
  .article-lead { font-size: 17px; line-height: 1.75; color: var(--muted); margin-bottom: 40px; border-left: 3px solid var(--accent); padding-left: 20px; }
  .article-section { margin-bottom: 48px; }
  .article-section h2 { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
  .article-section h3 { font-family: 'IBM Plex Sans', sans-serif; font-size: 16px; font-weight: 600; margin-bottom: 12px; margin-top: 24px; color: var(--accent-dark); }
  .article-section p { font-size: 14px; line-height: 1.8; color: #333; margin-bottom: 14px; }
  .article-section ul, .article-section ol { margin-left: 20px; margin-bottom: 14px; }
  .article-section li { font-size: 14px; line-height: 1.8; color: #333; margin-bottom: 6px; }
  .article-section strong { color: var(--ink); }
  .article-section em { font-style: italic; }
  .badge { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 7px; border-radius: 2px; }
  .badge-analysis { background: #0d2b10; color: #27ae60; }
  .badge-deepdive { background: #1a0d2a; color: #9b59b6; }
  .badge-glossary { background: #0d1f3a; color: #5b9bd5; }
  .badge-exchange { background: #2a1500; color: #e67e22; }
  .badge-plan { background: #2a0505; color: #ff4444; }
  .badge-regulatory { background: #1a1a0a; color: #f1c40f; }

  .progress-bar { position: fixed; top: 0; left: 0; height: 2px; background: var(--accent); z-index: 9999; transition: width 0.1s; }

  .nav-drop-group { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: #b8860b; text-transform: uppercase; letter-spacing: 0.15em; padding: 8px 16px 4px; cursor: default; display: block; }
  .nav-drop-divider { border: none; border-top: 1px solid #2a2a2a; margin: 4px 0; }
  a.nav-subscribe { font-family: 'IBM Plex Mono', monospace !important; font-size: 11px !important; font-weight: 700 !important; padding: 0 18px !important; border-radius: 2px !important; text-transform: uppercase !important; border-right: none !important; letter-spacing: 0.08em !important; }

  @media (max-width: 900px) {
    nav { display: none !important; }
    html, body { overflow-x: hidden; max-width: 100vw; }
    * { max-width: 100%; box-sizing: border-box; }
    .article-hero { padding: 40px 20px; }
    .article-body { padding: 32px 20px; }
    .masthead-top { padding: 16px 20px; }
    .fw-alertbar { padding: 0 16px; }
    .fw-alertbar-next, .fw-alertbar-cta { display: none; }
    .footer-grid { grid-template-columns: 1fr 1fr; gap: 24px; }
    footer { padding: 32px 20px; }
  }
  @media (max-width: 1200px) { .nav-comp { display: none; } }
</style>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Market Data News",
  "url": "https://marketdatanews.com",
  "logo": {
    "@type": "ImageObject",
    "url": "https://marketdatanews.com/favicon.svg",
    "width": 512,
    "height": 512
  },
  "sameAs": ["https://twitter.com/MDNintelligence"],
  "description": "Free intelligence platform for market data professionals. Exchange notices, NMS plans, SIP feeds, fee benchmarks and regulatory deadlines."
}
</script>
<script type="application/ld+json">
${articleJsonLd}
</script>
${faqJsonLd ? `<script type="application/ld+json">\n${faqJsonLd}\n</script>` : ''}
</head>
<body>

<div class="progress-bar" id="progressBar"></div>

<div class="ticker-wrap"><div class="ticker">
  <span class="ticker-item">${esc(h1.toUpperCase())} &nbsp;·&nbsp; MARKET DATA NEWS</span>
  <span class="ticker-item">${esc(primaryKeyword.toUpperCase())} &nbsp;·&nbsp; ${esc(secondaryKeywords.slice(0,3).map(s => s.toUpperCase()).join(' · '))}</span>
  <span class="ticker-item">${esc(h1.toUpperCase())} &nbsp;·&nbsp; MARKET DATA NEWS</span>
  <span class="ticker-item">${esc(primaryKeyword.toUpperCase())} &nbsp;·&nbsp; ${esc(secondaryKeywords.slice(0,3).map(s => s.toUpperCase()).join(' · '))}</span>
</div></div>

<div class="fw-alertbar">
  <div class="fw-alertbar-inner">
    <a href="${articlePathPrefix}calendar.html" class="fw-alertbar-brand">Feed<span>Watch</span></a>
    <div class="fw-alertbar-divider"></div>
    <div class="fw-alertbar-stats">
      <a href="${articlePathPrefix}calendar.html?filter=critical" class="fw-alertbar-stat critical"><span class="fw-alertbar-dot"></span><span id="fw-critical-count" class="fw-alertbar-num">—</span><span class="fw-alertbar-label">Critical</span></a>
      <a href="${articlePathPrefix}calendar.html?filter=high" class="fw-alertbar-stat high"><span id="fw-high-count" class="fw-alertbar-num">—</span><span class="fw-alertbar-label">High</span></a>
      <a href="${articlePathPrefix}calendar.html?filter=action" class="fw-alertbar-stat action"><span id="fw-action-count" class="fw-alertbar-num">—</span><span class="fw-alertbar-label">Action Required</span></a>
      <a href="${articlePathPrefix}calendar.html" class="fw-alertbar-stat total"><span id="fw-active-count" class="fw-alertbar-num">—</span><span class="fw-alertbar-label">Active Entries</span></a>
    </div>
    <div class="fw-alertbar-divider"></div>
    <div class="fw-alertbar-next">
      <span class="fw-alertbar-next-label">Next deadline:</span>
      <span id="fw-next-deadline" class="fw-alertbar-next-val">Loading…</span>
    </div>
    <a href="${articlePathPrefix}calendar.html" class="fw-alertbar-cta">View All →</a>
  </div>
</div>

<div class="masthead">
  <div class="masthead-top">
    <div class="date-line" id="dateLine">Loading...</div>
    <a href="${articlePathPrefix}index.html" class="site-title">Market Data <span>News</span></a>
    <div class="tagline">The Industry Standard<br>Since 2025</div>
  </div>
  <nav>
    <a href="${articlePathPrefix}index.html" style="text-decoration:none;border-left:1px solid var(--rule);border-right:1px solid var(--rule);padding:0 10px;display:flex;align-items:center;flex-shrink:0;" title="Market Data News">
      <img src="${articlePathPrefix}favicon.svg" alt="MDN" style="height:26px;width:26px;display:block;">
    </a>
    <a href="${articlePathPrefix}index.html" class="nav-item">Home</a>
    <div class="nav-dropdown">
      <span class="nav-item active">Intelligence &#9662;</span>
      <div class="nav-dropdown-menu">
        <div class="nav-drop-group">Trackers</div>
        <a href="${articlePathPrefix}calendar.html" class="nav-drop-item">FeedWatch Calendar</a>
        <a href="${articlePathPrefix}nms.html" class="nav-drop-item">NMS / SIP Plans</a>
        <a href="${articlePathPrefix}feed-status.html" class="nav-drop-item">Feed Status</a>
        <a href="${articlePathPrefix}rule-filings.html" class="nav-drop-item">Rule Filings</a>
        <a href="${articlePathPrefix}regulation.html" class="nav-drop-item">Regulation</a>
        <a href="${articlePathPrefix}prediction-markets.html" class="nav-drop-item">Prediction Markets</a>
        <a href="${articlePathPrefix}ai-digest.html" class="nav-drop-item">AI Digest</a>
        <div class="nav-drop-divider"></div>
        <div class="nav-drop-group">Articles</div>
        <a href="${articlePathPrefix}articles/cme-globex-notices-2026.html" class="nav-drop-item">CME Globex Notices 2026</a>
        <a href="${articlePathPrefix}articles/finra-slate-guide.html" class="nav-drop-item">FINRA SLATE Guide</a>
        <a href="${articlePathPrefix}articles/index.html" class="nav-drop-item">View All Articles</a>
      </div>
    </div>
    <div class="nav-dropdown">
      <span class="nav-item">Market Structure &#9662;</span>
      <div class="nav-dropdown-menu">
        <a href="${articlePathPrefix}market-structure.html#maker-taker" class="nav-drop-item">Maker-Taker Tracker</a>
        <a href="${articlePathPrefix}market-structure.html#dark-pools" class="nav-drop-item">ATS Dark Pool Monitor</a>
        <a href="${articlePathPrefix}market-structure.html#new-exchanges" class="nav-drop-item">New Exchange Tracker</a>
        <a href="${articlePathPrefix}market-structure.html" class="nav-drop-item">View All</a>
      </div>
    </div>
    <div class="nav-dropdown">
      <span class="nav-item">Tools &#9662;</span>
      <div class="nav-dropdown-menu nav-dropdown-right">
        <a href="${articlePathPrefix}market-data-fees.html" class="nav-drop-item">Fee Calculator</a>
        <a href="${articlePathPrefix}peer-groups.html" class="nav-drop-item">Peer Groups</a>
        <a href="${articlePathPrefix}contract-intelligence.html" class="nav-drop-item">Contract Intelligence</a>
        <a href="${articlePathPrefix}rulebook-navigator.html" class="nav-drop-item">Rulebooks</a>
        <a href="${articlePathPrefix}execution-quality.html" class="nav-drop-item">Execution Quality</a>
      </div>
    </div>
    <div class="nav-dropdown">
      <span class="nav-item">Learn &#9662;</span>
      <div class="nav-dropdown-menu nav-dropdown-right">
        <a href="${articlePathPrefix}market-ecosystem.html" class="nav-drop-item">Market Ecosystem</a>
        <a href="${articlePathPrefix}learn.html#sip" class="nav-drop-item">How the SIP Works</a>
        <a href="${articlePathPrefix}learn.html#opra" class="nav-drop-item">The OPRA Model</a>
        <a href="${articlePathPrefix}learn.html#futures" class="nav-drop-item">Futures Market Data</a>
        <a href="${articlePathPrefix}learn.html" class="nav-drop-item">View All Lessons</a>
      </div>
    </div>
    <a href="${articlePathPrefix}subscribe.html" class="nav-item nav-subscribe">Subscribe →</a>
    <div class="nav-right">
      <div style="position:relative;display:flex;align-items:center;" id="search-wrap">
        <input class="search-box" type="text" placeholder="Search site..." id="search-input" onkeydown="if(event.key==='Enter') doSearch()" autocomplete="off">
      </div>
    </div>
  </nav>
  <div style="display:none;align-items:center;justify-content:space-between;padding:8px 20px" id="mobileBar">
    <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase">Menu</span>
    <button class="hamburger" id="hamburger" onclick="toggleMobileNav()" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</div>
<div class="mobile-nav" id="mobileNav">
  <a href="${articlePathPrefix}index.html">Home</a>
  <div class="mob-group-label">Intelligence</div>
  <a href="${articlePathPrefix}calendar.html">FeedWatch Calendar</a>
  <a href="${articlePathPrefix}nms.html">NMS / SIP Plans</a>
  <a href="${articlePathPrefix}feed-status.html">Feed Status</a>
  <a href="${articlePathPrefix}rule-filings.html">Rule Filings</a>
  <a href="${articlePathPrefix}regulation.html">Regulation</a>
  <a href="${articlePathPrefix}prediction-markets.html">Prediction Markets</a>
  <a href="${articlePathPrefix}ai-digest.html">AI Digest</a>
  <a href="${articlePathPrefix}articles/cme-globex-notices-2026.html">CME Globex Notices 2026</a>
  <a href="${articlePathPrefix}articles/finra-slate-guide.html">FINRA SLATE Guide</a>
  <a href="${articlePathPrefix}articles/index.html">View All Articles</a>
  <div class="mob-group-label">Market Structure</div>
  <a href="${articlePathPrefix}market-structure.html#maker-taker">Maker-Taker Tracker</a>
  <a href="${articlePathPrefix}market-structure.html#dark-pools">ATS Dark Pool Monitor</a>
  <a href="${articlePathPrefix}market-structure.html#new-exchanges">New Exchange Tracker</a>
  <div class="mob-group-label">Tools</div>
  <a href="${articlePathPrefix}market-data-fees.html">Fee Calculator</a>
  <a href="${articlePathPrefix}peer-groups.html">Peer Groups</a>
  <a href="${articlePathPrefix}contract-intelligence.html">Contract Intelligence</a>
  <a href="${articlePathPrefix}rulebook-navigator.html">Rulebooks</a>
  <a href="${articlePathPrefix}execution-quality.html">Execution Quality</a>
  <div class="mob-group-label">Learn</div>
  <a href="${articlePathPrefix}market-ecosystem.html">Market Ecosystem</a>
  <a href="${articlePathPrefix}learn.html#sip">How the SIP Works</a>
  <a href="${articlePathPrefix}learn.html#opra">The OPRA Model</a>
  <a href="${articlePathPrefix}learn.html#futures">Futures Market Data</a>
  <a href="${articlePathPrefix}learn.html">View All Lessons</a>
  <a href="${articlePathPrefix}subscribe.html">Subscribe</a>
  <a href="${articlePathPrefix}about.html">About</a>
</div>

<div class="article-hero">
  <div class="article-hero-inner">
    ${breadcrumbHtml}
    <div class="article-hero-label"><span class="badge badge-${type === 'article' ? 'analysis' : type === 'deep-dive' ? 'deepdive' : type === 'glossary' ? 'glossary' : type === 'exchange-page' ? 'exchange' : type === 'plan-page' ? 'plan' : 'regulatory'}">${esc(typeLabel)}</span></div>
    <h1 class="article-hero-title">${esc(h1)}</h1>
    <div class="article-hero-meta">
      <div class="article-hero-meta-item"><strong>Published:</strong> ${esc(today)}</div>
      <div class="article-hero-meta-item"><strong>Type:</strong> ${esc(typeLabel)}</div>
      <div class="article-hero-meta-item"><strong>Audience:</strong> Market Data Professionals</div>
    </div>
  </div>
</div>

<div class="article-body">
${bodyContent}
</div>

<footer>
  <div class="footer-grid">
    <div>
      <div class="footer-brand">Market Data <span>News</span></div>
      <div class="footer-desc">The authoritative source for market data industry professionals. Exchange notices, feed changes, regulatory deadlines, and NMS intelligence.</div>
    </div>
    <div class="footer-col"><h4>Coverage</h4>
      <a href="${articlePathPrefix}exchanges.html">Exchanges</a>
      <a href="${articlePathPrefix}regulation.html">Regulation</a>
      <a href="${articlePathPrefix}nms.html">NMS / SIP</a>
      <a href="${articlePathPrefix}feed-status.html">Feed Status</a>
      <a href="${articlePathPrefix}prediction-markets.html">Prediction Markets</a>
    </div>
    <div class="footer-col"><h4>Articles</h4>
      <a href="${articlePathPrefix}articles/index.html">All Articles</a>
      <a href="${articlePathPrefix}articles/cme-globex-notices-2026.html">CME Globex Tracker</a>
      <a href="${articlePathPrefix}articles/finra-slate-guide.html">FINRA SLATE Guide</a>
      <a href="${articlePathPrefix}learn.html#sip">SIP Feed Guide</a>
    </div>
    <div class="footer-col"><h4>Company</h4>
      <a href="${articlePathPrefix}about.html">About</a>
      <a href="${articlePathPrefix}subscribe.html">Subscribe</a>
      <a href="mailto:contact@marketdatanews.com">Contact</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 MarketDataNews.com — All rights reserved</span>
    <span>For market data professionals</span>
  </div>
</footer>

<script>
const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const now = new Date();
document.getElementById('dateLine').textContent = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
function toggleMobileNav() { document.getElementById('mobileNav').classList.toggle('open'); }
window.addEventListener('scroll', () => {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  document.getElementById('progressBar').style.width = pct + '%';
});
</script>
<script src="${articlePathPrefix}search-global.js"></script>
<script src="${articlePathPrefix}chat-widget.js"></script>
<script src="${articlePathPrefix}feedwatch-bar.js"></script>
</body>
</html>`;
}

// ─── Body content wrapper ─────────────────────────────────────────────────────
function wrapBodyContent(rawContent) {
  // Wrap bare H2/H3/p content in article-section divs for correct styling.
  // The Claude output uses h2, h3, p, ul, li, strong, em — wrap each H2 block.
  const lines = rawContent.split(/\n/);
  let result = '';
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^<h2[\s>]/i.test(trimmed)) {
      if (inSection) result += '</div>\n';
      result += '<div class="article-section">\n';
      inSection = true;
    }
    result += line + '\n';
  }
  if (inSection) result += '</div>\n';

  // If no h2 found, just wrap everything
  if (!inSection && rawContent.trim()) {
    result = '<div class="article-section">\n' + rawContent + '\n</div>\n';
  }

  return result;
}

// ─── Extract VERIFY placeholders ──────────────────────────────────────────────
function extractVerifyPlaceholders(text) {
  const matches = [];
  const re = /\[VERIFY:\s*([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!matches.includes(m[0])) matches.push(m[0]);
  }
  return matches;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('Error: ANTHROPIC_API_KEY environment variable is not set.\n');
    process.stderr.write('Export it before running: export ANTHROPIC_API_KEY=sk-...\n');
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const errors = validateArgs(args);
  if (errors.length > 0) {
    process.stderr.write('Usage: node scripts/seo-generate.mjs --topic "..." --type <type> [--dry-run]\n');
    process.stderr.write('Types: ' + VALID_TYPES.join(', ') + '\n\n');
    for (const e of errors) process.stderr.write('Error: ' + e + '\n');
    process.exit(1);
  }

  const { topic, type, dryRun } = args;

  // Step 1: Load context
  process.stdout.write(`[seo-generate] Loading context...\n`);
  let keywords;
  try {
    keywords = JSON.parse(readFileSync(KEYWORDS_PATH, 'utf8'));
  } catch (e) {
    process.stderr.write(`Error: Could not load seo-keywords.json: ${e.message}\n`);
    process.exit(1);
  }

  const pageMap = scanPages(FILES_DIR);
  const slug = deriveSlug(topic);

  // Step 2: Check for existing file
  const outputPath = computeOutputPath(type, slug);
  const pageUrl = computePageUrl(type, slug);

  if (existsSync(outputPath)) {
    process.stderr.write(`Error: File already exists: ${outputPath}\n`);
    process.stderr.write('seo-generate.mjs never overwrites existing files. Use a different topic/slug.\n');
    process.exit(1);
  }

  process.stdout.write(`[seo-generate] Topic: ${topic}\n`);
  process.stdout.write(`[seo-generate] Type: ${type}\n`);
  process.stdout.write(`[seo-generate] Slug: ${slug}\n`);
  process.stdout.write(`[seo-generate] Output: ${outputPath}\n`);
  if (dryRun) process.stdout.write(`[seo-generate] DRY RUN — will not write file\n`);
  process.stdout.write('\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const compactKw = buildCompactKeywords(keywords);
  const pageMapSummary = buildPageMapSummary(pageMap);

  // Step 3: Keyword research
  process.stdout.write(`[seo-generate] Step 1/3: Keyword research...\n`);
  const kwUserPrompt = `Topic: "${topic}"
Type: ${type}

Keyword dictionary (term + cluster):
${JSON.stringify(compactKw, null, 2)}

Based on this topic and the keyword dictionary, return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "primaryKeyword": "string — the single best-fit keyword from the dictionary for this topic",
  "secondaryKeywords": ["string", ...],
  "questionVariants": ["string", ...],
  "suggestedSlug": "string",
  "relatedClusters": ["string", ...]
}

Requirements:
- primaryKeyword must be a term or variant from the dictionary above
- secondaryKeywords: 5-8 industry-specific terms practitioners would search (may include dictionary terms or related practitioner phrases)
- questionVariants: 3-5 questions that market data professionals at banks/HFTs/exchanges would actually search
- suggestedSlug: URL-safe, hyphenated, descriptive slug for the page
- relatedClusters: which clusters from the dictionary this topic touches`;

  const kwRaw = await callClaude(client, SEO_SYSTEM, kwUserPrompt, 800);
  let kwData;
  try {
    kwData = extractJson(kwRaw);
  } catch (e) {
    process.stderr.write(`Error parsing keyword research response: ${e.message}\n`);
    process.stderr.write('Raw response:\n' + kwRaw + '\n');
    process.exit(1);
  }

  const primaryKeyword = kwData.primaryKeyword || topic;
  const secondaryKeywords = kwData.secondaryKeywords || [];
  const questionVariants = kwData.questionVariants || [];

  process.stdout.write(`[seo-generate]   Primary keyword: ${primaryKeyword}\n`);
  process.stdout.write(`[seo-generate]   Secondary: ${secondaryKeywords.slice(0, 4).join(', ')}\n`);

  // Step 4: Content outline
  process.stdout.write(`[seo-generate] Step 2/3: Content outline...\n`);
  const outlineUserPrompt = `Topic: "${topic}"
Type: ${type}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${secondaryKeywords.join(', ')}
Question variants: ${questionVariants.join('; ')}

Existing site pages (for internal link suggestions — only reference slugs from this list):
${pageMapSummary}

Return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "title": "string (under 60 chars, include primary keyword near start)",
  "metaDescription": "string (120-160 chars, keyword + value prop for practitioners)",
  "h1": "string (the page heading — can be longer/more descriptive than title)",
  "outline": [
    { "level": 2, "heading": "string", "notes": "what to cover, 1-2 sentences" },
    { "level": 3, "heading": "string", "notes": "string" }
  ],
  "linksTo": [
    { "slug": "string (must exist in site page list above)", "anchor": "string", "context": "where in article to link" }
  ],
  "linkedFrom": [
    { "slug": "string (must exist in site page list above)", "section": "string" }
  ],
  "faqQuestions": ["string", ...]
}

Requirements:
- Title: under 60 chars, primary keyword prominent
- Meta description: 120-160 chars, practitioner-first language
- Outline: 4-7 H2 sections with logical progression for a B2B practitioner audience
- At least 3 H2 sections with sub-H3 items
- linksTo: 2-4 internal links to EXISTING pages only (verify slug exists in the page list)
- linkedFrom: 1-3 pages that should link to this new page
- faqQuestions: 3-5 genuine practitioner questions`;

  const outlineRaw = await callClaude(client, SEO_SYSTEM, outlineUserPrompt, 1200);
  let outlineData;
  try {
    outlineData = extractJson(outlineRaw);
  } catch (e) {
    process.stderr.write(`Error parsing outline response: ${e.message}\n`);
    process.stderr.write('Raw response:\n' + outlineRaw + '\n');
    process.exit(1);
  }

  const title = outlineData.title || `${primaryKeyword} | Market Data News`;
  const metaDescription = outlineData.metaDescription || `${topic} — market data professional guide`;
  const h1 = outlineData.h1 || title;
  const outline = outlineData.outline || [];
  const linksTo = (outlineData.linksTo || []).filter(l => {
    // Verify slug exists in page map
    return pageMap.some(p => p.slug === l.slug || p.slug === l.slug.replace(/\.html$/, ''));
  });
  const linkedFrom = (outlineData.linkedFrom || []).filter(l => {
    return pageMap.some(p => p.slug === l.slug || p.slug === l.slug.replace(/\.html$/, ''));
  });
  const faqQuestions = outlineData.faqQuestions || [];

  if (dryRun) {
    process.stdout.write('\n══════════════════════════════════════════════════\n');
    process.stdout.write('DRY RUN — Outline only (file not written)\n');
    process.stdout.write('══════════════════════════════════════════════════\n\n');
    process.stdout.write(`Title:            ${title}\n`);
    process.stdout.write(`Meta description: ${metaDescription}\n`);
    process.stdout.write(`H1:               ${h1}\n\n`);
    process.stdout.write('Outline:\n');
    for (const item of outline) {
      const indent = item.level === 2 ? '  ' : '    ';
      process.stdout.write(`${indent}H${item.level}: ${item.heading}\n`);
      if (item.notes) process.stdout.write(`${indent}    → ${item.notes}\n`);
    }
    process.stdout.write('\nFAQ Questions:\n');
    for (const q of faqQuestions) process.stdout.write(`  • ${q}\n`);
    process.stdout.write('\nInternal links TO:\n');
    for (const l of linksTo) process.stdout.write(`  → ${l.slug} ("${l.anchor}")\n`);
    process.stdout.write('\nInternal links FROM:\n');
    for (const l of linkedFrom) process.stdout.write(`  ← ${l.slug} (${l.section})\n`);
    process.stdout.write('\n');
    return;
  }

  // Step 5: Full content generation
  process.stdout.write(`[seo-generate] Step 3/3: Generating content...\n`);

  const outlineText = outline.map(item => {
    const prefix = '#'.repeat(item.level);
    return `${prefix} ${item.heading}\nNotes: ${item.notes || ''}`;
  }).join('\n\n');

  const contentUserPrompt = `Write the complete article body for this page. Return ONLY the HTML fragment — no <html>, <head>, or <body> tags. No explanation before or after the HTML.

Topic: "${topic}"
Type: ${type}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${secondaryKeywords.join(', ')}
Page URL: ${pageUrl}

Outline to follow:
${outlineText}

FAQ questions to include at the end:
${faqQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Internal links to weave in (use these anchors linking to these paths):
${linksTo.map(l => `- Link to "${l.slug}" using anchor text "${l.anchor}" — context: ${l.context}`).join('\n')}

Requirements:
- Opening <p class="article-lead"> paragraph with primary keyword in first 100 words
- All H2/H3 sections from outline — use <h2> and <h3> tags directly (styling is handled by CSS)
- Each H2 section: 150-300 words of substantive practitioner content
- FAQ section at end: use <h2>Frequently Asked Questions</h2> then Q:/A: format in <p> tags
- Conclusion paragraph with primary keyword
- Use only: <h2>, <h3>, <p>, <ul>, <li>, <ol>, <strong>, <em>, <a> tags
- Internal links: use <a href="[slug]"> where slug is the path from the outline above
- Use [VERIFY: description] for any specific numbers, dates, fee amounts, or regulatory references you are not certain of
- Do NOT fabricate specific regulatory details, exact fee amounts, or filing citations
- Write for practitioners: precise, direct, no fluff`;

  const contentRaw = await callClaude(client, CONTENT_SYSTEM, contentUserPrompt, 4000);

  // Wrap content in article-section divs
  const wrappedContent = wrapBodyContent(contentRaw);

  // Step 6: Assemble HTML
  const today = new Date().toISOString().split('T')[0];
  const todayFormatted = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const allKeywords = [primaryKeyword, ...secondaryKeywords].join(', ');

  const articleJsonLd = buildArticleJsonLd(h1, metaDescription, pageUrl, today, allKeywords);
  const faqJsonLd = faqQuestions.length > 0 ? buildFaqJsonLd(faqQuestions) : null;

  const finalHtml = assembleHtml({
    title,
    metaDescription,
    canonical: pageUrl,
    slug,
    pageUrl,
    ogTitle: title,
    ogDescription: metaDescription,
    ogUrl: pageUrl,
    primaryKeyword,
    secondaryKeywords,
    articleJsonLd,
    faqJsonLd,
    bodyContent: wrappedContent,
    today: todayFormatted,
    type,
    h1,
  });

  // Step 7: Write file
  const outDir = outputPath.replace(/\/[^/]+\.html$/, '');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, finalHtml, 'utf8');

  // Extract VERIFY placeholders
  const verifyItems = extractVerifyPlaceholders(contentRaw);

  // Print summary
  const relOutputPath = outputPath.replace(ROOT + '/', '');
  process.stdout.write('\n');
  process.stdout.write(`✓ Generated: ${relOutputPath}\n\n`);
  process.stdout.write(`Primary keyword:   ${primaryKeyword}\n`);
  process.stdout.write(`Secondary:         ${secondaryKeywords.join(', ')}\n`);
  process.stdout.write(`Question variants:\n`);
  for (const q of questionVariants) process.stdout.write(`  • ${q}\n`);
  process.stdout.write('\n');

  if (linksTo.length > 0) {
    process.stdout.write('Internal links TO add (from this page → to existing pages):\n');
    for (const l of linksTo) {
      const pg = pageMap.find(p => p.slug === l.slug);
      process.stdout.write(`  → ${l.slug} (${pg ? pg.title : 'existing page'})\n`);
    }
    process.stdout.write('\n');
  }

  if (linkedFrom.length > 0) {
    process.stdout.write('Internal links FROM (these existing pages should link here):\n');
    for (const l of linkedFrom) process.stdout.write(`  ← ${l.slug} (${l.section})\n`);
    process.stdout.write('\n');
  }

  if (verifyItems.length > 0) {
    process.stdout.write('[VERIFY] placeholders requiring manual review:\n');
    for (const v of verifyItems) process.stdout.write(`  • ${v}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(`Next step: node scripts/seo-audit.mjs (to check the new page)\n`);
}

main().catch(e => {
  process.stderr.write(`[seo-generate] Fatal error: ${e.message}\n${e.stack}\n`);
  process.exit(2);
});
