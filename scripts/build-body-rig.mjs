// The body rig digest: the H1 skeleton cut into rigid
// segments, joint centres fitted from the bones, and every other part's
// vertices weighted to the segments.
//
//   npx tsc -b && node scripts/build-body-rig.mjs   → digests/body-rig/
//
// Source: the committed body digests (BodyParts3D, H1; the HRA organs, H3),
// both CC BY 4.0; nothing is downloaded. Frame: BodyParts3D's (mm; x to the
// body's left, y to its back, z up). Deterministic.
//
// Bones are named ones (a rule per segment below); the skeletal system's
// cartilages, ligaments, disks and the few muscles filed there are soft.
// Joint centres: a sphere fitted to where two bones meet (hip, shoulder,
// wrist, ankle); a circle seen along the hinge for the elbow (the ulna's
// trochlear notch); the midpoint of a sphere on each posterior femoral
// condyle for the knee (where femur and tibia meet is too flat to fit);
// an intervertebral disk's centre for the spine and neck, whose angles
// spread over the disks from the sacrum to T12/L1 and from T1 to C2/C3.
// Weights: each soft vertex follows its three nearest segments by 1/d⁴, d
// its distance to their bones, counting no bone it could reach only across
// the skin (see SKIN_SKIP_MM), the skin's weights then smoothed over it; a muscle vertex within ATTACH_MM of a bone is that
// bone's attachment and follows it alone.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fitCircle, fitSphere, NO_SEG, packWeights, PointTree, surfaceSamples, TriangleGrid, unpackBody, vertexNormals,
} from '../packages/render-cpu/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'digests', 'body-rig');
const DIGESTS = ['bodyparts3d-body', 'hra-organs'];
/** Where two bones meet: vertices of one within this of the other (mm). */
const CONTACT_MM = 6;
/** Bone surface samples for contacts and weights (mm apart). */
const SAMPLE_MM = 1;
/** A muscle vertex this near a bone (mm) is attached to it. */
const ATTACH_MM = 1;
/** Segments farther than this many times the nearest weigh under 1/81 of
 *  it: not asked. */
const FAR = 3;
/** Knee: the femur's last this many mm, behind its middle, split at the notch. */
const CONDYLE_MM = 30, NOTCH_MM = 4;
/** A vertex follows no bone it could reach only by crossing the skin's
 *  outer sheet: the inner arm, nearer the ribs across the armpit than its
 *  own humerus, and the thigh beside the hanging hand. Crossings within
 *  SKIN_SKIP_MM of the vertex (the skin's own sheets) do not count. */
const SKIN_SKIP_MM = 1.5, SKIN_CELL_MM = 16;
const SKIN = 'skin';
/** Times the skin's weights are averaged with their neighbours'. */
const SMOOTH_STEPS = 8;

