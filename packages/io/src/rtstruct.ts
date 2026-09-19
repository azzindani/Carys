// RTSTRUCT (Sup 11) parse + write. Contours live in patient space;
// rasterization maps them onto caller geometry (nearest-slice z snap +
// even-odd scanline fill). Writer traces slice boundaries with marching
// squares, one CLOSED_PLANAR contour per island per slice.
import { readDataset, type Dataset } from './dcm-read.js';
import { makeUID, writePart10, type DcmElement, type DcmItem } from './dcm-write.js';

export const RTSTRUCT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.481.3';

export interface RTContour {
  roiNumber: number;
  z: number;
  points: [number, number][]; // voxel coords (fractional)
}

export interface RTStruct {
  rois: { number: number; name: string }[];
  contours: RTContour[];
}

export function parseRTSTRUCT(buffer: ArrayBuffer): RTStruct {
  const ds = readDataset(buffer);
  const sop = ds.text('00080016');
  if (sop !== RTSTRUCT_SOP_CLASS) throw new Error(`not an RTSTRUCT: ${sop}`);
  const roiNames = new Map<number, string>();
  for (const item of ds.sequence('30060020')) {
    const n = item.number('30060022');
    if (n != null) roiNames.set(n, item.text('30060026') ?? `ROI ${n}`);
  }
  const rois = [...roiNames.entries()].map(([number, name]) => ({ number, name }));
  const contours: RTContour[] = [];
  for (const roi of ds.sequence('30060039')) {
    const roiNumber = roi.number('30060084');
    if (roiNumber == null) continue;
    for (const c of roi.sequence('30060040')) {
      const type = (c.text('30060042') ?? '').trim().toUpperCase();
      if (type && type !== 'CLOSED_PLANAR') continue;
      const data = c.numbers('30060050');
      const nPts = c.number('30060046') ?? data.length / 3;
      const z = data[2] ?? 0;
      const pts: [number, number][] = [];
      for (let i = 0; i < nPts; i++) {
        pts.push([data[i * 3] ?? 0, data[i * 3 + 1] ?? 0]);
      }
      contours.push({ roiNumber, z, points: pts });
    }
  }
  return { rois, contours };
}

export interface RTGeometry {
  dims: [number, number, number];
  spacing?: [number, number, number];
  origin?: [number, number, number];
  sliceZs?: number[];
}

/** Rasterize contours to per-ROI masks (even-odd scanline fill). */
export function rtToMasks(rt: RTStruct, geo: RTGeometry): Map<number, Uint8Array> {
  const [nx, ny, nz] = geo.dims;
  const sp = geo.spacing ?? [1, 1, 1];
  const origin = geo.origin ?? [0, 0, 0];
  const sliceZs = geo.sliceZs ?? Array.from({ length: nz }, (_, i) => origin[2] + i * sp[2]);
  const masks = new Map<number, Uint8Array>();
  const key = (z: number): number => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < sliceZs.length; i++) {
      const d = Math.abs(sliceZs[i]! - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const bySlice = new Map<string, { roi: number; zi: number; loops: [number, number][][] }>();
  for (const c of rt.contours) {
    if (!masks.has(c.roiNumber)) masks.set(c.roiNumber, new Uint8Array(nx * ny * nz));
    const zi = key(c.z);
    const k = `${c.roiNumber}:${zi}`;
    let g = bySlice.get(k);
    if (!g) {
      g = { roi: c.roiNumber, zi, loops: [] };
      bySlice.set(k, g);
    }
    g.loops.push(c.points.map(([X, Y]) => [(X - origin[0]) / sp[0], (Y - origin[1]) / sp[1]]));
  }
  for (const g of bySlice.values()) {
    fillSoup(masks.get(g.roi)!, nx, ny, g.zi, g.loops);
  }
  return masks;
}

/**
 * Segment-soup scanline fill: collects crossings from every segment
 * (closed loops AND stray fragments) and fills even-odd pairs. Robust to
 * saddle-induced fragmentation that loop stitching cannot always resolve.
 */
function fillSoup(
  m: Uint8Array, nx: number, ny: number, z: number,
  loops: [number, number][][],
): void {
  const segs: [number, number, number, number][] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  if (segs.length === 0) return;
  let y0 = ny, y1 = -1;
  for (const [, ya, , yb] of segs) {
    y0 = Math.min(y0, Math.floor(Math.min(ya, yb)));
    y1 = Math.max(y1, Math.ceil(Math.max(ya, yb)));
  }
  y0 = Math.max(0, y0);
  y1 = Math.min(ny - 1, y1);
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (const [x1, y1v, x2, y2] of segs) {
      // half-open rule: shared vertices count exactly once, horizontals never
      if ((y1v <= y && y2 > y) || (y2 <= y && y1v > y)) {
        xs.push(x1 + ((y - y1v) / (y2 - y1v)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]!));
      const xb = Math.min(nx - 1, Math.floor(xs[k + 1]!));
      for (let x = xa; x <= xb; x++) m[z * nx * ny + y * nx + x] = 1;
    }
  }
}

