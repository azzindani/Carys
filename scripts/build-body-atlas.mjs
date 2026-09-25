// The whole-body atlas digest, built from BodyParts3D.
//
//   npx tsc -b && node scripts/build-body-atlas.mjs   → digests/bodyparts3d-body/
//
// Source: BodyParts3D 4.0, the IS-A mesh set (obj_99; its 2,234 element
// meshes include the PART-OF set's 1,258) and the element and tree lists,
// CC BY 4.0, © The Database Center for Life Science. Downloads cache in
// .cache/bodyparts3d (gitignored); the vendored tree lists come from
// digests/bodyparts3d-terms.
//
// Every element mesh gets a body system from its concepts: its IS-A
// ancestry names what tissue it is (a bone organ, a muscle organ, a segment
// of an arterial tree…), its PART-OF ancestry which organ system holds it.
// Each is decimated (render-cpu decimate, F11) as far as a 0.5 mm distance
// to its source allows, both ways, measured on the packed (quantized) mesh
// with render-cpu surfaceDistance, and packed by system (render-cpu
// body-pack). Deterministic: same inputs, same bytes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BODY_SYSTEMS, bodyBounds, decimate, packBody, surfaceDistance, unpackBody, vertexNormals,
} from '../packages/render-cpu/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'bodyparts3d');
const OUT = join(ROOT, 'digests', 'bodyparts3d-body');
const BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/';
const ZIP = 'isa_BP3D_4.0_obj_99.zip';
const LISTS = ['isa_element_parts.txt', 'partof_element_parts.txt'];
/** Acceptance (H1): a packed part within this of its source, both ways, mm. */
const BOUND_MM = 0.5;
/** Decimation bounds tried, loosest first, until a part meets BOUND_MM. */
const TRIES = [0.95, 0.75, 0.55, 0.4, 0.3, 0.15, 0.075];
const PIN = 'BP3D-4.0-isa-obj99';

// ---- inputs ---------------------------------------------------------------
mkdirSync(join(CACHE, 'lists'), { recursive: true });
for (const f of [ZIP, ...LISTS]) {
  const at = f === ZIP ? join(CACHE, f) : join(CACHE, 'lists', f);
  if (!existsSync(at)) execFileSync('curl', ['-sS', '-o', at, BASE + f], { stdio: 'inherit' });
}
const OBJ_DIR = join(CACHE, 'isa_obj');
if (!existsSync(OBJ_DIR)) execFileSync('unzip', ['-q', '-o', join(CACHE, ZIP), '-d', OBJ_DIR], { stdio: 'inherit' });

/** Tab-separated rows after a header line. */
const rows = (file) => readFileSync(file, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));

/** concept → its element files, and concept names. */
function elementTable(file) {
  const el = new Map(), name = new Map();
  for (const [c, n, f] of rows(file)) {
    if (!el.has(c)) el.set(c, new Set());
    el.get(c).add(f.trim());
    name.set(c, n);
  }
  return { el, name };
}
const isa = elementTable(join(CACHE, 'lists', 'isa_element_parts.txt'));
const partof = elementTable(join(CACHE, 'lists', 'partof_element_parts.txt'));
const isaParent = new Map(), isaName = new Map();
for (const [p, pn, c, cn] of rows(join(ROOT, 'digests', 'bodyparts3d-terms', 'isa_inclusion_relation_list.txt'))) {
  if (!isaParent.has(c)) isaParent.set(c, new Set());
  isaParent.get(c).add(p);
  isaName.set(p, pn); isaName.set(c, cn);
}
const ancestors = (c, seen = new Set()) => {
  for (const p of isaParent.get(c) ?? []) if (!seen.has(p)) { seen.add(p); ancestors(p, seen); }
  return seen;
};

// ---- systems --------------------------------------------------------------
/** PART-OF nodes that are organ systems. */
const PART_SYSTEM = {
  FMA7157: 'nervous', FMA7161: 'cardiovascular', FMA228642: 'cardiovascular', FMA23881: 'skeletal',
  FMA7158: 'respiratory', FMA7152: 'digestive', FMA7159: 'urinary', FMA7160: 'reproductive',
  FMA9668: 'endocrine', FMA72979: 'integumentary', FMA74657: 'integumentary', FMA79063: 'muscular',
};

/** An element's own concept(s): the smallest ones holding it, the most
 *  specific first ("body of sternum" before "body of organ", which it is a
 *  kind of: more IS-A ancestors), then by id. */
