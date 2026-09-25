// samples/ against its checked-in manifest (packages/testkit/samples.manifest.json).
//
// samples/ is never committed (samples/.gitkeep), so nothing recorded what a
// complete set is: CARYS_REQUIRE_SAMPLES=1 failed on the first missing file
// and a stale or truncated file passed as long as it parsed. The manifest
// names every file with its size and SHA-256, and which npm script writes it
// when it is synthetic.
//
//   node scripts/samples-manifest.mjs            check: list what is missing,
//                                                 short or different; exit 1
//   node scripts/samples-manifest.mjs --write    rewrite the manifest from
//                                                 the samples/ on this disk
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SAMPLES = join(ROOT, 'samples');
const MANIFEST = join(ROOT, 'packages', 'testkit', 'samples.manifest.json');
/** Synthetic files and the script that writes them; the rest is real data. */
const GENERATED = [
  ['ct-head-series/', 'gen:ct'],
  ['cells_demo.zarr/', 'gen:cells'],
  ['plate_demo.zarr/', 'gen:plate'],
  ['precomputed_demo/', 'gen:precomputed'],
  ['tiny.ome.tif', 'gen:ometiff'],
  ['tczyx.ome.tif', 'gen:tczyx'],
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name !== '.gitkeep') out.push(relative(SAMPLES, p).split(sep).join('/'));
  }
  return out;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const genOf = (path) => GENERATED.find(([prefix]) => path === prefix || path.startsWith(prefix))?.[1];
const fmtMB = (b) => `${(b / 1e6).toFixed(1)} MB`;

let onDisk;
try {
  onDisk = walk(SAMPLES).sort();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  onDisk = [];
}

if (process.argv.includes('--write')) {
  if (onDisk.length === 0) throw new Error('samples/ is empty: refusing to write an empty manifest');
  const files = onDisk.map((path) => {
    const gen = genOf(path);
    return { path, bytes: statSync(join(SAMPLES, path)).size, sha256: sha256(join(SAMPLES, path)), ...(gen ? { gen } : {}) };
  });
  const doc = {
    about: 'Every file a complete samples/ holds (samples/.gitkeep). `gen` names the npm script that writes a synthetic file; the rest is public real data. Check with npm run samples:check; rewrite with npm run samples:manifest after changing the set on purpose.',
    files,
  };
  // one file per line: a changed fixture is a one-line diff
  const lines = files.map((f) => `    ${JSON.stringify(f)}`).join(',\n');
  writeFileSync(MANIFEST, `{\n  "about": ${JSON.stringify(doc.about)},\n  "files": [\n${lines}\n  ]\n}\n`);
  console.log(`samples manifest: ${files.length} files, ${fmtMB(files.reduce((n, f) => n + f.bytes, 0))} → ${relative(ROOT, MANIFEST)}`);
  process.exit(0);
}

const { files } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const present = new Set(onDisk);
const missing = [], wrong = [];
for (const f of files) {
  if (!present.has(f.path)) { missing.push(f); continue; }
  const abs = join(SAMPLES, f.path);
  const bytes = statSync(abs).size;
  if (bytes !== f.bytes) wrong.push(`${f.path}: ${bytes} bytes, manifest ${f.bytes}`);
  else if (sha256(abs) !== f.sha256) wrong.push(`${f.path}: same size, different content`);
}
const known = new Set(files.map((f) => f.path));
const extra = onDisk.filter((p) => !known.has(p));

if (missing.length > 0) {
  // grouped by top-level entry: 120 slices of one series are one line
  const groups = new Map();
  for (const f of missing) {
    const top = f.path.includes('/') ? `${f.path.split('/')[0]}/` : f.path;
    const g = groups.get(top) ?? { n: 0, bytes: 0, gen: f.gen };
    g.n++; g.bytes += f.bytes;
    groups.set(top, g);
  }
  console.error(`samples: ${missing.length} of ${files.length} files missing (${fmtMB(missing.reduce((n, f) => n + f.bytes, 0))}):`);
  for (const [top, g] of groups) {
    console.error(`  ${top}${g.n > 1 ? ` (${g.n} files)` : ''} ${fmtMB(g.bytes)} — ${g.gen ? `npm run ${g.gen}` : 'real data (samples/.gitkeep)'}`);
  }
}
for (const w of wrong) console.error(`samples: ${w}`);
for (const p of extra) console.warn(`samples: ${p} is not in the manifest (npm run samples:manifest if it belongs)`);
if (missing.length > 0 || wrong.length > 0) process.exit(1);
console.log(`samples: all ${files.length} manifest files present and matching (${fmtMB(files.reduce((n, f) => n + f.bytes, 0))})${extra.length ? `, ${extra.length} extra` : ''}`);
