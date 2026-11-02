import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const origin = 'https://sendnavigate.org';
const excluded = new Set(['Landing_Page.html', 'Parent_Shield_Landing_Page.html', 'book-free-call.html']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'tools', 'netlify'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) files.push(full);
  }
}
walk(root);
const urls = new Map();
let errors = 0;
const warnings = [];
const attr = (tag, key) => tag.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const strictLinkPages = new Set(['ehcp-refusal-to-assess-help.html', 'ehcp-refusal-to-issue-help.html', 'school-not-meeting-sen-needs.html', 'ehcp-appeal-refusal.html', 'school-distress-ebsa-help.html', 'free-consultation.html', 'index.html', 'ehcp-advisory.html', 'books.html', 'book.html', 'the-parents-shield.html', 'resources.html']);
function checkReferences(html, rel) {
  const base = new URL('/' + rel, origin);
  const seen = new Set();
  for (const tag of html.match(/<(?:a|img|script|link|source)\b[^>]*>/gi) || []) {
    const raw = attr(tag, 'href') || attr(tag, 'src');
    if (!raw || raw === '#' || /^(?:mailto:|tel:|data:|javascript:)/i.test(raw)) continue;
    let url;
    try { url = new URL(raw.replaceAll('&amp;', '&'), base); } catch { continue; }
    if (url.origin !== origin || url.pathname.startsWith('/.netlify/')) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
    const relative = pathname.replace(/^\//, '');
    const choices = [path.join(root, relative), path.join(root, relative + '.html'), path.join(root, relative, 'index.html')];
    const target = choices.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    let problem;
    if (!target) problem = 'missing local page or asset';
    else if (url.hash && target.endsWith('.html')) {
      let fragment;
      try { fragment = decodeURIComponent(url.hash.slice(1)); } catch { fragment = url.hash.slice(1); }
      const targetHtml = fs.readFileSync(target, 'utf8');
      const ids = (targetHtml.match(/<[^>]+>/g) || []).map(t => attr(t, 'id') || attr(t, 'name'));
      if (!ids.includes(fragment)) problem = 'missing fragment target';
    }
    if (problem) {
      const message = `${rel}: ${problem}: ${raw}`;
      if (strictLinkPages.has(rel)) { console.error(message); errors++; }
      else warnings.push(message);
    }
  }
}

for (const file of files.sort()) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (excluded.has(rel)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  if (metas.some(tag => attr(tag, 'name')?.toLowerCase() === 'robots' && /noindex/i.test(attr(tag, 'content') || ''))) continue;
  checkReferences(html, rel);
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const canonical = links.find(tag => attr(tag, 'rel')?.toLowerCase() === 'canonical');
  const inferred = origin + '/' + rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '').replace(/\/$/, '');
  const url = attr(canonical || '', 'href') || (rel === 'index.html' ? origin + '/' : inferred);
  if (!canonical) warnings.push(`${rel}: add a self-referencing canonical to source`);
  if (!url.startsWith(origin + '/')) { console.error(`${rel}: non-site canonical ${url}`); errors++; continue; }
  if (urls.has(url)) { console.error(`${rel}: duplicate canonical ${url}`); errors++; continue; }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1s = html.match(/<h1\b/gi) || [];
  if (!title || h1s.length !== 1) { console.error(`${rel}: missing title or not exactly one H1`); errors++; }
  if (!metas.some(tag => attr(tag, 'name')?.toLowerCase() === 'description' && attr(tag, 'content'))) warnings.push(`${rel}: missing meta description`);
  let lastmod;
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      for (const node of Array.isArray(data) ? data : data['@graph'] || [data]) {
        if (node.dateModified) lastmod = node.dateModified.slice(0, 10);
      }
    } catch { console.error(`${rel}: invalid JSON-LD`); errors++; }
  }
  if (!lastmod) {
    try { lastmod = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; }
    catch { /* Omit uncertain timestamps rather than inventing them. */ }
  }
  urls.set(url, { lastmod, rel });
}
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [...urls].sort(([a], [b]) => a.localeCompare(b)).map(([url, data]) => `  <url><loc>${escapeXml(url)}</loc>${data.lastmod ? `<lastmod>${escapeXml(data.lastmod)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
for (const warning of warnings) console.warn('SEO warning:', warning);
console.log(`SEO build: ${urls.size} canonical indexable pages; ${warnings.length} warnings; ${errors} errors. Sitemap generated.`);
if (errors) process.exitCode = 1;
