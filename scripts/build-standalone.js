#!/usr/bin/env node
/**
 * Build self-contained ad files.
 *
 * Reads each public/ads/*.html, inlines every reference under ../assets/
 * (SVGs as inline <svg>, everything else as base64 data URIs), and writes
 * the result to public/standalone/. The Polymarket Gamma API call and the
 * Google Fonts <link> stay external by design.
 *
 * Run:   node scripts/build-standalone.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Each version: { adsDir, outDir, assetDirs (in resolution order) }
const VERSIONS = [
  {
    name: 'v1',
    adsDir:  path.join(ROOT, 'public/ads'),
    outDir:  path.join(ROOT, 'public/standalone'),
    assetDirs: [path.join(ROOT, 'public/assets')],
  },
  {
    name: 'v2',
    adsDir:  path.join(ROOT, 'public/ads-v2'),
    outDir:  path.join(ROOT, 'public/standalone-v2'),
    // v2 references both assets-v2/ (bg-people, bg-newspaper) and assets/ (logos, icons)
    assetDirs: [
      path.join(ROOT, 'public/assets-v2'),
      path.join(ROOT, 'public/assets'),
    ],
  },
];

const MIME = {
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.svg':   'image/svg+xml',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

// Resolve "../assets/X" or "../assets-v2/X" against the version's asset dirs (first hit wins)
function resolveAssetRef(relPath, assetDirs) {
  // relPath like "../assets/foo/bar.png" or "../assets-v2/bg.png"
  const m = relPath.match(/^\.\.\/(assets(?:-[a-z0-9]+)?)\/(.+)$/);
  if (!m) return null;
  const [, folder, rest] = m;
  for (const dir of assetDirs) {
    if (path.basename(dir) === folder || dir.endsWith('/' + folder)) {
      const abs = path.join(dir, rest);
      if (fs.existsSync(abs)) return abs;
    }
  }
  // Fallback: try every asset dir
  for (const dir of assetDirs) {
    const abs = path.join(dir, rest);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function toDataUri(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const data = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${data}`;
}

function inlineSvg(absPath) {
  let svg = fs.readFileSync(absPath, 'utf8');
  svg = svg.replace(/<\?xml.*?\?>\s*/g, '');
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>\s*/gi, '');
  return svg.trim();
}

function svgToCssDataUri(absPath) {
  const svg = inlineSvg(absPath);
  // URL-encode (more compact than base64 for SVG; works in CSS url())
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

function processFile(htmlPath, assetDirs) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const missing = new Set();

  const tryResolve = (refPath) => {
    const abs = resolveAssetRef(refPath, assetDirs);
    if (!abs) {
      missing.add(refPath);
      return null;
    }
    return abs;
  };

  // 1) <img src="../assets[-v2]/X.svg" …> → inline <svg> (preserves any class= on the img)
  html = html.replace(
    /<img\b([^>]*?)\bsrc=["'](\.\.\/assets(?:-[a-z0-9]+)?\/[^"']+\.svg)["']([^>]*?)\/?>/gi,
    (match, before, ref, after) => {
      const abs = tryResolve(ref);
      if (!abs) return match;
      const svg = inlineSvg(abs);
      const attrs = (before + ' ' + after);
      const classMatch = attrs.match(/\bclass=["']([^"']*)["']/);
      const cssClass = classMatch ? classMatch[1] : null;
      if (cssClass) {
        if (/<svg[^>]*\bclass=/i.test(svg)) {
          return svg.replace(/<svg([^>]*)\bclass=["']([^"']*)["']/i,
            (m, mid, existing) => `<svg${mid}class="${existing} ${cssClass}"`);
        }
        return svg.replace(/<svg\b/i, `<svg class="${cssClass}"`);
      }
      return svg;
    }
  );

  // 2) <img src="../assets[-v2]/X.{png,jpg,…}" …> → base64 data URI
  html = html.replace(
    /(<img\b[^>]*?\bsrc=)["'](\.\.\/assets(?:-[a-z0-9]+)?\/[^"']+\.(?:png|jpe?g|gif|webp))["']/gi,
    (match, prefix, ref) => {
      const abs = tryResolve(ref);
      if (!abs) return match;
      return `${prefix}"${toDataUri(abs)}"`;
    }
  );

  // 3) url('../assets[-v2]/X') in CSS — fonts, pngs, svgs
  html = html.replace(
    /url\(\s*(['"]?)(\.\.\/assets(?:-[a-z0-9]+)?\/[^)'"]+)\1\s*\)/g,
    (match, quote, ref) => {
      const abs = tryResolve(ref);
      if (!abs) return match;
      const ext = path.extname(ref).toLowerCase();
      const uri = ext === '.svg' ? svgToCssDataUri(abs) : toDataUri(abs);
      return `url("${uri}")`;
    }
  );

  // 4) JS string literals "../assets[-v2]/X.{png,jpg,svg,…}"
  html = html.replace(
    /(['"])(\.\.\/assets(?:-[a-z0-9]+)?\/[^'"]+\.(?:png|jpe?g|gif|webp|svg))\1/g,
    (match, quote, ref) => {
      const abs = tryResolve(ref);
      if (!abs) return match;
      const ext = path.extname(ref).toLowerCase();
      const uri = ext === '.svg' ? svgToCssDataUri(abs) : toDataUri(abs);
      return `${quote}${uri}${quote}`;
    }
  );

  return { html, missing: Array.from(missing) };
}

// ── Build ───────────────────────────────────────────────────────────────────
let grandTotal = 0;
const grandMissing = new Set();

for (const v of VERSIONS) {
  if (!fs.existsSync(v.adsDir)) {
    console.log(`(skipping ${v.name} — no ${path.relative(ROOT, v.adsDir)})`);
    continue;
  }
  if (!fs.existsSync(v.outDir)) fs.mkdirSync(v.outDir, { recursive: true });

  console.log(`\n▸ ${v.name.toUpperCase()}  (${path.relative(ROOT, v.adsDir)} → ${path.relative(ROOT, v.outDir)})`);
  const files = fs.readdirSync(v.adsDir).filter(f => f.endsWith('.html')).sort();
  let totalBytes = 0;

  for (const name of files) {
    const { html, missing } = processFile(path.join(v.adsDir, name), v.assetDirs);
    const outPath = path.join(v.outDir, name);
    fs.writeFileSync(outPath, html);
    totalBytes += html.length;
    missing.forEach(m => grandMissing.add(`[${v.name}] ${m}`));
    const kb = (html.length / 1024).toFixed(1);
    console.log(`  ✓ ${name.padEnd(16)}  (${kb} KB)`);
  }
  console.log(`  ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KB total`);
  grandTotal += totalBytes;
}

console.log(`\nDone — ${(grandTotal / 1024).toFixed(1)} KB across all versions`);
if (grandMissing.size) {
  console.warn(`\n⚠ Missing assets (kept as original references):\n  ${[...grandMissing].join('\n  ')}`);
}
