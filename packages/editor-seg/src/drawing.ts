// Ported from NiiVue drawing/ (rle.ts, undo.ts, PenTool.ts, FloodFillTool.ts,
// ShapeTool.ts, DrawingManager.ts) + CACTAS js/drawer.js + js/annotator.js.
// CPU-only: Uint8 mask ops, no GL. CACTAS fixes applied: strokeSegment gap
// fill (Bresenham, which CACTAS lacks), symmetric tolerance window (CACTAS
// grow used asymmetric [intensity*tol/100, 2*intensity] — likely bug).

export const NEIGHBORS6: [number, number, number][] = [
  [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0],
];

/** PackBits RLE (NiiVue drawing/rle.ts): undo + encodedDrawingBlob format. */
export function encodeRLE(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 127) run++;
    if (run > 1) {
      out.push(257 - run, data[i]);
      i += run;
    } else {
      let lit = 0;
      while (
        i + lit < data.length && lit < 127 &&
        (lit + 1 >= data.length - i || data[i + lit] !== data[i + lit + 1])
      ) {
        lit++;
        if (i + lit + 1 < data.length && data[i + lit] === data[i + lit + 1]) break;
      }
      out.push(lit - 1, ...data.slice(i, i + lit));
      i += lit;
    }
  }
  return new Uint8Array(out);
}

export function decodeRLE(enc: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0, i = 0;
  while (i < enc.length && o < expected) {
    const n = enc[i++];
    if (n >= 128) {
      const run = 257 - n;
      const v = enc[i++];
      out.fill(v, o, o + run);
      o += run;
    } else {
      const lit = n + 1;
      out.set(enc.slice(i, i + lit), o);
      i += lit;
      o += lit;
    }
  }
  return out;
}

/** Undo ring (NiiVue drawing/undo.ts): RLE snapshots, wrap-around. */
export class UndoStack {
  private stack: Uint8Array[] = [];
  private head = -1;
  constructor(public maxDepth = 8) {}
  push(mask: Uint8Array): void {
    this.stack = this.stack.slice(0, this.head + 1);
    this.stack.push(encodeRLE(mask));
    if (this.stack.length > this.maxDepth) this.stack.shift();
    this.head = this.stack.length - 1;
  }
  undo(currentLen: number): Uint8Array | null {
    if (this.head <= 0) return null;
    this.head--;
    return decodeRLE(this.stack[this.head], currentLen);
  }
  clear(): void {
    this.stack = [];
    this.head = -1;
  }
  get depth(): number {
    return this.head + 1;
  }
}

function idxOf(nx: number, ny: number, x: number, y: number, z: number): number {
  return x + y * nx + z * nx * ny;
}

/** Single-voxel paint (NiiVue PenTool.drawPoint / CACTAS setLabelmapPixel). */
export function drawPt(
  mask: Uint8Array, nx: number, ny: number, nz: number,
  x: number, y: number, z: number, value: number,
): void {
  if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
  mask[idxOf(nx, ny, x, y, z)] = value;
}