// ---- segments and their bones ----------------------------------------------
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const SIDE_SEGMENTS = ['upper arm', 'forearm', 'hand', 'thigh', 'shank', 'foot'];
const SEGMENTS = [
  'pelvis', 'L5', 'L4', 'L3', 'L2', 'L1', 'trunk', 'C7', 'C6', 'C5', 'C4', 'C3', 'head',
  ...['left', 'right'].flatMap((s) => SIDE_SEGMENTS.map((g) => `${s} ${g}`)),
];
const segIndex = (name) => {
  const i = SEGMENTS.indexOf(name);
  if (i < 0) throw new Error(`build-body-rig: no segment "${name}"`);
  return i;
};
const SOFT = /cartilage|ligament|disk|membrane|tendon|choroid|vitreous|trochlea of/;
const BONE_WORD = /\b(bone|vertebra|atlas|axis|rib|sternum|manubrium|xiphoid|clavicle|scapula|humerus|radius|ulna|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate|phalanx|sacrum|femur|patella|tibia|fibula|talus|calcaneus|ethmoid|maxilla|mandible|vomer|concha|tooth)\b/;
/** A skeletal part's segment when it is a bone, else null (soft). */
function segmentOf(name) {
  if (SOFT.test(name)) return null;
  const side = name.match(/\b(left|right)\b/)?.[1];
  let m;
  if (/^(atlas|axis|frontal bone|occipital bone|sphenoid bone|ethmoid|mandible|vomer|hyoid bone)$/.test(name)
    || /^(left|right) (parietal bone|temporal bone|maxilla|zygomatic bone|nasal bone|lacrimal bone|palatine bone|inferior nasal concha|hyoid bone)$/.test(name)
    || /tooth$/.test(name)) return 'head';
  if ((m = name.match(/^(third|fourth|fifth|sixth|seventh) cervical vertebra$/))) return `C${ORD.indexOf(m[1]) + 1}`;
  if ((m = name.match(/^(first|second|third|fourth|fifth) lumbar vertebra$/))) return `L${ORD.indexOf(m[1]) + 1}`;
  if (/thoracic vertebra$|^(left|right) \w+ rib$|^(body of sternum|manubrium|xiphoid process)$|^(left|right) (clavicle|scapula)$/.test(name)) return 'trunk';
  if (/^(left|right) hip bone$|^sacrum$/.test(name)) return 'pelvis';
  if (!side) return BONE_WORD.test(name) ? undefined : null;
  if (/humerus$/.test(name)) return `${side} upper arm`;
  if (/(radius|ulna)$/.test(name)) return `${side} forearm`;
  if (/(scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate|metacarpal bone)$/.test(name)
    || /phalanx of (left|right) (thumb|index finger|middle finger|ring finger|little finger)$/.test(name)) return `${side} hand`;
  if (/(femur|patella)$/.test(name)) return `${side} thigh`;
  if (/(tibia|fibula)$/.test(name)) return `${side} shank`;
  if (/(talus|calcaneus|navicular bone of (left|right) foot|cuneiform bone|cuboid bone|metatarsal bone|sesamoid bone of (left|right) foot)$/.test(name)
    || /phalanx of (left|right) (big toe|little toe|\w+ toe)$/.test(name)) return `${side} foot`;
  // a bone no rule placed is an error; anything else (a muscle filed here, an eye part) is soft
  return BONE_WORD.test(name) ? undefined : null;
}

// ---- inputs -----------------------------------------------------------------
const files = [];
for (const d of DIGESTS) {
  const ix = JSON.parse(readFileSync(join(ROOT, 'digests', d, 'index.json'), 'utf8'));
  for (const [system, f] of Object.entries(ix.systems)) files.push({ digest: d, system, pin: ix.pin, parts: unpackBody(readFileSync(join(ROOT, 'digests', d, f.file))).parts });
}
const bones = new Map(), soft = [];
for (const f of files) {
  for (const p of f.parts) {
    const s = f.digest === 'bodyparts3d-body' && f.system === 'skeletal' ? segmentOf(p.name) : null;
    if (s === undefined) throw new Error(`build-body-rig: skeletal part "${p.name}" (${p.element}) is neither a known bone nor soft`);
    if (s) bones.set(p.element, { part: p, seg: segIndex(s) });
  }
}
const byName = new Map([...bones.values()].map((b) => [b.part.name, b.part]));
const bone = (n) => {
  const p = byName.get(n);
  if (!p) throw new Error(`build-body-rig: no bone "${n}"`);
  return p;
};
for (const s of SEGMENTS) if (![...bones.values()].some((b) => b.seg === segIndex(s))) throw new Error(`build-body-rig: segment ${s} has no bone`);
console.log(`${bones.size} bones in ${SEGMENTS.length} segments`);

