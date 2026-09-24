// The HRA organs digest (H3, docs/PHASES.md): the organs BodyParts3D lacks,
// from the HuBMAP Human Reference Atlas 3D reference organs, placed in
// BodyParts3D's body.
//
//   npx tsc -b && node scripts/build-body-hra.mjs   → digests/hra-organs/
//
// Source: HRA 3D reference organs of the Visible Human male (GLB, CC BY
// 4.0), each at a pinned version, and the HRA crosswalk that names their
// meshes (ccf-releases, pinned commit). Downloads cache in .cache/hra
// (gitignored). BodyParts3D comes from the committed H1 digest.
//
// The two bodies are different people: their organs' spacing differs by up
// to 40%, so one transform cannot place an organ. Organs both have are
// anchors; each gets its own similarity by ICP (render-cpu organ-fit),
// started from one fitted on all of them, and an added organ moves by the
// anchors' fits blended by nearness. Every anchor is also placed from the
// others alone (leave one out): that is how far an added organ can be off.
// Added meshes are welded, decimated to 0.5 mm of their placed source both
// ways (as H1) and packed on the H1 body's grid. Deterministic.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyFit, BODY_SYSTEMS, blendField, decimate, fitScale, icpSimilarity, packBody, parseGlb, PointTree,
  surfaceDistance, surfaceSamples, unpackBody, vertexNormals,
} from '../packages/render-cpu/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'hra');
const OUT = join(ROOT, 'digests', 'hra-organs');
const BODY = join(ROOT, 'digests', 'bodyparts3d-body');
const REF = 'https://cdn.humanatlas.io/digital-objects/ref-organ';
const CROSSWALK_SHA = 'b036a91aaf7234f462b1249d4a5f4fb0e982f412';
const CROSSWALK = `https://raw.githubusercontent.com/hubmapconsortium/ccf-releases/${CROSSWALK_SHA}/v2.0/models/asct-b-3d-models-crosswalk.csv`;
const PIN = 'HRA-ref-organ-VHM-2026-06';
const BOUND_MM = 0.5;
const TRIES = [0.95, 0.75, 0.55, 0.4, 0.3, 0.15, 0.075];
/** Sample spacing (mm): ICP source and target, and the distances reported. */
const ICP_SRC = 2, ICP_DST = 1.5, MEASURE = 1;

// ---- what is used -----------------------------------------------------------
const is = (...names) => (n) => names.includes(n);
/** Organs both bodies have. `bp`: K1 concept names (all their PART-OF
 *  pieces) or, failing that, BodyParts3D part names. `both`: whole surfaces
 *  on both sides; else the HRA model covers part of the BodyParts3D one. */
