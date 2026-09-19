// Cell table: threshold a viewed channel tile into a binary mask, label
// 2D 4-neighbour connected components, and tabulate per-cell area +
// centroid + mean intensity. Pure typed-array work, no DOM — the same
// contract style as editor-seg/ops (pure fns the viewer calls), kept here
// in volume-core so the table math is unit-testable without the zarr
// fetch path. Scale behavior: labels are a caller-supplied cap contract
// (the viewer passes a scaled-down tile for huge stores); the stats carry
// the pixel scale so areas convert to physical units at the call site.
export interface CellStat {
  /** 1-based label value (matches the labelmap) */
  id: number;
  /** voxel/pixel count */
  area: number;
  /** intensity-weighted centroid in tile pixels */
  cx: number;
  cy: number;
  /** mean raw intensity over the component */
  mean: number;
  /** bounding box in tile pixels, inclusive */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** CellProfiler-Studied shape columns (MeasureObjectSizeShape subset):
   *  perimeter (boundary px, 4-neighbourhood edges), bbox fill ratio
   *  (extent = area / bbox area), circularity (form factor =
   *  4π·area/perimeter², 1 = perfect disc), and aspect (bbox w/h ≥ 1,
   *  the cheap eccentricity stand-in — true major/minor axes stay out). */
  perimeter: number;
  extent: number;
  formFactor: number;
  aspect: number;
}

export interface CellTable {
  w: number;
  h: number;
  labels: Int32Array;
  count: number;
  cells: CellStat[];
}

/**
 * Label a thresholded channel tile. Pixels > threshold are foreground;
 * 4-neighbour BFS labels them. Components smaller than minArea drop out
 * (dust filter) and never take an id. Throws `cells-*` on bad geometry.
 * Deterministic: scan order fixes ids, ties break by scan order.
 */
export function labelCells(
  tile: ArrayLike<number>, w: number, h: number, threshold: number, minArea = 1,
): CellTable {
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new RangeError(`cells-dims: ${w}x${h}`);
  }
  if (tile.length !== w * h) throw new RangeError(`cells-length: ${tile.length} vs ${w * h}`);
  if (!Number.isFinite(threshold)) throw new RangeError(`cells-threshold: ${threshold}`);
  if (!Number.isInteger(minArea) || minArea < 1) throw new RangeError(`cells-min-area: ${minArea}`);
  const labels = new Int32Array(w * h).fill(-1);
  const cells: CellStat[] = [];
  let count = 0;
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !(tile[i]! > threshold)) continue;
    // flood one component (4-neighbourhood, stack DFS)
    const stack: number[] = [i];
    seen[i] = 1;
    const members: number[] = [];
    while (stack.length > 0) {
      const c = stack.pop()!;
      members.push(c);
      const cx = c % w, cy = Math.floor(c / w);
      if (cx > 0 && !seen[c - 1] && tile[c - 1]! > threshold) { seen[c - 1] = 1; stack.push(c - 1); }
      if (cx + 1 < w && !seen[c + 1] && tile[c + 1]! > threshold) { seen[c + 1] = 1; stack.push(c + 1); }
      if (cy > 0 && !seen[c - w] && tile[c - w]! > threshold) { seen[c - w] = 1; stack.push(c - w); }
      if (cy + 1 < h && !seen[c + w] && tile[c + w]! > threshold) { seen[c + w] = 1; stack.push(c + w); }
    }
    if (members.length < minArea) continue;
    count++;
    let sx = 0, sy = 0, si = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const m of members) {
      labels[m] = count;
      const px = m % w, py = Math.floor(m / w);
      const v = tile[m]!;
      sx += px * v; sy += py * v; si += v;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
    }
    // CellProfiler-Studied shape columns: perimeter counts exposed
    // 4-neighbourhood edges (boundary walk without a contour tracer);
    // extent/formFactor/aspect derive from area + perimeter + bbox.
    let perimeter = 0;
    for (const m of members) {
      const px = m % w, py = Math.floor(m / w);
      if (px === 0 || labels[m - 1] !== count) perimeter++;
      if (px + 1 >= w || labels[m + 1] !== count) perimeter++;
      if (py === 0 || labels[m - w] !== count) perimeter++;
      if (py + 1 >= h || labels[m + w] !== count) perimeter++;
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const extent = members.length / (bw * bh);
    const formFactor = perimeter > 0 ? (4 * Math.PI * members.length) / (perimeter * perimeter) : 0;
    cells.push({
      id: count, area: members.length,
      cx: si > 0 ? sx / si : (x0 + x1) / 2,
      cy: si > 0 ? sy / si : (y0 + y1) / 2,
      mean: si / members.length,
      x0, y0, x1, y1,
      perimeter, extent,
      formFactor: Math.min(1, formFactor),
      aspect: Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)),
    });
  }
  return { w, h, labels, count, cells };
}

/** Look up the label id at a tile pixel (0 = background/outside). */
export function cellAt(table: CellTable, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= table.w || iy >= table.h) return 0;
  const v = table.labels[iy * table.w + ix]!;
  return v < 0 ? 0 : v;
}

/** Downsample a tile by integer block mean (viewer scales huge stores to a
 *  labeling tile; stats stay in tile pixels, areas scale by factor²). */
export function downsampleTile(tile: ArrayLike<number>, w: number, h: number, factor: number): { data: Float64Array; w: number; h: number } {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError(`cells-factor: ${factor}`);
  if (tile.length !== w * h) throw new RangeError(`cells-length: ${tile.length} vs ${w * h}`);
  const nw = Math.ceil(w / factor), nh = Math.ceil(h / factor);
  const out = new Float64Array(nw * nh);
  const cnt = new Float64Array(nw * nh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = Math.floor(y / factor) * nw + Math.floor(x / factor);
      out[k]! += tile[y * w + x]!;
      cnt[k]!++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i]! /= cnt[i]!;
  return { data: out, w: nw, h: nh };
}
