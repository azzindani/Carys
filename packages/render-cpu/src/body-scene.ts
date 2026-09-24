// The whole body as one scene (H2, docs/PHASES.md): the parts of the shown
// systems merged into one mesh in the renderer's frame, knowing which part
// every triangle is (a tap names it), a colour per triangle, a coarse copy
// for the frames drawn while the view moves, and the view that frames a few
// parts. Pure, no DOM.
import { vertexNormals } from './mesh-smooth.js';
import type { BodyPart, BodyPartMeta } from './body-pack.js';
import type { TriMesh } from './surface.js';

type V3 = [number, number, number];
type RGB = readonly [number, number, number];

/** A part in the renderer's frame: mm, x across, y up, z out of the body's
 *  front (so orbit 0 faces it), offset so the body's box starts at 0. */
export interface ScenePart extends BodyPartMeta {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface BodyBox {
  min: V3;
  max: V3;
}

export interface BodyScene {
  mesh: TriMesh;
  /** per triangle, its part's index in the list the scene was built from */
  triPart: Uint32Array;
}

/**
 * BodyParts3D (z up, y toward the back) to the renderer's frame (y up, z
 * toward the viewer): (x, y, z) → (x − min.x, z − min.z, max.y − y). A
 * rotation, so windings and outward normals keep.
 */
export function toScenePart(part: BodyPart, box: BodyBox): ScenePart {
  const P = part.positions, n = P.length;
  const positions = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    positions[i] = P[i]! - box.min[0];
    positions[i + 1] = P[i + 2]! - box.min[2];
    positions[i + 2] = box.max[1] - P[i + 1]!;
  }
  const { fma, element, name, system, sourceTris, errorMm, indices } = part;
  return { fma, element, name, system, sourceTris, errorMm, positions, normals: Float32Array.from(vertexNormals(positions, indices)), indices };
}

/** The body box's extent in the renderer's frame: renderMesh's `dims`. */
export function sceneDims(box: BodyBox): V3 {
  return [box.max[0] - box.min[0], box.max[2] - box.min[2], box.max[1] - box.min[1]];
}

/** The shown parts as one mesh. */
export function assembleScene(parts: readonly ScenePart[], shown: (i: number) => boolean): BodyScene {
  let nv = 0, ni = 0;
  const keep: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!shown(i)) continue;
    keep.push(i);
    nv += parts[i]!.positions.length; ni += parts[i]!.indices.length;
  }
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  const triPart = new Uint32Array(ni / 3);
  let v = 0, k = 0;
  for (const i of keep) {
    const p = parts[i]!, base = v / 3;
    positions.set(p.positions, v); normals.set(p.normals, v);
    for (let j = 0; j < p.indices.length; j++) indices[k + j] = base + p.indices[j]!;
    triPart.fill(i, k / 3, (k + p.indices.length) / 3);
    v += p.positions.length; k += p.indices.length;
  }
  return { mesh: { positions, normals, indices }, triPart };
}

/** renderMesh's `triColor`: each triangle its part's colour. */
export function sceneColors(scene: BodyScene, colorOf: (part: number) => RGB): Uint8Array {
  const out = new Uint8Array(scene.mesh.indices.length);
  let last = -1, c: RGB = [0, 0, 0];
  for (let t = 0; t < scene.triPart.length; t++) {
    const p = scene.triPart[t]!;
    if (p !== last) { c = colorOf(p); last = p; }
    out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2];
  }
  return out;
}

/** renderMesh's `triAlpha`: each triangle its part's opacity (H4). Null
 *  when all are opaque, so the render is exactly the one without. */
export function sceneAlpha(scene: BodyScene, alphaOf: (part: number) => number): Float32Array | null {
  const out = new Float32Array(scene.triPart.length);
  let last = -1, a = 1, any = false;
  for (let t = 0; t < scene.triPart.length; t++) {
    const p = scene.triPart[t]!;
    if (p !== last) {
      a = alphaOf(p);
      if (!(a >= 0 && a <= 1)) throw new RangeError(`body-scene-alpha: part ${p} opacity ${a}`);
      last = p;
    }
    out[t] = a;
    if (a < 1) any = true;
  }
  return any ? out : null;
}

/**
 * A coarse copy by vertex clustering: a part's vertices in one `cell` (mm)
 * whose normals point into the same octant merge to their mean, their
 * normals summed, and triangles left with two corners on one vertex drop.
 * Parts never merge, so every triangle keeps its part; nor do the two sheets
 * of a thin shell (the skin is one), whose normals would cancel. One pass,
 * no error metric: it is for frames drawn while the view moves, where a
 * cell under a pixel is not seen.
 */