function ownConcepts(f) {
  const holding = [...isa.el].filter(([, fs]) => fs.has(f)).map(([c]) => c);
  const least = Math.min(...holding.map((c) => isa.el.get(c).size));
  const depth = (c) => ancestors(c).size;
  return holding.filter((c) => isa.el.get(c).size === least).sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The body system of an element: tissue type first, then organ system. */
function systemOf(f, own) {
  const names = own.map((c) => isa.name.get(c)).join(' | ').toLowerCase();
  const kinds = own.flatMap((c) => [...ancestors(c)].map((a) => isaName.get(a))).join(' | ').toLowerCase();
  const t = `${names} || ${kinds}`;
  const part = new Set([...partof.el].filter(([c, fs]) => fs.has(f) && PART_SYSTEM[c]).map(([c]) => PART_SYSTEM[c]));
  // the liver's Couinaud segments are "hepatovenous": organ, not vessel
  if (/\bliver\b|hepatovenous segment|biliary|hepatic duct|cystic duct|bile duct|gallbladder/.test(names)) return 'digestive';
  if (/\barter(y|ies)\b|\bveins?\b|venous|arterial|vascular tree|aorta|vena cava/.test(t)) return 'cardiovascular';
  if (part.has('nervous') || /neuraxis|\bnerves?\b|brain|ganglion|spinal cord|cerebr|cerebell|gyrus|thalam|\bpons\b|medulla oblongata|midbrain|insula|subarachnoid|interventricular foramen/.test(t)) return 'nervous';
  if (part.has('cardiovascular') || /\bheart\b|myocard|papillary muscle|chorda tendinea|cardiac valve|leaflet of .* valve/.test(t)) return 'cardiovascular';
  if (/bone organ|cartilage organ/.test(kinds)) return 'skeletal';
  if (/\beye\b|eyeball|eyelid|lacrimal|cornea|\blens\b|\bretina\b|sclera|\biris\b|corona ciliaris|\bear\b|cochlea|auricle|tympanic|ossicle|conjunctiv/.test(names)) return 'sensory';
  // the male genitalia sit in no PART-OF system here
  if (/testis|epididymis|deferent duct|seminal vesicle|penis|prostate|ovary|uterus|vagina/.test(names)) return 'reproductive';
  if (part.has('skeletal') || /cartilage|ligament|intervertebral|meniscus|\bbone\b|phalanx|vertebra|\btooth\b|incisor|molar|premolar|canine|interosseous membrane/.test(t)) return 'skeletal';
  if (part.has('muscular') || /muscle organ|\bmuscles?\b|tendon|tendinous|aponeurosis|fascia|retinaculum|linea alba|interossei|lumbricals|levatores|intertransversarii|interspinales|trapezius/.test(t)) return 'muscular';
  if (/spleen|thymus|lymph|tonsil/.test(t)) return 'lymphatic';
  if (/conus elasticus|thyrohyoid membrane|larynx|laryngeal/.test(names)) return 'respiratory';
  if (/pharyn|\bmouth\b|sublingual gland|salivary|\bliver\b|pterygomandibular raphe/.test(names)) return 'digestive';
  if (/eyebrow|\bhair\b|\bnail\b/.test(names)) return 'integumentary';
  for (const s of ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine', 'integumentary']) if (part.has(s)) return s;
  if (/\bskin\b/.test(t)) return 'integumentary';
  return 'other';
}

// ---- meshes ---------------------------------------------------------------
/** OBJ vertices and faces (fans split into triangles), mm. */
function parseObj(text) {
  const P = [], I = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      P.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const v = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
      for (let k = 1; k + 1 < v.length; k++) I.push(v[0], v[k], v[k + 1]);
    }
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(I) };
}

const objFiles = new Map();
for (const dir of [OBJ_DIR, ...readdirSync(OBJ_DIR).map((d) => join(OBJ_DIR, d)).filter((d) => statSync(d).isDirectory())]) {
  for (const f of readdirSync(dir)) if (f.endsWith('.obj')) objFiles.set(f.replace(/\.obj$/, ''), join(dir, f));
}
const elements = [...new Set([...isa.el.values()].flatMap((s) => [...s]))].sort();
const missing = elements.filter((e) => !objFiles.has(e));
if (missing.length) throw new Error(`build-body-atlas: ${missing.length} element meshes missing from ${ZIP}: ${missing.slice(0, 5)}`);

