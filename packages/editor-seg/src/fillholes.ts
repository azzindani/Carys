// Ported from VolView core/tools/paint/fillHoles.ts (182 lines, zero-dep).
// Per-slice 4-connected flood from border -> outside; unvisited background =
// hole. Fills with label (or majority-bordering-label), never overwrites
// non-zero, respects lockedLabels. Returns a copy.

export function fillHoles(
  mask: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  label = 1,
  lockedLabels: number[] = [],
): Uint8Array {
  const out = mask.slice();
  const locked = new Set(lockedLabels);
  const idx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;

  for (let z = 0; z < nz; z++) {
    const outside = new Uint8Array(nx * ny);
    const q: number[] = [];
    for (let x = 0; x < nx; x++) {
      for (const y of [0, ny - 1]) {
        if (out[idx(x, y, z)] === 0 && !outside[y * nx + x]) {
          outside[y * nx + x] = 1;
          q.push(y * nx + x);
        }
      }
    }
    for (let y = 0; y < ny; y++) {
      for (const x of [0, nx - 1]) {
        if (out[idx(x, y, z)] === 0 && !outside[y * nx + x]) {
          outside[y * nx + x] = 1;
          q.push(y * nx + x);
        }
      }
    }
    while (q.length) {
      const c = q.pop()!;
      const cx = c % nx, cy = Math.floor(c / nx);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = cx + ox, y = cy + oy;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const n = y * nx + x;
        if (outside[n] || out[idx(x, y, z)] !== 0) continue;
        outside[n] = 1;
        q.push(n);
      }
    }
    // Unvisited zeros are holes.
    const counts = new Map<number, number>();
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (out[idx(x, y, z)] !== 0 || outside[y * nx + x]) continue;
        // bordering labels vote
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const bx = x + ox, by = y + oy;
          if (bx < 0 || by < 0 || bx >= nx || by >= ny) continue;
          const v = out[idx(bx, by, z)];
          if (v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
    }
    let fillLabel = label;
    if (label === 0 && counts.size > 0) {
      let best = 0, bestN = -1;
      for (const [v, n] of counts) {
        if (n > bestN || (n === bestN && v < best)) {
          best = v;
          bestN = n;
        }
      }
      fillLabel = best;
    }
    if (locked.has(fillLabel)) continue;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (out[idx(x, y, z)] === 0 && !outside[y * nx + x]) {
          out[idx(x, y, z)] = fillLabel;
        }
      }
    }
  }
  return out;
}