export function clusterScene(scene: BodyScene, cell: number): BodyScene {
  if (!(cell > 0)) throw new RangeError(`body-scene-cell: ${cell}`);
  const { positions: P, normals: N, indices: I } = scene.mesh;
  const nv = P.length / 3;
  // a vertex's part, from any triangle using it
  const part = new Uint32Array(nv);
  for (let t = 0; t < I.length; t++) part[I[t]!] = scene.triPart[(t / 3) | 0]!;
  const lo = [Infinity, Infinity, Infinity], g = [1, 1, 1];
  let parts = 1;
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) lo[k] = Math.min(lo[k]!, P[v * 3 + k]!);
    parts = Math.max(parts, part[v]! + 1);
  }
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) g[k] = Math.max(g[k]!, Math.floor((P[v * 3 + k]! - lo[k]!) / cell) + 1);
  }
  const [gx, gy, gz] = g as V3;
  // one number per (part, cell, octant): exact while it stays an integer
  if (parts * gx * gy * gz * 8 > Number.MAX_SAFE_INTEGER) throw new RangeError(`body-scene-cell: ${cell} mm is too fine for ${parts} parts`);
  const cellOf = new Map<number, number>();
  const remap = new Uint32Array(nv);
  const sum: number[] = [], nsum: number[] = [], count: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3]!, y = P[v * 3 + 1]!, z = P[v * 3 + 2]!;
    const octant = (N[v * 3]! >= 0 ? 1 : 0) | (N[v * 3 + 1]! >= 0 ? 2 : 0) | (N[v * 3 + 2]! >= 0 ? 4 : 0);
    const key = (((part[v]! * gy + Math.floor((y - lo[1]!) / cell)) * gx + Math.floor((x - lo[0]!) / cell)) * gz + Math.floor((z - lo[2]!) / cell)) * 8 + octant;
    let c = cellOf.get(key);
    if (c === undefined) {
      c = count.length;
      cellOf.set(key, c);
      sum.push(0, 0, 0); nsum.push(0, 0, 0); count.push(0);
    }
    remap[v] = c;
    sum[c * 3]! += x; sum[c * 3 + 1]! += y; sum[c * 3 + 2]! += z;
    nsum[c * 3]! += N[v * 3]!; nsum[c * 3 + 1]! += N[v * 3 + 1]!; nsum[c * 3 + 2]! += N[v * 3 + 2]!;
    count[c]!++;
  }
  const m = count.length;
  const positions = new Float32Array(m * 3), normals = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) {
    const w = 1 / count[c]!;
    positions[c * 3] = sum[c * 3]! * w; positions[c * 3 + 1] = sum[c * 3 + 1]! * w; positions[c * 3 + 2] = sum[c * 3 + 2]! * w;
    const l = 1 / (Math.hypot(nsum[c * 3]!, nsum[c * 3 + 1]!, nsum[c * 3 + 2]!) || 1);
    normals[c * 3] = nsum[c * 3]! * l; normals[c * 3 + 1] = nsum[c * 3 + 1]! * l; normals[c * 3 + 2] = nsum[c * 3 + 2]! * l;
  }
  const idx: number[] = [], tp: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = remap[I[t]!]!, b = remap[I[t + 1]!]!, c = remap[I[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    idx.push(a, b, c); tp.push(scene.triPart[t / 3]!);
  }
  return { mesh: { positions, normals, indices: Uint32Array.from(idx) }, triPart: Uint32Array.from(tp) };
}

/**
 * renderMesh's `center` and `zoom` framing some parts: centred on their
 * box, whose diagonal spans `fill` of the frame's shorter side at any orbit.
 * Null when none of them has a vertex.
 */
export function frameParts(
  parts: readonly ScenePart[], which: Iterable<number>, dims: V3, fill = 0.8,
): { center: V3; zoom: number } | null {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const i of which) {
    const P = parts[i]?.positions;
    if (!P) throw new RangeError(`body-scene-part: ${i}`);
    for (let v = 0; v < P.length; v += 3) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, P[v + k]!); hi[k] = Math.max(hi[k]!, P[v + k]!); }
    }
  }
  if (!(lo[0] <= hi[0])) return null;
  const diag = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1e-6);
  // renderMesh draws Math.max(...dims) across 0.92 of the shorter side at zoom 1
  const zoom = (fill * Math.max(...dims)) / (0.92 * diag);
  return { center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], zoom };
}