console.log(`${elements.length} element meshes`);
const parts = [];
let t0 = Date.now();
for (const [n, element] of elements.entries()) {
  const own = ownConcepts(element);
  const src = parseObj(readFileSync(objFiles.get(element), 'utf8'));
  const mesh = { ...src, normals: Float32Array.from(vertexNormals(src.positions, src.indices)) };
  parts.push({
    fma: own[0], element, name: isa.name.get(own[0]), system: systemOf(element, own),
    sourceTris: src.indices.length / 3, errorMm: 0, src: mesh, positions: src.positions, indices: src.indices,
  });
  if (n % 250 === 0) console.log(`  read ${n}/${elements.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
// the quantization grid: the sources' bounds, padded (a decimated vertex
// can sit a fraction of a mm outside them)
const PAD_MM = 5;
const raw = bodyBounds(parts);
const bounds = { min: raw.min.map((v) => v - PAD_MM), max: raw.max.map((v) => v + PAD_MM) };

/** Largest distance between two meshes, both ways, mm. */
const twoWay = (a, b) => Math.max(surfaceDistance(a, b, [1, 1, 1], 4 * BOUND_MM).max, surfaceDistance(b, a, [1, 1, 1], 4 * BOUND_MM).max);
/** The part as it ships: quantized on the body's grid. */
const shipped = (p) => unpackBody(packBody([p], bounds)).parts[0];

t0 = Date.now();
for (const [n, p] of parts.entries()) {
  let chosen = null;
  for (const e of TRIES) {
    const d = decimate(p.src, { targetTris: 1, maxError: e });
    const cand = { ...p, positions: d.positions, indices: d.indices };
    const err = twoWay(shipped(cand), p.src);
    if (err <= BOUND_MM) { chosen = { ...cand, errorMm: err }; break; }
  }
  // no bound held: ship the source itself (quantization only)
  chosen ??= { ...p, errorMm: twoWay(shipped(p), p.src) };
  if (chosen.errorMm > BOUND_MM) throw new Error(`build-body-atlas: ${p.element} off by ${chosen.errorMm} mm even undecimated`);
  parts[n] = chosen;
  if (n % 250 === 0) console.log(`  decimated ${n}/${parts.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ---- output ---------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const index = {
  format: 'carys-body-index/1', pin: PIN,
  attribution: 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International',
  min: bounds.min, max: bounds.max, elements: parts.length, systems: {},
};
let totalTris = 0, totalBytes = 0, worst = 0;
for (const system of BODY_SYSTEMS) {
  const mine = parts.filter((p) => p.system === system);
  if (!mine.length) continue;
  const bytes = packBody(mine.map(({ src, ...p }) => p), bounds);
  const file = `${system}.cbdy`;
  writeFileSync(join(OUT, file), bytes);
  const tris = mine.reduce((s, p) => s + p.indices.length / 3, 0), source = mine.reduce((s, p) => s + p.sourceTris, 0);
  const err = Math.max(...mine.map((p) => p.errorMm));
  index.systems[system] = { file, parts: mine.length, tris, sourceTris: source, bytes: bytes.length, worstErrorMm: +err.toFixed(3) };
  totalTris += tris; totalBytes += bytes.length; worst = Math.max(worst, err);
  console.log(`${system.padEnd(14)} ${String(mine.length).padStart(5)} parts ${String(source).padStart(9)} → ${String(tris).padStart(8)} tris  ${(bytes.length / 1e6).toFixed(2)} MB  worst ${err.toFixed(3)} mm`);
}
index.tris = totalTris; index.bytes = totalBytes; index.worstErrorMm = +worst.toFixed(3);
// every part without its mesh, one row a line: the app finds a structure
// (and the system file holding it) before that file is fetched
const rowsText = parts.map((p) => `  ${JSON.stringify([p.element, p.fma, p.name, p.system])}`).join(',\n');
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1).replace(/\n}$/, `,\n "parts": [\n${rowsText}\n ]\n}\n`));
writeFileSync(join(OUT, 'SOURCES.json'), JSON.stringify({
  digest: 'bodyparts3d-body', format: 'carys-sources/1',
  sources: [{
    entry_count: parts.length, license_spdx: 'CC-BY-4.0', retrieved_date: '2026-09-23',
    source_url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html', version_pin: PIN,
  }],
}) + '\n');
console.log(`total ${parts.length} parts, ${totalTris} tris, ${(totalBytes / 1e6).toFixed(2)} MB, worst ${worst.toFixed(3)} mm`);