const ANCHORS = [
  { id: 'left kidney', organ: 'kidney-male-left', version: 'v1.3', nodes: is('VH_M_kidney_capsule_L'), bp: ['left kidney'], both: true },
  { id: 'right kidney', organ: 'kidney-male-right', version: 'v1.3', nodes: is('VH_M_kidney_capsule_R'), bp: ['right kidney'], both: true },
  { id: 'spleen', organ: 'spleen-male', version: 'v1.3', nodes: () => true, bp: ['spleen'], both: true },
  {
    id: 'liver', organ: 'liver-male', version: 'v1.2', nodes: is('VH_M_liver_capsule'), both: false,
    // the segments tile the liver: their shared inner walls are not its surface, so one way only
    bp: ['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix'].map((s) => `hepatovenous segment ${s}`).concat('caudate lobe of liver'),
  },
  { id: 'pancreas', organ: 'pancreas-male', version: 'v1.3', nodes: () => true, bp: ['pancreas'], both: true },
  { id: 'urinary bladder', organ: 'urinary-bladder-male', version: 'v1.2', nodes: (n) => !n.includes('orifice'), bp: ['urinary bladder'], both: true },
  { id: 'thymus', organ: 'thymus-male', version: 'v1.3', nodes: () => true, bp: ['left lobe of thymus', 'right lobe of thymus'], both: true },
  { id: 'pelvis', organ: 'pelvis-male', version: 'v1.3', nodes: (n) => n.includes('compact') || n === 'VH_M_sacrum', bp: ['left hip bone', 'right hip bone', 'sacrum'], both: true },
  {
    id: 'heart', organ: 'heart-male', version: 'v1.3', both: true, bp: ['heart', 'wall of ventricle'],
    nodes: is('VH_M_left_cardiac_atrium', 'VH_M_right_cardiac_atrium', 'VH_M_heart_left_ventricle', 'VH_M_heart_right_ventricle', 'VH_M_interventricular_septum'),
  },
  { id: 'trachea', organ: 'trachea-male', version: 'v1.1', nodes: is('VH_M_trachea'), bp: ['trachea'], both: true },
  { id: 'main bronchi', organ: 'main-bronchus-male', version: 'v1.1', nodes: is('VH_M_left_main_bronchus', 'VH_M_right_main_bronchus'), bp: ['left main bronchus', 'right main bronchus proper'], both: true },
  { id: 'larynx', organ: 'larynx-male', version: 'v1.1', nodes: is('VH_M_thyroid_cartilage', 'VH_M_cricoid_cartilage'), bp: ['thyroid cartilage', 'cricoid cartilage'], both: true },
  { id: 'left submandibular gland', organ: 'mouth-male', version: 'v1.0', nodes: is('VH_M_submandibular_gland_L'), bp: ['left submandibular gland'], both: true },
  { id: 'right submandibular gland', organ: 'mouth-male', version: 'v1.0', nodes: is('VH_M_submandibular_gland_R'), bp: ['right submandibular gland'], both: true },
  // the disks both name alike (HRA's twelfth thoracic has no BodyParts3D twin)
  { id: 'intervertebral disks', organ: 'intervertebral-disk-male', version: 'v1.0', nodes: (n) => !n.includes('nucleus'), bp: 'same-names', both: true },
  { id: 'left knee', organ: 'knee-male-left', version: 'v1.2', nodes: is('VH_M_femur_L', 'VH_M_tibia_L', 'VH_M_fibula_L', 'VH_M_patella_L'), bp: ['left femur', 'left tibia', 'left fibula', 'left patella'], both: false },
  { id: 'right knee', organ: 'knee-male-right', version: 'v1.2', nodes: is('VH_M_femur_R', 'VH_M_tibia_R', 'VH_M_fibula_R', 'VH_M_patella_R'), bp: ['right femur', 'right tibia', 'right fibula', 'right patella'], both: false },
];
/** Organs BodyParts3D lacks, and the body system each joins. */
const ADDED = [
  { organ: 'lymph-node-male', version: 'v1.4', system: 'lymphatic', nodes: (n) => n !== 'Yao_blood_vasculature' },
  { organ: 'lymph-node-male-left', version: 'v1.0', system: 'lymphatic', nodes: (n) => n !== 'Yao_vasculature_a' },
  { organ: 'lymph-node-male-right', version: 'v1.0', system: 'lymphatic', nodes: (n) => n !== 'Yao_vasculature_a' },
  { organ: 'palatine-tonsil-male-left', version: 'v1.2', system: 'lymphatic', nodes: () => true },
  { organ: 'palatine-tonsil-male-right', version: 'v1.2', system: 'lymphatic', nodes: () => true },
  // the lung's surface, as its bronchopulmonary segments tile it (BodyParts3D has the airways)
  { organ: 'lung-male', version: 'v1.4', system: 'respiratory', nodes: (n) => n.includes('bronchopulmonary_segment') },
  { organ: 'spinal-cord-male', version: 'v1.1', system: 'nervous', nodes: () => true },
  { organ: 'omentum-male', version: 'v1.0', system: 'digestive', nodes: () => true },
  { organ: 'epiploic-appendage-of-transverse-colon-male', version: 'v1.0', system: 'digestive', nodes: () => true },
];

// ---- inputs -----------------------------------------------------------------
mkdirSync(CACHE, { recursive: true });
const fetchTo = (url, file) => {
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, url], { stdio: 'inherit' });
  return file;
};

/** An organ at its version: meshes by node name (HRA's frame, metres, y up)
 *  and its citation, from the dataset page's schema.org record. */
const organs = new Map();
function organ(name, version) {
  const key = `${name}@${version}`;
  if (organs.has(key)) return organs.get(key);
  const base = `${REF}/${name}/${version}`;
  const graph = readFileSync(fetchTo(`${base}/graph.json`, join(CACHE, `${name}-${version}.graph.json`)), 'utf8');
  const glbUrl = graph.match(/"file_url": "([^"]+\.glb)"/)?.[1];
  if (!glbUrl?.startsWith(`${base}/assets/`)) throw new Error(`build-body-hra: ${key} has no GLB of its own version`);
  const page = readFileSync(fetchTo(`${base}/`, join(CACHE, `${name}-${version}.html`)), 'utf8');
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  const based = ld?.isBasedOn;
  if (based?.license !== 'https://creativecommons.org/licenses/by/4.0/') throw new Error(`build-body-hra: ${key} is not CC BY 4.0 (${based?.license})`);
  const citation = String(based.citation).replace(/\s*Accessed on [^.]*\.\s*$/, '');
  const doi = based.identifier.find((s) => s.startsWith('https://doi.org/'));
  if (!doi || !citation.includes(doi)) throw new Error(`build-body-hra: ${key} citation lacks its DOI`);
  const meshes = parseGlb(readFileSync(fetchTo(glbUrl, join(CACHE, `${name}-${version}.glb`))));
  const o = { name, version, title: based.name, doi, citation, url: glbUrl, meshes };
  organs.set(key, o);
  return o;
}