// ---- joint centres ----------------------------------------------------------
const samplesOf = new Map();
const samples = (p) => {
  if (!samplesOf.has(p.element)) samplesOf.set(p.element, surfaceSamples(p, SAMPLE_MM));
  return samplesOf.get(p.element);
};
/** Vertices of `a` within CONTACT_MM of the surface of any of `bs`. */
function contact(as, bs) {
  const S = [];
  for (const b of bs) for (const v of samples(b)) S.push(v);
  const t = new PointTree(Float64Array.from(S)), out = [];
  for (const a of as) {
    const P = a.positions;
    for (let i = 0; i < P.length; i += 3) if (t.nearest(P[i], P[i + 1], P[i + 2]).d2 <= CONTACT_MM ** 2) out.push(P[i], P[i + 1], P[i + 2]);
  }
  return out;
}
const boxCentre = (p) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.positions[i + k]); hi[k] = Math.max(hi[k], p.positions[i + k]); }
  return lo.map((v, k) => (v + hi[k]) / 2);
};
const soft1 = new Map(files.flatMap((f) => f.parts).map((p) => [p.name, p]));
const disk = (n) => {
  const p = soft1.get(n);
  if (!p) throw new Error(`build-body-rig: no "${n}"`);
  return boxCentre(p);
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const fitInfo = (method, f) => ({ method, radiusMm: r3(f.radius), rmsMm: r3(f.rms), points: f.n });
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const neg = (v) => v.map((x) => (x === 0 ? 0 : -x));
const joints = [];
const joint = (pose, share, parent, child, centre, dof, axes, fit) => joints.push({ pose, share, parent: segIndex(parent), child: segIndex(child), centre: centre.map(r3), dof, axes, fit });

// spine: sacrum → L5 → … → L1 → trunk; the unnamed disk is T12/L1 (checked by height)
const lumbar = ORD.slice(0, 5).map((o) => disk(`intervertebral disk of ${o} lumbar vertebra`));
const t12l1 = disk('intervertebral disk');
const zOf = (n) => boxCentre(bone(n))[2];
if (!(t12l1[2] < zOf('twelfth thoracic vertebra') && t12l1[2] > zOf('first lumbar vertebra'))) throw new Error('build-body-rig: the unnamed disk is not T12/L1');
const spineAt = [...lumbar.slice().reverse(), t12l1]; // L5/S1 … L1/L2, T12/L1
const spineSegs = ['pelvis', 'L5', 'L4', 'L3', 'L2', 'L1', 'trunk'];
spineAt.forEach((c, i) => joint('spine', 1 / 6, spineSegs[i], spineSegs[i + 1], c, 3, [X, Y, Z], { method: 'disk centre' }));
// neck: trunk → C7 → … → C3 → head, at C7/T1 … C3/C4, C2/C3
const neckAt = [...ORD.slice(2, 7).reverse().map((o) => disk(`intervertebral disk of ${o} cervical vertebra`)), disk('intervertebral disk of axis')];
const neckSegs = ['trunk', 'C7', 'C6', 'C5', 'C4', 'C3', 'head'];
neckAt.forEach((c, i) => joint('neck', 1 / 6, neckSegs[i], neckSegs[i + 1], c, 3, [X, Y, Z], { method: 'disk centre' }));

const hipCheck = [];
for (const side of ['left', 'right']) {
  const out = side === 'left' ? 1 : -1; // abduction and external rotation turn to +x on the left
  const head = fitSphere(contact([bone(`${side} femur`)], [bone(`${side} hip bone`)]));
  const cup = fitSphere(contact([bone(`${side} hip bone`)], [bone(`${side} femur`)]));
  hipCheck.push({
    side, femoralHead: { centre: head.centre.map(r3), ...fitInfo('sphere', head) }, acetabulum: { centre: cup.centre.map(r3), ...fitInfo('sphere', cup) },
    apartMm: r3(Math.hypot(...head.centre.map((v, k) => v - cup.centre[k]))),
  });
  const shoulder = fitSphere(contact([bone(`${side} humerus`)], [bone(`${side} scapula`)]));
  const elbow = fitCircle(contact([bone(`${side} ulna`)], [bone(`${side} humerus`)]), 0);
  const wrist = fitSphere(contact([bone(`${side} scaphoid`), bone(`${side} lunate`)], [bone(`${side} radius`)]));
  const ankle = fitSphere(contact([bone(`${side} talus`)], [bone(`${side} tibia`)]));
  // knee: a sphere on each posterior condyle, the centre between them
  const F = bone(`${side} femur`).positions;
  let zmin = Infinity;
  for (let i = 2; i < F.length; i += 3) zmin = Math.min(zmin, F[i]);
  const low = [];
  for (let i = 0; i < F.length; i += 3) if (F[i + 2] < zmin + CONDYLE_MM) low.push(F[i], F[i + 1], F[i + 2]);
  const mid = [0, 1].map((k) => { let s = 0; for (let i = k; i < low.length; i += 3) s += low[i]; return s / (low.length / 3); });
  const condyles = [-1, 1].map((half) => {
    const pts = [];
    for (let i = 0; i < low.length; i += 3) if ((low[i] - mid[0]) * half > NOTCH_MM && low[i + 1] > mid[1]) pts.push(low[i], low[i + 1], low[i + 2]);
    return fitSphere(pts);
  });
  const knee = condyles[0].centre.map((v, k) => (v + condyles[1].centre[k]) / 2);
  const flexOut = neg(X), abdOut = side === 'left' ? neg(Y) : Y, twistOut = out > 0 ? Z : neg(Z);
  joint(`${side} shoulder`, 1, 'trunk', `${side} upper arm`, shoulder.centre, 3, [flexOut, abdOut, twistOut], fitInfo('sphere: humerus where it meets the scapula', shoulder));
  joint(`${side} elbow`, 1, `${side} upper arm`, `${side} forearm`, elbow.centre, 1, [flexOut, abdOut, twistOut], fitInfo('circle along x: ulna where it meets the humerus', elbow));
  joint(`${side} wrist`, 1, `${side} forearm`, `${side} hand`, wrist.centre, 2, [flexOut, abdOut, twistOut], fitInfo('sphere: scaphoid and lunate where they meet the radius', wrist));
  joint(`${side} hip`, 1, 'pelvis', `${side} thigh`, head.centre, 3, [flexOut, abdOut, twistOut], fitInfo('sphere: femur where it meets the hip bone', head));
  joint(`${side} knee`, 1, `${side} thigh`, `${side} shank`, knee, 1, [X, abdOut, twistOut], {
    method: 'midpoint of a sphere on each posterior femoral condyle', condyles: condyles.map((c) => ({ centre: c.centre.map(r3), ...fitInfo('sphere', c) })),
  });
  joint(`${side} ankle`, 1, `${side} shank`, `${side} foot`, ankle.centre, 1, [flexOut, abdOut, twistOut], fitInfo('sphere: talus where it meets the tibia', ankle));
}
// parents before children: spine, neck, then each limb from the root out
const order = (j) => {
  const depth = (s) => (s === 0 ? 0 : 1 + depth(joints.find((k) => k.child === s).parent));
  return depth(j.child);
};
joints.sort((a, b) => order(a) - order(b) || a.child - b.child);
for (const j of joints) console.log(`  ${j.pose.padEnd(15)} ${SEGMENTS[j.parent].padEnd(15)} → ${SEGMENTS[j.child].padEnd(16)} ${j.centre.map((v) => v.toFixed(1)).join(' ')}${j.fit.rmsMm !== undefined ? `  r ${j.fit.radiusMm} rms ${j.fit.rmsMm}` : ''}`);
for (const h of hipCheck) console.log(`  ${h.side} hip: femoral head vs acetabulum ${h.apartMm} mm`);

// ---- weights ----------------------------------------------------------------
const S = SEGMENTS.length;
const segSamples = SEGMENTS.map(() => []);
for (const b of bones.values()) for (const v of samples(b.part)) segSamples[b.seg].push(v);
const trees = segSamples.map((s) => new PointTree(Float64Array.from(s)));
const boxes = segSamples.map((s) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s[i + k]); hi[k] = Math.max(hi[k], s[i + k]); }
  return { lo, hi };
});
const allSamples = Float64Array.from(segSamples.flat());
const all = new PointTree(allSamples);
const label = new Uint8Array(segSamples.reduce((s, x) => s + x.length / 3, 0));
{ let k = 0; segSamples.forEach((s, i) => { label.fill(i, k, k + s.length / 3); k += s.length / 3; }); }
const boxD2 = (b, x, y, z) => {
  let d = 0;
  for (const [v, k] of [[x, 0], [y, 1], [z, 2]]) { const e = Math.max(b.lo[k] - v, 0, v - b.hi[k]); d += e * e; }
  return d;
};
let attached = 0, vertices = 0, oneSeg = 0, throughSkin = 0, blind = 0, blindCopied = 0;
/**
 * The skin's two sheets (BodyParts3D's skin is a thin closed shell): its
 * connected pieces, each outer when most of its normals point away from
 * the bone nearest them. Only the outer sheet borders air.
 */