/** 3D Bresenham pen line (NiiVue PenTool.drawLine; fills CACTAS dotted gaps). */
export function drawPenLine(
  mask: Uint8Array, nx: number, ny: number, nz: number,
  a: [number, number, number], b: [number, number, number], value: number,
): void {
  let [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  let err1: number, err2: number;
  if (dx >= dy && dx >= dz) {
    err1 = 2 * dy - dx; err2 = 2 * dz - dx;
    for (let i = 0; i <= dx; i++) {
      drawPt(mask, nx, ny, nz, x0, y0, z0, value);
      if (err1 > 0) { y0 += sy; err1 -= 2 * dx; }
      if (err2 > 0) { z0 += sz; err2 -= 2 * dx; }
      err1 += 2 * dy; err2 += 2 * dz; x0 += sx;
    }
  } else if (dy >= dx && dy >= dz) {
    err1 = 2 * dx - dy; err2 = 2 * dz - dy;
    for (let i = 0; i <= dy; i++) {
      drawPt(mask, nx, ny, nz, x0, y0, z0, value);
      if (err1 > 0) { x0 += sx; err1 -= 2 * dy; }
      if (err2 > 0) { z0 += sz; err2 -= 2 * dy; }
      err1 += 2 * dx; err2 += 2 * dz; y0 += sy;
    }
  } else {
    err1 = 2 * dy - dz; err2 = 2 * dx - dz;
    for (let i = 0; i <= dz; i++) {
      drawPt(mask, nx, ny, nz, x0, y0, z0, value);
      if (err1 > 0) { y0 += sy; err1 -= 2 * dz; }
      if (err2 > 0) { x0 += sx; err2 -= 2 * dz; }
      err1 += 2 * dy; err2 += 2 * dx; z0 += sz;
    }
  }
}

/**
 * Two-pass flood fill (NiiVue drawFloodFill builtin; CACTAS grow()).
 * Pass 1: BFS reachable set from seed within seed label. Pass 2 (if lo/hi
 * finite): restrict to voxels with intensity in [lo,hi], BFS again.
 * CACTAS _grow() O(n^2) visited scan deliberately NOT ported (100x slower).
 */
export function floodFill(
  mask: Uint8Array, intensity: ArrayLike<number>,
  nx: number, ny: number, nz: number,
  seed: [number, number, number], label: number,
  lo: number, hi: number,
): void {
  const seedIdx = idxOf(nx, ny, ...seed);
  const seedLabel = mask[seedIdx];
  // Pass 1: reachable within seed label
  const reach = new Uint8Array(mask.length);
  const q: number[] = [seedIdx];
  reach[seedIdx] = 1;
  while (q.length) {
    const c = q.pop()!;
    const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
    for (const [ox, oy, oz] of NEIGHBORS6) {
      const x = cx + ox, y = cy + oy, z = cz + oz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const n = idxOf(nx, ny, x, y, z);
      if (reach[n] || mask[n] !== seedLabel) continue;
      reach[n] = 1;
      q.push(n);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    for (let i = 0; i < mask.length; i++) if (reach[i]) mask[i] = label;
    return;
  }
  // Pass 2: intensity gate
  const gate = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!reach[i]) continue;
    const v = intensity[i] as number;
    if (v >= lo && v <= hi) gate[i] = 1;
  }
  if (!gate[seedIdx]) return;
  const fill = new Uint8Array(mask.length);
  const q2: number[] = [seedIdx];
  fill[seedIdx] = 1;
  while (q2.length) {
    const c = q2.pop()!;
    const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
    for (const [ox, oy, oz] of NEIGHBORS6) {
      const x = cx + ox, y = cy + oy, z = cz + oz;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const n = idxOf(nx, ny, x, y, z);
      if (fill[n] || !gate[n]) continue;
      fill[n] = 1;
      q2.push(n);
    }
  }
  for (let i = 0; i < mask.length; i++) if (fill[i]) mask[i] = label;
}

/** Rectangle mask (NiiVue ShapeTool.drawRectangle). */
export function drawRectMask(
  mask: Uint8Array, nx: number, ny: number, nz: number,
  a: [number, number, number], b: [number, number, number], value: number,
): void {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const [z0, z1] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) drawPt(mask, nx, ny, nz, x, y, z, value);
}

/** Ellipsoid mask (NiiVue ShapeTool.drawEllipse +0.5 fudge). */
export function drawEllipseMask(
  mask: Uint8Array, nx: number, ny: number, nz: number,
  center: [number, number, number], radii: [number, number, number], value: number,
): void {
  const [cx, cy, cz] = center;
  const [rx, ry, rz] = radii;
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d =
          ((x - cx) / (rx + 0.5)) ** 2 +
          ((y - cy) / (ry + 0.5)) ** 2 +
          ((z - cz) / (rz + 0.5)) ** 2;
        if (d <= 1) drawPt(mask, nx, ny, nz, x, y, z, value);
      }
}