/** HRA (metres; y up, z to the front) → BodyParts3D (mm; z up, y to the back),
 *  welded: vertices at one position become one (the GLBs split them where
 *  their normals do). */
function toBody(mesh) {
  const at = new Map(), P = [], I = new Uint32Array(mesh.indices.length);
  const remap = new Uint32Array(mesh.positions.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const x = mesh.positions[v * 3] * 1000, y = -mesh.positions[v * 3 + 2] * 1000, z = mesh.positions[v * 3 + 1] * 1000;
    const k = `${x},${y},${z}`;
    let i = at.get(k);
    if (i === undefined) { i = P.length / 3; at.set(k, i); P.push(x, y, z); }
    remap[v] = i;
  }
  let n = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = remap[mesh.indices[t]], b = remap[mesh.indices[t + 1]], c = remap[mesh.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    I[n++] = a; I[n++] = b; I[n++] = c;
  }
  return { positions: Float64Array.from(P), indices: I.slice(0, n) };
}

const join3 = (meshes) => {
  const P = [], I = [];
  for (const m of meshes) { const b = P.length / 3; P.push(...m.positions); for (const x of m.indices) I.push(b + x); }
  return { positions: Float64Array.from(P), indices: Uint32Array.from(I) };
};

function pick(o, keep) {
  const got = o.meshes.filter((m) => keep(m.name));
  if (!got.length) throw new Error(`build-body-hra: no meshes kept from ${o.name}`);
  return got;
}

// crosswalk: node name → [label, ontology id]
const names = new Map();
for (const line of readFileSync(fetchTo(CROSSWALK, join(CACHE, `crosswalk-${CROSSWALK_SHA}.csv`)), 'utf8').split('\n')) {
  const cells = [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]).slice(0, 7);
  if (cells[2]?.startsWith('VH_M_') || cells[2]?.startsWith('Yao_')) names.set(cells[2], [cells[3], cells[4]]);
}
const tidy = (s) => s.replace(/^(VH_M_|Yao_)/, '').replace(/_[a-z]$/, '').replace(/_+/g, ' ').trim();
function label(node) {
  const hit = names.get(node) ?? names.get(node.replace(/_[a-z]$/, ''));
  const id = hit?.[1]?.replace(/^FMA:/, 'FMA') ?? '';
  return { name: (hit?.[0] || tidy(node)).toLowerCase(), fma: /^(FMA\d+|UBERON:\d+)$/.test(id) ? id : `HRA:${tidy(node).replace(/ /g, '_')}` };
}

// BodyParts3D: the committed H1 digest and the K1 concepts
const bodyIndex = JSON.parse(readFileSync(join(BODY, 'index.json'), 'utf8'));
const bpParts = new Map();
for (const s of Object.keys(bodyIndex.systems)) for (const p of unpackBody(readFileSync(join(BODY, `${s}.cbdy`))).parts) bpParts.set(p.element, p);
const terms = JSON.parse(readFileSync(join(ROOT, 'digests', 'bodyparts3d-terms', 'terms.json'), 'utf8'));
const conceptMembers = new Map(Object.values(terms).map(([n, , m]) => [n, m]));
function bodyparts(list) {
  const els = new Set();
  for (const n of list) {
    const own = conceptMembers.get(n) ?? [...bpParts.values()].filter((p) => p.name === n).map((p) => p.element);
    if (!own.length) throw new Error(`build-body-hra: BodyParts3D has no "${n}"`);
    for (const e of own) if (bpParts.has(e)) els.add(e);
  }
  return join3([...els].sort().map((e) => bpParts.get(e)));
}