function skinSheets(p) {
  const P = p.positions, I = p.indices, n = P.length / 3, normals = vertexNormals(P, I);
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); par[b] = a; par[find(c)] = a; }
  const vote = new Map();
  for (let v = 0; v < n; v++) {
    const q = all.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), B = allSamples;
    const away = normals[v * 3] * (P[v * 3] - B[q.index * 3]) + normals[v * 3 + 1] * (P[v * 3 + 1] - B[q.index * 3 + 1]) + normals[v * 3 + 2] * (P[v * 3 + 2] - B[q.index * 3 + 2]) > 0;
    const r = find(v), c = vote.get(r) ?? [0, 0];
    c[away ? 0 : 1]++;
    vote.set(r, c);
  }
  const outer = new Uint8Array(n);
  for (let v = 0; v < n; v++) { const c = vote.get(find(v)); outer[v] = c[0] > c[1] ? 1 : 0; }
  const k = outer.reduce((a, b) => a + b, 0);
  if (!(k > n * 0.3 && k < n * 0.7)) throw new Error(`build-body-rig: the skin's outer sheet is ${k} of ${n} vertices, not about half`);
  return { outer, normals };
}

/** A vertex's (segment, weight) pairs, heaviest first, as the file keeps
 *  them: three at most, in 255ths. */
