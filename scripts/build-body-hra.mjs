// The HRA organs digest: the organs BodyParts3D lacks,
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
// started from one fitted on all of them, then a smooth bend the rest of
// the way (render-cpu organ-warp: bowel loops, bronchi branching at other
// angles and knees flexed otherwise are more than a similarity can take).
// An added organ moves by the anchors' fits and bends blended by nearness.
// Every anchor is also placed from the others alone (leave one out): that
// is how far an added organ can be off.
// The spinal cord is then centred in BodyParts3D's spinal canal (VERTEBRAE).
// Added meshes are welded, decimated to 0.5 mm of their placed source both
// ways (as H1) and packed on the H1 body's grid. Deterministic.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyFit, BODY_SYSTEMS, blendField, decimate, fitScale, GRAD_MAX, holeCentre, icpSimilarity, icpWarp, packBody, parseGlb,
  PointTree, surfaceDistance, surfaceSamples, unpackBody, vertexNormals, WARP_DEFAULTS, windOutward,
} from '../packages/render-cpu/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'hra');
const OUT = join(ROOT, 'digests', 'hra-organs');
const BODY = join(ROOT, 'digests', 'bodyparts3d-body');
const REF = 'https://cdn.humanatlas.io/digital-objects/ref-organ';
const CROSSWALK_SHA = 'b036a91aaf7234f462b1249d4a5f4fb0e982f412';
const CROSSWALK = `https://raw.githubusercontent.com/hubmapconsortium/ccf-releases/${CROSSWALK_SHA}/v2.0/models/asct-b-3d-models-crosswalk.csv`;
/** The digest's pin: the source versions (June 2026), placed with bends. */
const PIN = 'HRA-ref-organ-VHM-2026-06-bent';
const BOUND_MM = 0.5;
const TRIES = [0.95, 0.75, 0.55, 0.4, 0.3, 0.15, 0.075];
/** Sample spacing (mm): ICP source and target, and the distances reported. */
const ICP_SRC = 2, ICP_DST = 1.5, MEASURE = 1;
/** Most samples an anchor gives ICP, per side (every k-th, evenly). The
 *  distances reported use all of them. */
const ICP_MAX_SRC = 20000, ICP_MAX_DST = 40000;
/** Most samples a reported distance averages, per side (every k-th). */
const MEASURE_MAX = 60000;
/** Most samples an anchor's bend is fitted to, per side, and every how
 *  many measure samples its Jacobian is checked. */
const WARP_MAX_SRC = 6000, WARP_MAX_DST = 10000, DET_STRIDE = 10;

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
  { id: 'duodenum', organ: 'small-intestine-male', version: 'v1.2', nodes: is('VH_M_duodenum_superior', 'VH_M_duodenum_descending', 'VH_M_duodenum_horizonal', 'VH_M_duodenum_ascending'), bp: ['duodenum'], both: true },
  {
    id: 'jejunum and ileum', organ: 'small-intestine-male', version: 'v1.2', nodes: is('VH_M_jejunum', 'VH_M_ileum', 'VH_M_ileum_terminal'), both: true,
    bp: ['proximal', 'middle', 'distal'].flatMap((w) => [`${w} part of jejunum`, `${w} part of ileum`]),
  },
  {
    id: 'colon', organ: 'large-intestine-male', version: 'v1.3', both: true, bp: ['ascending colon', 'transverse colon', 'descending colon'],
    nodes: is('VH_M_ascending_colon', 'VH_M_hepatic_flexure_of_colon', 'VH_M_transverse_colon', 'VH_M_splenic_flexure_of_colon', 'VH_M_descending_colon'),
  },
  { id: 'left knee', organ: 'knee-male-left', version: 'v1.2', nodes: is('VH_M_femur_L', 'VH_M_tibia_L', 'VH_M_fibula_L', 'VH_M_patella_L'), bp: ['left femur', 'left tibia', 'left fibula', 'left patella'], both: false },
  { id: 'right knee', organ: 'knee-male-right', version: 'v1.2', nodes: is('VH_M_femur_R', 'VH_M_tibia_R', 'VH_M_fibula_R', 'VH_M_patella_R'), bp: ['right femur', 'right tibia', 'right fibula', 'right patella'], both: false },
];
/** And each intervertebral disk both bodies name alike, an anchor of its
 *  own, so the spinal cord follows the vertebrae beside it (HRA's twelfth
 *  thoracic disk has no BodyParts3D twin). */
