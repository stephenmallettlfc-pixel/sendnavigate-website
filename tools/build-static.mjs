import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const rootPublic = new Set([
  'robots.txt', 'sitemap.xml', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png',
  'site.webmanifest', 'icon-192.png', 'icon-512.png',
  'Parent Shield - Kindle Cover.jpg', 'cover-kindle.jpg', 'send_navigate_banner.png',
  'ehcp-case-building-checklist.pdf', 'sample_eef_mapping.pdf',
  'sample_facilitator_guide.pdf', 'sample_module1_slides.pdf', 'wb.pdf'
]);
const assetExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.ico', '.css', '.js', '.mp3', '.wav', '.woff', '.woff2', '.ttf']);
const downloadPublic = new Set(['SEND-Navigate-EHCP-Action-Pack.zip']);
let copied = 0;
function copy(file, relative) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Non-regular public file: ' + relative);
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
  copied++;
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith('.html') || rootPublic.has(entry.name))) copy(path.join(root, entry.name), entry.name);
}
function walk(directory, predicate) {
  if (!fs.existsSync(path.join(root, directory))) return;
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative, predicate);
    else if (entry.isFile() && predicate(relative)) copy(path.join(root, relative), relative);
  }
}
walk('blog', relative => relative.endsWith('.html'));
walk('assets', relative => assetExtensions.has(path.extname(relative).toLowerCase()));
walk('downloads', relative => downloadPublic.has(path.basename(relative)));
if (!fs.existsSync(path.join(output, 'index.html'))) throw new Error('Static output is missing index.html');
for (const forbidden of ['package.json', 'package-lock.json', 'netlify.toml', 'TODO.md', 'netlify', 'tools', '.git', 'manuscript_temp.docx', 'SEN_Casework_Capability_Playbook.docx']) {
  if (fs.existsSync(path.join(output, forbidden))) throw new Error('Private file leaked into output: ' + forbidden);
}
console.log(`Static build: ${copied} allowlisted files in dist; private source/configuration excluded.`);