function store(seg, w, v, pairs) {
  const sum = pairs.reduce((a, [, x]) => a + x, 0);
  let w0 = Math.round((255 * pairs[0][1]) / sum), w1 = pairs.length > 1 ? Math.round((255 * pairs[1][1]) / sum) : 0;
  if (pairs.length < 3) w1 = 255 - w0;
  if (w0 + w1 > 255) w1 = 255 - w0;
  pairs.forEach(([s], k) => { seg[v * 3 + k] = s; });
  // one segment: named twice, so only an attachment has no second
  if (pairs.length === 1) { seg[v * 3 + 1] = pairs[0][0]; oneSeg++; }
  w[v * 2] = w0; w[v * 2 + 1] = w1;
}

/** Weights (S a vertex) averaged with the mesh neighbours' `steps` times,
 *  half and half: a switch between segments becomes a blend a few edges
 *  wide, which stretches the skin where a hard switch tears it. */
function smooth(W, S, I, steps) {
  const n = W.length / S, nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { nb[I[t + k]].add(I[t + (k + 1) % 3]); nb[I[t + (k + 1) % 3]].add(I[t + k]); }
  const lists = nb.map((s) => [...s]);
  let cur = W, next = new Float32Array(W.length);
  for (let it = 0; it < steps; it++) {
    for (let v = 0; v < n; v++) {
      const L = lists[v];
      for (let s = 0; s < S; s++) {
        let m = 0;
        for (const u of L) m += cur[u * S + s];
        next[v * S + s] = L.length ? 0.5 * cur[v * S + s] + (0.5 * m) / L.length : cur[v * S + s];
      }
    }
    [cur, next] = [next, cur];
  }
  if (cur !== W) W.set(cur);
}
const weightFiles = [];
const skinPart = files.find((f) => f.digest === 'bodyparts3d-body' && f.system === 'integumentary')?.parts.find((p) => p.name === SKIN);
if (!skinPart) throw new Error('build-body-rig: no skin');
const skinOuter = skinSheets(skinPart).outer, outerTris = [];
for (let t = 0; t < skinPart.indices.length; t += 3) {
  const a = skinPart.indices[t], b = skinPart.indices[t + 1], c = skinPart.indices[t + 2];
  if (skinOuter[a] && skinOuter[b] && skinOuter[c]) outerTris.push(a, b, c);
}
const skinGrid = new TriangleGrid({ positions: skinPart.positions, indices: outerTris }, SKIN_CELL_MM);
console.log(`skin: outer sheet ${outerTris.length / 3} of ${skinPart.indices.length / 3} triangles`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of files) {
  const rows = [];
  for (const p of f.parts) {
    if (bones.has(p.element)) continue;
    const P = p.positions, n = P.length / 3, seg = new Uint8Array(n * 3).fill(NO_SEG), w = new Uint8Array(n * 2);
    const muscle = f.system === 'muscular';
    // the skin's weights are smoothed over its surface before they are stored
    const dense = p === skinPart ? new Float32Array(n * S) : null;
    // per vertex its (segment, weight) pairs; a vertex that sees no bone
    // (a muscle poking out through the skin) takes its nearest sighted
    // neighbour's in the same part, its own blind guess only if none sees
    const pairsOf = new Array(n).fill(null), guess = new Map(), locked = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const first = all.nearest(x, y, z), s1 = label[first.index], d1 = Math.sqrt(first.d2);
      if (muscle && d1 <= ATTACH_MM) { seg[v * 3] = s1; w[v * 2] = 255; attached++; locked[v] = 1; pairsOf[v] = [[s1, 1]]; continue; }
      // candidates: segments near enough to weigh, nearest first, each with
      // its nearest bone point; the nearest seen through the body only
      const cands = (reach) => {
        const out = [];
        for (let s = 0; s < S; s++) {
          if (reach !== null && s !== s1 && boxD2(boxes[s], x, y, z) > reach) continue;
          const q = trees[s].nearest(x, y, z), B = segSamples[s];
          if (reach === null || q.d2 <= reach) out.push([s, Math.max(Math.sqrt(q.d2), 0.1), B[q.index * 3], B[q.index * 3 + 1], B[q.index * 3 + 2]]);
        }
        return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      };
      const seen = (c) => !skinGrid.crosses(x, y, z, c[2], c[3], c[4], SKIN_SKIP_MM);
      let list = cands((FAR * Math.max(d1, 0.1)) ** 2), ok = list.filter(seen);
      if (!ok.length || ok[0][0] !== s1) { list = cands(null); ok = list.filter(seen); }
      const pairs = (from) => {
        const top = from.filter(([, d]) => d <= FAR * from[0][1]).slice(0, 3), q = top.map(([, d]) => 1 / d ** 4), sum = q.reduce((a, b) => a + b, 0);
        return top.map(([s], k) => [s, q[k] / sum]);
      };
      if (!ok.length) { guess.set(v, pairs(list)); continue; }
      if (ok[0][0] !== s1) throughSkin++;
      pairsOf[v] = pairs(ok);
    }
    if (guess.size) {
      const at = [], idx = [];
      for (let v = 0; v < n; v++) if (pairsOf[v]) { at.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); idx.push(v); }
      const t = idx.length ? new PointTree(Float64Array.from(at)) : null;
      for (const [v, g] of guess) {
        pairsOf[v] = t ? pairsOf[idx[t.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).index]] : g;
        if (t) blindCopied++; else blind++;
      }
    }
    for (let v = 0; v < n; v++) {
      if (locked[v]) continue;
      if (dense) for (const [s, x] of pairsOf[v]) dense[v * S + s] = x;
      else store(seg, w, v, pairsOf[v]);
    }
    if (dense) {
      smooth(dense, S, p.indices, SMOOTH_STEPS);
      for (let v = 0; v < n; v++) {
        const pairs = [];
        for (let s = 0; s < S; s++) if (dense[v * S + s] > 0) pairs.push([s, dense[v * S + s]]);
        pairs.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        store(seg, w, v, pairs.slice(0, 3));
      }
    }
    vertices += n;
    rows.push({ element: p.element, weights: { seg, w } });
  }
  if (!rows.length) continue;
  const file = `${f.digest}.${f.system}.cbrw`;
  const bytes = packWeights(rows);
  writeFileSync(join(OUT, file), bytes);
  weightFiles.push({ digest: f.digest, system: f.system, file, parts: rows.length, vertices: rows.reduce((s, r) => s + r.weights.seg.length / 3, 0), bytes: bytes.length });
  console.log(`  weighted ${f.digest} ${f.system}: ${rows.length} parts`);
}
console.log(`${vertices} soft vertices; ${attached} muscle attachments; ${oneSeg} following one segment; ${throughSkin} following another than the nearest bone, across the skin; ${blindCopied} seeing no bone, as their nearest sighted neighbour; ${blind} in parts that see none (all counted)`);