const DISKS = { organ: 'intervertebral-disk-male', version: 'v1.0' };
/** Organs BodyParts3D lacks, and the body system each joins. */
const ADDED = [
  // a node's own blood vessels are most of its triangles and none of the lymphatic layer
  { organ: 'lymph-node-male', version: 'v1.4', system: 'lymphatic', nodes: (n) => !n.includes('vasculature') },
  { organ: 'lymph-node-male-left', version: 'v1.0', system: 'lymphatic', nodes: (n) => !n.includes('vasculature') },
  { organ: 'lymph-node-male-right', version: 'v1.0', system: 'lymphatic', nodes: (n) => !n.includes('vasculature') },
  { organ: 'palatine-tonsil-male-left', version: 'v1.2', system: 'lymphatic', nodes: () => true },
  { organ: 'palatine-tonsil-male-right', version: 'v1.2', system: 'lymphatic', nodes: () => true },
  // the lung's surface, as its bronchopulmonary segments tile it (BodyParts3D has the airways)
  { organ: 'lung-male', version: 'v1.4', system: 'respiratory', nodes: (n) => n.includes('bronchopulmonary_segment') },
  // the disks carry it down the spine, then it is centred in BodyParts3D's canal (see VERTEBRAE)
  { organ: 'spinal-cord-male', version: 'v1.1', system: 'nervous', nodes: () => true, canal: true },
  // the transverse colon's fat tags, which follow the colon's bend
  { organ: 'epiploic-appendage-of-transverse-colon-male', version: 'v1.0', system: 'digestive', nodes: () => true },
  // Left out: the omentum (omentum-male), an apron in front of the bowel.
  // Placed with the bowel's similarities, 6.9% of it lay outside
  // BodyParts3D's skin (up to 22 mm); with their bends still 1.7% (up to
  // 15 mm): the two bodies' belly walls differ, and no anchor holds it.
];
/** BodyParts3D's vertebrae, top down. The disks place the cord at the right
 *  heights, but the two spines curve differently: placed, 20% of the cord's
 *  vertices lay inside bone, all from C1 to T2. Each vertebra's canal
 *  centre (render-cpu holeCentre, across its midline at heights through its
 *  middle half) makes a line down the spine, and every cord vertex moves
 *  across by that line less the cord's own centre line at its height;
 *  heights stay. */
const VERTEBRAE = [
  'atlas', 'axis', ...['third', 'fourth', 'fifth', 'sixth', 'seventh'].map((n) => `${n} cervical vertebra`),
  ...['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'].map((n) => `${n} thoracic vertebra`),
  ...['first', 'second', 'third', 'fourth', 'fifth'].map((n) => `${n} lumbar vertebra`),
];
const CANAL_STEP = 0.5, CANAL_HEIGHT_STEP = 1;

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
 *  welded (vertices at one position become one: the GLBs split them where
 *  their normals do) and wound outward (they do not all: see windOutward). */
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
  const positions = Float64Array.from(P);
  return { positions, indices: windOutward(positions, I.subarray(0, n)) };
}