// ---- anchors and the fit ----------------------------------------------------
const anchors = ANCHORS.map((a) => {
  const o = organ(a.organ, a.version);
  let hra = pick(o, a.nodes);
  let bp = a.bp;
  if (bp === 'same-names') {
    hra = hra.filter((m) => [...bpParts.values()].some((p) => p.name === tidy(m.name)));
    bp = hra.map((m) => tidy(m.name));
  }
  const src = join3(hra.map(toBody)), dst = bodyparts(bp);
  return {
    ...a, bpNames: bp, hraNodes: hra.map((m) => m.name), src, dst,
    pair: { src: surfaceSamples(src, ICP_SRC), dst: surfaceSamples(dst, ICP_DST), both: a.both },
    measure: { src: surfaceSamples(src, MEASURE), dst: surfaceSamples(dst, MEASURE) },
  };
});
console.log(`${anchors.length} anchors`);

/** Mean distance, mm, between an anchor's placed HRA samples and its
 *  BodyParts3D ones: both ways averaged, or HRA → BodyParts3D alone. */
function gap(a, placed) {
  const toBp = new PointTree(a.measure.dst);
  let s = 0;
  for (let i = 0; i < placed.length; i += 3) s += Math.sqrt(toBp.nearest(placed[i], placed[i + 1], placed[i + 2]).d2);
  const there = s / (placed.length / 3);
  if (!a.both) return there;
  const toHra = new PointTree(placed);
  let b = 0;
  for (let i = 0; i < a.measure.dst.length; i += 3) b += Math.sqrt(toHra.nearest(a.measure.dst[i], a.measure.dst[i + 1], a.measure.dst[i + 2]).d2);
  return (there + b / (a.measure.dst.length / 3)) / 2;
}

const centroid = (arrs) => {
  const c = [0, 0, 0];
  let n = 0;
  for (const p of arrs) for (let i = 0; i < p.length; i += 3) { c[0] += p[i]; c[1] += p[i + 1]; c[2] += p[i + 2]; n++; }
  return c.map((v) => v / n);
};
const cs = centroid(anchors.map((a) => a.pair.src)), cd = centroid(anchors.map((a) => a.pair.dst));
const start = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [cd[0] - cs[0], cd[1] - cs[1], cd[2] - cs[2]] };
const global = icpSimilarity(anchors.map((a) => a.pair), start, 40);
console.log(`global similarity: scale ${fitScale(global).toFixed(4)}`);
for (const a of anchors) {
  a.fit = icpSimilarity([a.pair], global, 40);
  a.near = new PointTree(a.pair.src);
  a.globalMm = gap(a, applyFit(global, a.measure.src));
  a.ownMm = gap(a, applyFit(a.fit, a.measure.src));
}
for (const a of anchors) {
  a.looMm = gap(a, blendField(anchors.filter((b) => b !== a).map((b) => ({ fit: b.fit, near: b.near })), a.measure.src));
  console.log(`  ${a.id.padEnd(26)} global ${a.globalMm.toFixed(2).padStart(6)}  own ${a.ownMm.toFixed(2).padStart(5)}  from the others ${a.looMm.toFixed(2).padStart(6)} mm${a.both ? '' : '  (HRA → BodyParts3D)'}`);
}
const field = anchors.map((a) => ({ fit: a.fit, near: a.near }));

// ---- the added organs, placed, decimated, packed ----------------------------
const bounds = { min: bodyIndex.min, max: bodyIndex.max };
const twoWay = (a, b) => Math.max(surfaceDistance(a, b, [1, 1, 1], 4 * BOUND_MM).max, surfaceDistance(b, a, [1, 1, 1], 4 * BOUND_MM).max);
const shipped = (p) => unpackBody(packBody([p], bounds)).parts[0];
const parts = [], cited = [];
for (const add of ADDED) {
  const o = organ(add.organ, add.version);
  cited.push(o);
  for (const m of pick(o, add.nodes)) {
    const w = toBody(m);
    const placed = { positions: Float32Array.from(blendField(field, w.positions)), indices: w.indices };
    const src = { ...placed, normals: Float32Array.from(vertexNormals(placed.positions, placed.indices)) };
    const meta = { ...label(m.name), element: `${o.name}/${m.name}`, system: add.system, sourceTris: placed.indices.length / 3 };
    let chosen = null;
    for (const e of TRIES) {
      const d = decimate(src, { targetTris: 1, maxError: e });
      const cand = { ...meta, errorMm: 0, positions: d.positions, indices: d.indices };
      const err = twoWay(shipped(cand), src);
      if (err <= BOUND_MM) { chosen = { ...cand, errorMm: err }; break; }
    }
    chosen ??= { ...meta, positions: placed.positions, indices: placed.indices, errorMm: twoWay(shipped({ ...meta, errorMm: 0, ...placed }), src) };
    if (chosen.errorMm > BOUND_MM) throw new Error(`build-body-hra: ${meta.element} off by ${chosen.errorMm} mm even undecimated`);
    parts.push(chosen);
  }
  console.log(`  placed ${o.name} ${o.version}`);
}
parts.sort((a, b) => (a.element < b.element ? -1 : 1));

