// The viewer boots without the format decoders: DICOM, NRRD, OME-TIFF and
// the SEG/RTSTRUCT readers load on first use (lib/formatLoaders.ts and the
// dynamic imports that reach it). One static import of a parser module from
// a boot-path file puts it back in the entry chunk without a warning, so the
// built entry is checked two ways: a byte budget, and a string literal from
// each decoder that must not be in it (minifiers keep string literals).
//
//   node scripts/check-entry.mjs [dist dir]   (after `npm run build:app`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'packages/app/dist';
// 268.1 kB at the change that made the decoders lazy (2026-09-25); the
// budget leaves room for viewer work, not for a decoder (the smallest is
// several kB and the DICOM set together ~70 kB).
const BUDGET = 300_000;
const MARKERS = [
  ['DICOM parser (io/dicom-parse)', 'unterminated implicit sequence'],
  ['DICOM dataset reader (io/dcm-read)', 'sequence delimited before item end'],
  ['JPEG decoders (io/jpeg-*)', 'sos-before-sof'],
  ['NRRD parser (io/nrrd)', 'no blank line separating header'],
  ['OME-TIFF parser (io/ome-tiff)', 'bad byte-order mark (not II/MM)'],
  ['SEG reader (io/seg)', 'SEG has no PixelData'],
];

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const src = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
if (!src) throw new Error(`check-entry: no module script in ${join(dist, 'index.html')}`);
const file = join(dist, 'assets', src.slice(src.lastIndexOf('/') + 1));
const code = readFileSync(file, 'utf8');
const bytes = Buffer.byteLength(code);
const failures = [];
if (bytes > BUDGET) failures.push(`entry is ${bytes} bytes, budget ${BUDGET}`);
for (const [what, literal] of MARKERS) {
  if (code.includes(literal)) failures.push(`${what} is in the entry (found "${literal}")`);
}
if (failures.length > 0) {
  console.error(`check-entry: FAIL ${file}\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-entry: PASS ${file} ${(bytes / 1000).toFixed(1)} kB (budget ${BUDGET / 1000} kB), no decoder in it`);