// ---- output -----------------------------------------------------------------
const pins = Object.fromEntries(files.map((f) => [f.digest, f.pin]));
const registry = JSON.parse(readFileSync(join(ROOT, 'DIGESTS.json'), 'utf8')).digests;
const upstream = (d) => {
  const url = registry.find((r) => r.id === d)?.source_url;
  if (!url?.startsWith('https://')) throw new Error(`build-body-rig: DIGESTS.json has no source for ${d}`);
  return url;
};
writeFileSync(join(OUT, 'rig.json'), JSON.stringify({
  format: 'carys-body-rig/1', pin: 'body-rig-1',
  frame: 'BodyParts3D (mm; x to the body\'s left, y to its back, z up), as digests/bodyparts3d-body',
  digests: pins,
  segments: SEGMENTS,
  bones: Object.fromEntries([...bones].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([e, b]) => [e, b.seg])),
  joints,
  hipCheck,
  weights: {
    method: `each vertex follows its three nearest segments by 1/d⁴, d its distance (mm) to their bones' surfaces sampled ${SAMPLE_MM} mm apart (segments beyond ${FAR}× the nearest not counted); a segment counts only if the straight line to its nearest bone point crosses no triangle of the skin's outer sheet (past ${SKIN_SKIP_MM} mm from the vertex); a vertex that sees none takes the weights of its part's nearest vertex that does (all segments counted when none in its part does); the skin's weights are then averaged with its neighbours' ${SMOOTH_STEPS} times; a muscle vertex within ${ATTACH_MM} mm of a bone follows that bone alone`,
    attachments: attached, vertices, acrossSkin: throughSkin, seeingNoneCopied: blindCopied, seeingNone: blind, files: weightFiles,
  },
}, null, 1) + '\n');
writeFileSync(join(OUT, 'SOURCES.json'), JSON.stringify({
  digest: 'body-rig', format: 'carys-sources/1',
  sources: DIGESTS.map((d) => ({
    entry_count: files.filter((f) => f.digest === d).reduce((s, f) => s + f.parts.length, 0), license_spdx: 'CC-BY-4.0', retrieved_date: '2026-09-24',
    source_url: upstream(d), version_pin: pins[d], role: `fitted from digests/${d} (the committed digest, itself cited in its SOURCES.json)`,
  })),
}, null, 1) + '\n');
console.log(`digests/body-rig: rig.json, ${weightFiles.length} weight files, ${(weightFiles.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(2)} MB`);