/** Every k-th point of a sample set, at most `max` of them. */
function thin(samples, max) {
  const n = samples.length / 3, k = Math.ceil(n / max);
  if (k <= 1) return samples;
  const out = new Float64Array(Math.ceil(n / k) * 3);
  for (let i = 0, j = 0; i < n; i += k, j++) out.set(samples.subarray(i * 3, i * 3 + 3), j * 3);
  return out;
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
const bpNames = new Set([...bpParts.values()].map((p) => p.name));
const disks = organ(DISKS.organ, DISKS.version).meshes
  .filter((m) => !m.name.includes('nucleus') && bpNames.has(tidy(m.name)))
  .map((m) => ({ ...DISKS, id: tidy(m.name), nodes: is(m.name), bp: [tidy(m.name)], both: true }));
const anchors = [...ANCHORS, ...disks].map((a) => {
  const o = organ(a.organ, a.version);
  const hra = pick(o, a.nodes), bp = a.bp;
  const src = join3(hra.map(toBody)), dst = bodyparts(bp);
  return {
    ...a, bpNames: bp, hraNodes: hra.map((m) => m.name), src, dst,
    pair: { src: thin(surfaceSamples(src, ICP_SRC), ICP_MAX_SRC), dst: thin(surfaceSamples(dst, ICP_DST), ICP_MAX_DST), both: a.both },
    measure: { src: thin(surfaceSamples(src, MEASURE), MEASURE_MAX), dst: thin(surfaceSamples(dst, MEASURE), MEASURE_MAX) },
  };
});
console.log(`${anchors.length} anchors: ${anchors.reduce((n, a) => n + a.pair.src.length / 3, 0)} HRA and ${anchors.reduce((n, a) => n + a.pair.dst.length / 3, 0)} BodyParts3D samples`);

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
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
for (const a of anchors) {
  console.log(`  fitting ${a.id}`);
  a.fit = icpSimilarity([a.pair], global, 40);
  a.near = new PointTree(a.pair.src);
  a.globalMm = gap(a, applyFit(global, a.measure.src));
  a.ownMm = gap(a, applyFit(a.fit, a.measure.src));
  // the bend, fitted where the similarity put it
  a.bend = icpWarp(thin(applyFit(a.fit, a.pair.src), WARP_MAX_SRC), thin(a.pair.dst, WARP_MAX_DST), a.both);
  const placed = applyFit(a.fit, a.measure.src), bent = a.bend.apply(placed);
  a.bentMm = gap(a, bent);
  const dets = [];
  a.movedMaxMm = 0;
  for (let i = 0; i < placed.length; i += 3) {
    a.movedMaxMm = Math.max(a.movedMaxMm, Math.hypot(bent[i] - placed[i], bent[i + 1] - placed[i + 1], bent[i + 2] - placed[i + 2]));
    if ((i / 3) % DET_STRIDE === 0) dets.push(a.bend.jacobianDet(placed[i], placed[i + 1], placed[i + 2]));
  }
  dets.sort((u, v) => u - v);
  a.det = { min: dets[0], p1: quantile(dets, 0.01), p5: quantile(dets, 0.05), p99: quantile(dets, 0.99) };
}
for (const a of anchors) {
  const others = anchors.filter((b) => b !== a);
  a.looRigidMm = gap(a, blendField(others.map((b) => ({ fit: b.fit, near: b.near })), a.measure.src));
  a.looMm = gap(a, blendField(others.map((b) => ({ fit: b.fit, near: b.near, bend: b.bend })), a.measure.src));
  console.log(`  ${a.id.padEnd(26)} global ${a.globalMm.toFixed(2).padStart(6)}  own ${a.ownMm.toFixed(2).padStart(5)}  bent ${a.bentMm.toFixed(2).padStart(5)} (det ≥ ${a.det.min.toFixed(2)}, p5 ${a.det.p5.toFixed(2)})  from the others ${a.looRigidMm.toFixed(2).padStart(6)} → ${a.looMm.toFixed(2).padStart(6)} mm${a.both ? '' : '  (HRA → BodyParts3D)'}`);
}
const field = anchors.map((a) => ({ fit: a.fit, near: a.near, bend: a.bend }));

// ---- the spinal canal -------------------------------------------------------
const boxOf = (P) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  return { lo, hi, mid: lo.map((v, k) => (v + hi[k]) / 2) };
};
const canal = VERTEBRAE.map((name) => {
  const v = [...bpParts.values()].find((p) => p.name === name);
  if (!v) throw new Error(`build-body-hra: BodyParts3D has no "${name}"`);
  const { lo, hi, mid } = boxOf(v.positions), q = (hi[2] - lo[2]) / 4, lines = [];
  for (let z = lo[2] + q; z <= hi[2] - q; z += CANAL_HEIGHT_STEP) lines.push([[mid[0], lo[1], z], [mid[0], hi[1], z]]);
  const hole = holeCentre(v, lines, CANAL_STEP);
  if (!hole) throw new Error(`build-body-hra: no canal found in the ${name}`);
  return { name, at: hole.at, clearanceMm: hole.clearance };
});
/** A line through points, linear in height between them, held past its ends. */
function byHeight(points) {
  const s = [...points].sort((a, b) => a[2] - b[2]);
  return (z) => {
    const j = s.findIndex((p) => p[2] >= z);
    if (j === 0) return s[0];
    if (j < 0) return s[s.length - 1];
    const a = s[j - 1], b = s[j], f = (z - a[2]) / (b[2] - a[2]);
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
  };
}
const canalAt = byHeight(canal.map((c) => c.at));
/** Moves placed meshes (in place) across onto the canal line, each vertex by
 *  the canal less the meshes' own centre line (their box centres) at its
 *  height. The most any moved, mm. */