interface Edge { x1: number; y1: number; x2: number; y2: number }

function traceContours(slice: Uint8Array, nx: number, ny: number): [number, number][][] {
  // Marching squares per cell edge; stitch segments into loops.
  const segs: Edge[] = [];
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= nx || y >= ny ? 0 : slice[y * nx + x]!;
  const lerp = (a: number, b: number): number => (0.5 - a) / (b - a || 1e-9);
  for (let y = -1; y <= ny; y++) {
    for (let x = -1; x <= nx; x++) {
      const v0 = at(x, y), v1 = at(x + 1, y), v2 = at(x + 1, y + 1), v3 = at(x, y + 1);
      const idx = (v0 ? 8 : 0) | (v1 ? 4 : 0) | (v2 ? 2 : 0) | (v3 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: Edge = { x1: x + lerp(v0, v1), y1: y, x2: 0, y2: 0 };
      const right: Edge = { x1: x + 1, y1: y + lerp(v1, v2), x2: 0, y2: 0 };
      const bottom: Edge = { x1: x + lerp(v3, v2), y1: y + 1, x2: 0, y2: 0 };
      const left: Edge = { x1: x, y1: y + lerp(v0, v3), x2: 0, y2: 0 };
      const link = (a: Edge, b: Edge): void => { segs.push({ x1: a.x1, y1: a.y1, x2: b.x1, y2: b.y1 }); };
      switch (idx) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 5: link(top, left); link(bottom, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 10: link(top, right); link(left, bottom); break;
      }
    }
  }
  // stitch: undirected walk — each segment is usable in EITHER direction,
  // because marching-squares cases emit boundary pieces whose traversal
  // direction is arbitrary (e.g. a corner-rounding piece may need to be
  // walked backward to continue the loop). A loop closes on its start point.
  const loops: [number, number][][] = [];
  const keyOf = (x: number, y: number): string => `${Math.round(x * 4)}:${Math.round(y * 4)}`;
  const pts: [number, number][][] = segs.map((s) => [[s.x1, s.y1], [s.x2, s.y2]]);
  const adj = new Map<string, number[]>();
  pts.forEach((p, i) => {
    for (const end of p) {
      const k = keyOf(end[0], end[1]);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push(i);
    }
  });
  const used = new Array<boolean>(pts.length).fill(false);
  const step = (fromKey: string): { idx: number; to: [number, number] } | undefined => {
    const q = adj.get(fromKey);
    if (!q) return undefined;
    for (const j of q) {
      if (used[j]) continue;
      const p = pts[j]!;
      const k0 = keyOf(p[0]![0], p[0]![1]);
      const k1 = keyOf(p[1]![0], p[1]![1]);
      // traverse away from fromKey (either endpoint may face us)
      if (k0 === fromKey) return { idx: j, to: p[1]! };
      if (k1 === fromKey) return { idx: j, to: p[0]! };
    }
    return undefined;
  };
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const start = pts[i]![0]!;
    const loop: [number, number][] = [start, pts[i]![1]!];
    // forward from the second endpoint
    for (;;) {
      const last = loop[loop.length - 1]!;
      if (keyOf(last[0], last[1]) === keyOf(start[0], start[1]) && loop.length > 2) break;
      const s = step(keyOf(last[0], last[1]));
      if (!s) break;
      used[s.idx] = true;
      loop.push(s.to);
      if (loop.length > pts.length + 2) break;
    }
    // backward from the start endpoint (prepend)
    for (;;) {
      const first = loop[0]!;
      const s = step(keyOf(first[0], first[1]));
      if (!s) break;
      used[s.idx] = true;
      loop.unshift(s.to);
      if (keyOf(s.to[0], s.to[1]) === keyOf(loop[loop.length - 1]![0], loop[loop.length - 1]![1])) break;
      if (loop.length > pts.length + 2) break;
    }
    // drop the duplicated closing point for a clean polygon
    const f = loop[0]!, l = loop[loop.length - 1]!;
    if (loop.length > 3 && keyOf(f[0], f[1]) === keyOf(l[0], l[1])) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export interface RTWriteOpts {
  rois: { name: string; mask: Uint8Array }[];
  dims: [number, number, number];
  spacing?: [number, number, number];
  origin?: [number, number, number];
  frameUID?: string;
  studyUID?: string;
  seriesUID?: string;
}

export function writeRTSTRUCT(opts: RTWriteOpts): ArrayBuffer {
  const [nx, ny, nz] = opts.dims;
  const sp = opts.spacing ?? [1, 1, 1];
  const origin = opts.origin ?? [0, 0, 0];
  const frameUID = opts.frameUID ?? makeUID();
  const studyUID = opts.studyUID ?? makeUID();
  const seriesUID = opts.seriesUID ?? makeUID();
  const sopUID = makeUID();
  const roiItems: DcmItem[] = opts.rois.map((r, i) => ({
    elements: [
      { tag: [0x3006, 0x0022], vr: 'IS', value: i + 1 },
      { tag: [0x3006, 0x0024], vr: 'UI', value: frameUID },
      { tag: [0x3006, 0x0026], vr: 'PN', value: r.name },
      { tag: [0x3006, 0x0036], vr: 'CS', value: 'MANUAL' },
    ],
  }));
  const contourItems: DcmItem[] = [];
  const obsItems: DcmItem[] = [];
  for (let ri = 0; ri < opts.rois.length; ri++) {
    const r = opts.rois[ri]!;
    const contours: { elements: DcmElement[] }[] = [];
    for (let z = 0; z < nz; z++) {
      const slice = r.mask.subarray(z * nx * ny, (z + 1) * nx * ny);
      let any = false;
      for (const v of slice) {
        if (v) { any = true; break; }
      }
      if (!any) continue;
      for (const loop of traceContours(slice, nx, ny)) {
        const flat: number[] = [];
        for (const [x, y] of loop) {
          flat.push(origin[0] + x * sp[0], origin[1] + y * sp[1], origin[2] + z * sp[2]);
        }
        contours.push({
          elements: [
            { tag: [0x3006, 0x0046], vr: 'IS', value: flat.length / 3 },
            { tag: [0x3006, 0x0042], vr: 'CS', value: 'CLOSED_PLANAR' },
            { tag: [0x3006, 0x0050], vr: 'DS', value: flat },
          ],
        });
      }
    }
    contourItems.push({
      elements: [
        { tag: [0x3006, 0x0084], vr: 'IS', value: ri + 1 },
        { tag: [0x3006, 0x0040], vr: 'SQ', value: contours },
      ],
    });
    obsItems.push({
      elements: [
        { tag: [0x3006, 0x0082], vr: 'IS', value: ri + 1 },
        { tag: [0x3006, 0x0084], vr: 'IS', value: ri + 1 },
        { tag: [0x3006, 0x00a4], vr: 'CS', value: 'ORGAN' },
        { tag: [0x3006, 0x00a6], vr: 'PN', value: '' },
      ],
    });
  }
  const dataset: DcmElement[] = [
    { tag: [0x0008, 0x0016], vr: 'UI', value: RTSTRUCT_SOP_CLASS },
    { tag: [0x0008, 0x0018], vr: 'UI', value: sopUID },
    { tag: [0x0020, 0x000d], vr: 'UI', value: studyUID },
    { tag: [0x0020, 0x000e], vr: 'UI', value: seriesUID },
    { tag: [0x3006, 0x0010], vr: 'SQ', value: [{
      elements: [
        { tag: [0x3006, 0x0012], vr: 'UI', value: frameUID },
        { tag: [0x3006, 0x0014], vr: 'UI', value: studyUID },
      ],
    }] },
    { tag: [0x3006, 0x0020], vr: 'SQ', value: roiItems },
    { tag: [0x3006, 0x0039], vr: 'SQ', value: contourItems },
    { tag: [0x3006, 0x0080], vr: 'SQ', value: obsItems },
  ];
  return writePart10(RTSTRUCT_SOP_CLASS, sopUID, dataset);
}

export function datasetOfRT(buffer: ArrayBuffer): Dataset {
  return readDataset(buffer);
}
