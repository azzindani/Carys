// Smart scissors / livewire + level-set refine: gradient-guided boundary
// tools on one slice. Livewire = Dijkstra shortest path over a
// gradient-magnitude cost field (Mortensen-Barrett, CPU cut on 8-neigh
// pixels); level-set refine = one Chan-Vese-style mean-separation pass
// inside a band around the mask boundary. Both pure, both slice-local.
//
// What stays out (documented): on-the-fly training, 3D livewire volumes,
// multi-phase level sets — those need product + perf work, not just math.
import type { Volume } from '@carys/volume-core';

/** Sobel gradient magnitude of one axial slice (float, same W×H layout). */
export function sliceGradient(
  vol: Volume, z: number,
): Float64Array {
  const [nx, ny, nz] = vol.dims;
  const zi = Math.max(0, Math.min(nz - 1, Math.round(z)));
  const out = new Float64Array(nx * ny);
  const at = (x: number, y: number): number => {
    const xc = Math.max(0, Math.min(nx - 1, x));
    const yc = Math.max(0, Math.min(ny - 1, y));
    return vol.data[zi * nx * ny + yc * nx + xc] as number;
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      out[y * nx + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Livewire path between two slice pixels: Dijkstra over
 * cost = 1 / (1 + gradient) per step (strong edges are cheap), 8-neigh
 * moves weighted by Euclidean length. Returns the pixel path
 * seed→target inclusive. Throws on empty/oob endpoints.
 */
export function livewirePath(
  grad: Float64Array, w: number, h: number,
  seed: [number, number], target: [number, number],
): [number, number][] {
  const ok = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h;
  if (!ok(seed[0], seed[1]) || !ok(target[0], target[1])) {
    throw new RangeError(`livewire-endpoints: [${seed}] → [${target}] on ${w}×${h}`);
  }
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const si = seed[1] * w + seed[0];
  const ti = target[1] * w + target[0];
  dist[si] = 0;
  // binary-heap-free Dijkstra (O(n²) worst case, fine for slice sizes —
  // the heap is the perf follow-up, not this prototype)
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i]! < best) { best = dist[i]!; u = i; }
    }
    if (u < 0 || u === ti) break;
    done[u] = 1;
    const ux = u % w, uy = Math.floor(u / w);
    for (const [dx, dy, len] of DIRS) {
      const vx = ux + dx, vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
      const vi = vy * w + vx;
      if (done[vi]) continue;
      const g = Math.max(grad[u]!, grad[vi]!);
      const nd = dist[u]! + len / (1 + g);
      if (nd < dist[vi]!) {
        dist[vi] = nd;
        prev[vi] = u;
      }
    }
  }
  if (!Number.isFinite(dist[ti])) throw new RangeError('livewire-unreachable (empty gradient?)');
  const path: [number, number][] = [];
  for (let c = ti; c >= 0; c = prev[c]!) {
    path.push([c % w, Math.floor(c / w)]);
    if (c === si) break;
  }
  path.reverse();
  return path;
}

/**
 * One level-set refine pass (Chan-Vese means): inside/outside means from
 * the current mask on the slice, then each boundary-band pixel joins the
 * side whose mean it is closer to. Returns the changed count.
 */
export function levelSetRefine(
  vol: Volume, mask: Uint8Array, z: number, band = 2,
): number {
  const [nx, ny, nz] = vol.dims;
  const zi = Math.max(0, Math.min(nz - 1, Math.round(z)));
  if (mask.length !== nx * ny * nz) throw new RangeError('levelset-mask-dims');
  if (!Number.isInteger(band) || band < 1) throw new RangeError(`levelset-band: ${band}`);
  let sumIn = 0, nIn = 0, sumOut = 0, nOut = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = zi * nx * ny + y * nx + x;
      const v = vol.data[i] as number;
      if (mask[i]) { sumIn += v; nIn++; }
      else { sumOut += v; nOut++; }
    }
  }
  if (nIn === 0 || nOut === 0) return 0;
  const meanIn = sumIn / nIn, meanOut = sumOut / nOut;
  if (meanIn === meanOut) return 0;
  const isEdge = (x: number, y: number): boolean => {
    const i = zi * nx * ny + y * nx + x;
    const v0 = mask[i]! > 0;
    for (let dy = -band; dy <= band; dy++) {
      for (let dx = -band; dx <= band; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        if ((mask[zi * nx * ny + yy * nx + xx]! > 0) !== v0) return true;
      }
    }
    return false;
  };
  let changed = 0;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!isEdge(x, y)) continue;
      const i = zi * nx * ny + y * nx + x;
      const v = vol.data[i] as number;
      const want = Math.abs(v - meanIn) <= Math.abs(v - meanOut) ? 1 : 0;
      if ((mask[i]! > 0 ? 1 : 0) !== want) {
        mask[i] = want;
        changed++;
      }
    }
  }
  return changed;
}
