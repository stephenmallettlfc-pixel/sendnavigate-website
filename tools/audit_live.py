#!/usr/bin/env python3
"""Read-only SEND Navigate audit; uses stdlib, no Google scraping or paid API."""
import argparse
import concurrent.futures
import http.client
import json
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ORIGIN = 'https://sendnavigate.org'

class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.title = ''; self.in_title = False; self.h1 = 0
        self.canonical = None; self.description = None; self.robots = ''; self.links = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'title': self.in_title = True
        if tag == 'h1': self.h1 += 1
        if tag == 'link' and a.get('rel') == 'canonical': self.canonical = a.get('href')
        if tag == 'meta' and a.get('name') == 'description': self.description = a.get('content')
        if tag == 'meta' and a.get('name') == 'robots': self.robots = a.get('content', '')
        if tag == 'a' and a.get('href'): self.links.append(a['href'])
    def handle_endtag(self, tag):
        if tag == 'title': self.in_title = False
    def handle_data(self, data):
        if self.in_title: self.title += data

def get(url, parse=False):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SENDNavigate-SEO-Audit/1.0'})
        with urllib.request.urlopen(req, timeout=25) as r:
            result = {'url': url, 'status': r.status, 'final_url': r.url}
            body = r.read().decode('utf-8', errors='replace')
            if parse:
                page = Page(); page.feed(body)
                result.update(title=page.title, description=page.description, canonical=page.canonical, h1_count=page.h1, robots=page.robots)
                result['_links'] = page.links
            else: result['_body'] = body
            return result
    except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
        return {'url': url, 'status': getattr(exc, 'code', None), 'error': str(exc)}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); args = parser.parse_args()
    sitemap = get(ORIGIN + '/sitemap.xml'); robots = get(ORIGIN + '/robots.txt')
    if '_body' not in sitemap: raise SystemExit('Sitemap could not be fetched: ' + str(sitemap))
    urls = [node.text for node in ET.fromstring(sitemap['_body']).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(lambda u: get(u, True), urls))
    internal = set()
    for p in pages:
        for link in p.pop('_links', []):
            absolute = urllib.parse.urljoin(p['url'], link); parts = urllib.parse.urlsplit(absolute)
            if parts.scheme in ('http', 'https') and parts.netloc == 'sendnavigate.org':
                if parts.path.startswith('/.netlify/') or parts.path.startswith('/downloads/'): continue
                internal.add(urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, '', '')))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checks = list(pool.map(get, sorted(internal)))
    for c in checks: c.pop('_body', None)
    issues = []
    for p in pages:
        if p.get('status') != 200: issues.append({'url':p['url'], 'issue':'Not HTTP 200'})
        if not p.get('title') or p.get('h1_count') != 1: issues.append({'url':p['url'], 'issue':'Title/H1 needs review'})
        if not p.get('description'): issues.append({'url':p['url'], 'issue':'Missing description'})
        if p.get('canonical') != p['url']: issues.append({'url':p['url'], 'issue':'Missing/mismatched canonical'})
        if 'noindex' in p.get('robots',''): issues.append({'url':p['url'], 'issue':'Noindex page in sitemap'})
    for c in checks:
        if c.get('status') != 200: issues.append({'url':c['url'], 'issue':'Internal link does not return 200','status':c.get('status')})
    output = {'sitemap_page_count': len(urls), 'internal_urls_checked': len(checks), 'robots_status': robots.get('status'), 'pages': pages, 'issues': issues}
    dest = Path(args.output); dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'pages':len(urls),'links':len(checks),'issues':issues,'output':str(dest)}, indent=2))

if __name__ == '__main__': main()