function intoCanal(meshes) {
  const ownAt = byHeight(meshes.map((m) => boxOf(m.positions).mid));
  let most = 0;
  for (const m of meshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 3) {
      const c = canalAt(P[i + 2]), k = ownAt(P[i + 2]), dx = c[0] - k[0], dy = c[1] - k[1];
      P[i] += dx; P[i + 1] += dy;
      most = Math.max(most, Math.hypot(dx, dy));
    }
  }
  return most;
}

// ---- the added organs, placed, decimated, packed ----------------------------
const bounds = { min: bodyIndex.min, max: bodyIndex.max };
const twoWay = (a, b) => Math.max(surfaceDistance(a, b, [1, 1, 1], 4 * BOUND_MM).max, surfaceDistance(b, a, [1, 1, 1], 4 * BOUND_MM).max);
const shipped = (p) => unpackBody(packBody([p], bounds)).parts[0];
const parts = [], cited = [];
let canalShiftMm = null;
for (const add of ADDED) {
  const o = organ(add.organ, add.version);
  cited.push(o);
  const got = pick(o, add.nodes).map((m) => { const w = toBody(m); return { node: m.name, positions: blendField(field, w.positions), indices: w.indices }; });
  if (add.canal) {
    canalShiftMm = intoCanal(got);
    console.log(`  ${o.name} moved into the canal, up to ${canalShiftMm.toFixed(1)} mm`);
  }
  for (const g of got) {
    const placed = { positions: Float32Array.from(g.positions), indices: g.indices };
    const src = { ...placed, normals: Float32Array.from(vertexNormals(placed.positions, placed.indices)) };
    const meta = { ...label(g.node), element: `${o.name}/${g.node}`, system: add.system, sourceTris: placed.indices.length / 3 };
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
if (canalShiftMm === null) throw new Error('build-body-hra: the canal was found for no organ');
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
  method: 'per-anchor similarity by ICP (both ways where both surfaces are whole), started from one similarity on all anchors, then a bend by non-rigid ICP (render-cpu organ-warp); added organs move by the anchors\' fits and bends blended by 1/(d² + 5²)², d the distance (mm) to each anchor',
  bend: {
    method: `composed steps, one per ICP round, each a sum of Wendland ψ₃,₁ functions on nodes spread over the organ (spacing ${+WARP_DEFAULTS.spacing.toFixed(3)} of the radius), weights by least squares + λ·wᵀGw, the step's gradient capped at ${GRAD_MAX} (Frobenius) at every sample so it cannot fold`,
    radiiMm: WARP_DEFAULTS.radii, stepsPerRadius: WARP_DEFAULTS.iterations, keep: WARP_DEFAULTS.keep, lambda: WARP_DEFAULTS.lambda,
    samples: { src: WARP_MAX_SRC, dst: WARP_MAX_DST }, jacobianEvery: DET_STRIDE,
  },
  measure: `mean distance between surfaces sampled ${MEASURE} mm apart (at most ${MEASURE_MAX} samples a side, evenly strided)`,
  global: { scale: +fitScale(global).toFixed(4), m: global.m.map((v) => +v.toFixed(6)), t: global.t.map((v) => +v.toFixed(3)) },
  anchors: anchors.map((a) => ({
    id: a.id, hra: `${a.organ}@${a.version}`, nodes: a.hraNodes, bodyparts3d: a.bpNames, both: a.both,
    scale: +fitScale(a.fit).toFixed(4), globalMm: r2(a.globalMm), ownMm: r2(a.ownMm), bentMm: r2(a.bentMm),
    jacobian: { min: r2(a.det.min), p1: r2(a.det.p1), p5: r2(a.det.p5), p99: r2(a.det.p99) }, bendMaxMm: r2(a.movedMaxMm),
    leaveOneOutRigidMm: r2(a.looRigidMm), leaveOneOutMm: r2(a.looMm),
  })),
  canal: {
    method: `the spinal cord moved across (heights kept) onto the line through each BodyParts3D vertebra's canal centre: the point on its midline, front to back every ${CANAL_STEP} mm at heights ${CANAL_HEIGHT_STEP} mm apart through its middle half, outside the bone with bone ahead and behind, farthest from it`,
    vertebrae: canal.map((c) => ({ name: c.name, at: c.at.map(r2), clearanceMm: r2(c.clearanceMm) })),
    cordShiftMaxMm: r2(canalShiftMm),
  },
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
