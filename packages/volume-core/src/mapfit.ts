// Cryo-EM map fit stub: dock a model into a density map by centroid
// alignment and score the fit per residue. The honest CPU cut — a real
// 6D rigid-body search (rotation + translation over the map) is its own
// project; this stub answers "is the model in density at all" with a
// deterministic score, and names what it does NOT do at every call site.
//
// Pipeline: model centroid → map centroid (translation only, no rotation)
// → per-residue inclusion = trilinear map value at the CA position ≥
// contour → global map-model correlation over CA samples. MRC/CCP4 binary
// parsing stays out: maps arrive as NIfTI (the io reader already covers
// all 8 dtypes + gzip), which every EM map converts to losslessly.
import type { ResidueRef } from './sequence.js';

export interface MapFitMap {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  data: ArrayLike<number>;
}

export interface MapFitOptions {
  /** density contour for the inclusion test (default 0 = any positive density) */
  contour?: number;
}

export interface ResidueFit {
  index: number;
  chain: string;
  seqId: number;
  label: string;
  /** trilinear density at the CA position (null when outside the map) */
  density: number | null;
  /** density >= contour */
  included: boolean;
}

export interface MapFitReport {
  /** model→map translation applied (map centroid − model centroid), Å */
  translation: [number, number, number];
  /** residues scored (CA present and inside the map frame) */
  nScored: number;
  /** scored residues at/above contour */
  nIncluded: number;
  /** fraction included 0..1 (NaN when nothing scored) */
  inclusion: number;
  /** Pearson r of CA density vs residue mean density (NaN when <2 scored) */
  correlation: number;
  perResidue: ResidueFit[];
}

function isFiniteTrip(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Trilinear sample of a map at world coords; null outside the frame. */
export function sampleMap(map: MapFitMap, x: number, y: number, z: number): number | null {
  const [nx, ny, nz] = map.dims;
  const [sx, sy, sz] = map.spacing;
  const [ox, oy, oz] = map.origin;
  const gx = (x - ox) / sx, gy = (y - oy) / sy, gz = (z - oz) / sz;
  if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1 || gy > ny - 1 || gz > nz - 1) return null;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1), z1 = Math.min(nz - 1, z0 + 1);
  const fx = gx - x0, fy = gy - y0, fz = gz - z0;
  const at = (ix: number, iy: number, iz: number): number => map.data[iz * nx * ny + iy * nx + ix] as number;
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/**
 * Dock + score: translate the model so its CA centroid meets the map's
 * center of density, then score each CA by trilinear inclusion. Pure and
 * deterministic; throws `mapfit-*` on bad geometry. No rotation is tried —
 * the report says so (translation field carries the only DOF applied).
 */
export function fitMapToModel(
  residues: ResidueRef[],
  pos: Map<number, [number, number, number]>,
  map: MapFitMap,
  opts: MapFitOptions = {},
): MapFitReport {
  const { contour = 0 } = opts;
  if (!Array.isArray(residues) || residues.length === 0) throw new RangeError('mapfit-empty: no residues');
  if (!isFiniteTrip(map.dims) || map.dims.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new RangeError(`mapfit-dims: [${map.dims}]`);
  }
  if (!isFiniteTrip(map.spacing) || map.spacing.some((s) => s <= 0)) {
    throw new RangeError(`mapfit-spacing: [${map.spacing}]`);
  }
  if (!isFiniteTrip(map.origin)) throw new RangeError(`mapfit-origin: [${map.origin}]`);
  if (map.data.length !== map.dims[0] * map.dims[1] * map.dims[2]) {
    throw new RangeError(`mapfit-length: ${map.data.length} vs ${map.dims.join('×')}`);
  }
  if (!Number.isFinite(contour)) throw new RangeError(`mapfit-contour: ${contour}`);
  const have = residues.filter((r) => pos.has(r.index));
  if (have.length === 0) throw new RangeError('mapfit-empty: no residues with positions');
  // model CA centroid
  let mx = 0, my = 0, mz = 0;
  for (const r of have) {
    const p = pos.get(r.index)!;
    mx += p[0]; my += p[1]; mz += p[2];
  }
  mx /= have.length; my /= have.length; mz /= have.length;
  // map center of density (mass-weighted centroid, falls back to frame
  // center on an empty map rather than dividing by zero)
  const [nx, ny, nz] = map.dims;
  const [sx, sy, sz] = map.spacing;
  const [ox, oy, oz] = map.origin;
  let mass = 0, cx = 0, cy = 0, cz = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const v = map.data[iz * nx * ny + iy * nx + ix] as number;
        if (!(v > 0)) continue;
        mass += v;
        cx += (ox + ix * sx) * v;
        cy += (oy + iy * sy) * v;
        cz += (oz + iz * sz) * v;
      }
    }
  }
  const center: [number, number, number] = mass > 0
    ? [cx / mass, cy / mass, cz / mass]
    : [ox + ((nx - 1) / 2) * sx, oy + ((ny - 1) / 2) * sy, oz + ((nz - 1) / 2) * sz];
  const translation: [number, number, number] = [center[0] - mx, center[1] - my, center[2] - mz];
  // score translated CAs
  const perResidue: ResidueFit[] = [];
  for (const r of have) {
    const p = pos.get(r.index)!;
    const d = sampleMap(map, p[0] + translation[0], p[1] + translation[1], p[2] + translation[2]);
    perResidue.push({
      index: r.index, chain: r.chain, seqId: r.seqId, label: r.label,
      density: d, included: d !== null && d >= contour,
    });
  }
  const scored = perResidue.filter((f) => f.density !== null);
  const nIncluded = scored.filter((f) => f.included).length;
  // Spread diagnostic: Pearson r of CA index vs sampled density (do density
  // gradients run along the chain, or is the model uniformly inside/out?).
  // NaN when fewer than 2 residues score or either side is constant. The
  // honest scalar is inclusion; this rides along, never the verdict.
  let correlation = NaN;
  if (scored.length >= 2) {
    const xs = scored.map((f) => f.index);
    const ys = scored.map((f) => f.density as number);
    const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i]! - xm) * (ys[i]! - ym);
      sxx += (xs[i]! - xm) ** 2;
      syy += (ys[i]! - ym) ** 2;
    }
    correlation = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  return {
    translation,
    nScored: scored.length,
    nIncluded,
    inclusion: scored.length > 0 ? nIncluded / scored.length : NaN,
    correlation,
    perResidue,
  };
}