// ---- output -----------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const index = {
  format: 'carys-body-index/1', pin: PIN,
  attribution: 'Human Reference Atlas 3D reference organs (Visible Human male), HuBMAP, humanatlas.io, licensed under CC Attribution 4.0 International',
  min: bounds.min, max: bounds.max, elements: parts.length, systems: {},
};
let totalTris = 0, totalBytes = 0, worst = 0;
for (const system of BODY_SYSTEMS) {
  const mine = parts.filter((p) => p.system === system);
  if (!mine.length) continue;
  const bytes = packBody(mine, bounds);
  writeFileSync(join(OUT, `${system}.cbdy`), bytes);
  const tris = mine.reduce((s, p) => s + p.indices.length / 3, 0), source = mine.reduce((s, p) => s + p.sourceTris, 0);
  const err = Math.max(...mine.map((p) => p.errorMm));
  index.systems[system] = { file: `${system}.cbdy`, parts: mine.length, tris, sourceTris: source, bytes: bytes.length, worstErrorMm: +err.toFixed(3) };
  totalTris += tris; totalBytes += bytes.length; worst = Math.max(worst, err);
  console.log(`${system.padEnd(14)} ${String(mine.length).padStart(4)} parts ${String(source).padStart(8)} → ${String(tris).padStart(7)} tris  ${(bytes.length / 1e6).toFixed(2)} MB  worst ${err.toFixed(3)} mm`);
}
index.tris = totalTris; index.bytes = totalBytes; index.worstErrorMm = +worst.toFixed(3);
const rowsText = parts.map((p) => `  ${JSON.stringify([p.element, p.fma, p.name, p.system])}`).join(',\n');
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1).replace(/\n}$/, `,\n "parts": [\n${rowsText}\n ]\n}\n`));
const r2 = (v) => Math.round(v * 100) / 100;
writeFileSync(join(OUT, 'fit.json'), JSON.stringify({
  format: 'carys-body-fit/1',
  frame: 'HRA (x, y, z) m → BodyParts3D (1000 x, −1000 z, 1000 y) mm, then the fit',
  method: 'per-anchor similarity by ICP (both ways where both surfaces are whole), started from one similarity on all anchors; added organs move by the anchors\' fits blended by 1/(d² + 5²), d the distance (mm) to each anchor',
  measure: `mean distance between surfaces sampled ${MEASURE} mm apart`,
  global: { scale: +fitScale(global).toFixed(4), m: global.m.map((v) => +v.toFixed(6)), t: global.t.map((v) => +v.toFixed(3)) },
  anchors: anchors.map((a) => ({
    id: a.id, hra: `${a.organ}@${a.version}`, nodes: a.hraNodes, bodyparts3d: a.bpNames, both: a.both,
    scale: +fitScale(a.fit).toFixed(4), globalMm: r2(a.globalMm), ownMm: r2(a.ownMm), leaveOneOutMm: r2(a.looMm),
  })),
}, null, 1) + '\n');
const used = [...new Map([...anchors.map((a) => organ(a.organ, a.version)), ...cited].map((o) => [`${o.name}@${o.version}`, o])).values()]
  .sort((a, b) => (a.name < b.name ? -1 : 1));
writeFileSync(join(OUT, 'SOURCES.json'), JSON.stringify({
  digest: 'hra-organs', format: 'carys-sources/1',
  sources: [
    ...used.map((o) => ({
      entry_count: cited.includes(o) ? parts.filter((p) => p.element.startsWith(`${o.name}/`)).length : 0,
      license_spdx: 'CC-BY-4.0', retrieved_date: '2026-09-24', source_url: o.url, version_pin: `${o.name}@${o.version}`,
      role: cited.includes(o) ? 'added' : 'anchor', citation: o.citation, doi: o.doi,
    })),
    {
      entry_count: names.size, license_spdx: 'CC-BY-4.0', retrieved_date: '2026-09-24', source_url: CROSSWALK,
      version_pin: `ccf-releases@${CROSSWALK_SHA.slice(0, 12)}`, role: 'mesh names',
    },
  ],
}, null, 1) + '\n');
console.log(`total ${parts.length} parts, ${totalTris} tris, ${(totalBytes / 1e6).toFixed(2)} MB, worst ${worst.toFixed(3)} mm`);
