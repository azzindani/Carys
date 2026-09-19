// 5D TCZYX selection over decoded OME-TIFF planes + OME-XML physical
// sizes + napari-studied axis-order audit. The planes already exist
// (parseOmeTiff); this file only answers "which plane is (t, c, z)",
// "how big is a pixel", and "is this file's axis order napari-clean".
// Pure, no DOM.
//
// napari-studied (REFERENCE, BSD-3-Clause, LICENSE verified 2026-09-18
// from the live repo file): napari reads OME-TIFF in tzyx order with the
// channel axis last. The audit checks a decoded file against that
// contract — DimensionOrder present and parseable, every plane carrying
// an explicit (t, c, z) (no C-walk fallback), sizes consistent — and
// reports the findings as data, never a pass/fail claim about biology.
import type { OmeTiffMeta, OmeTiffPlane } from './ome-tiff.js';

export interface Ome5DIndex { t: number; c: number; z: number; }

/** Clamp a (t, c, z) request into the decoded planes; throws when empty. */
export function selectPlane(
  meta: OmeTiffMeta | null, planes: OmeTiffPlane[], want: Partial<Ome5DIndex>,
): { plane: OmeTiffPlane; index: Ome5DIndex } {
  if (planes.length === 0) throw new Error('ome-5d-empty: no decoded planes');
  const maxT = Math.max(...planes.map((p) => p.t));
  const maxC = Math.max(...planes.map((p) => p.c));
  const maxZ = Math.max(...planes.map((p) => p.z));
  const index: Ome5DIndex = {
    t: Math.max(0, Math.min(maxT, Math.floor(want.t ?? (meta?.planes[0]?.t ?? 0)))),
    c: Math.max(0, Math.min(maxC, Math.floor(want.c ?? (meta?.planes[0]?.c ?? 0)))),
    z: Math.max(0, Math.min(maxZ, Math.floor(want.z ?? (meta?.planes[0]?.z ?? 0)))),
  };
  const plane = planes.find((p) => p.t === index.t && p.c === index.c && p.z === index.z)
    ?? planes.reduce((best, p) =>
      Math.abs(p.t - index.t) + Math.abs(p.c - index.c) + Math.abs(p.z - index.z)
      < Math.abs(best.t - index.t) + Math.abs(best.c - index.c) + Math.abs(best.z - index.z) ? p : best);
  return { plane: plane!, index: { t: plane!.t, c: plane!.c, z: plane!.z } };
}

/** Extent of each 5D axis over the decoded planes (inclusive maxima + 1). */
export function planeExtents(planes: OmeTiffPlane[]): { sizeT: number; sizeC: number; sizeZ: number } {
  if (planes.length === 0) return { sizeT: 0, sizeC: 0, sizeZ: 0 };
  return {
    sizeT: Math.max(...planes.map((p) => p.t)) + 1,
    sizeC: Math.max(...planes.map((p) => p.c)) + 1,
    sizeZ: Math.max(...planes.map((p) => p.z)) + 1,
  };
}

/** One axis-order finding: which check spoke and what it saw. */
export interface AxisOrderFinding {
  check: 'dimension-order' | 'explicit-planes' | 'size-consistency';
  ok: boolean;
  detail: string;
}

/**
 * Audit a decoded OME-TIFF against napari's axis-order contract. Three
 * checks: (1) DimensionOrder present and shaped like XY + {C,Z,T};
 * (2) every decoded plane carries explicit (t,c,z) — i.e. no C-walk
 * fallback ran (the caller passes whether the XML had First* attrs; the
 * planes alone cannot tell); (3) decoded counts fit SizeC×SizeZ×SizeT.
 * Findings are data for the caller to render — never a verdict here.
 */
export function auditAxisOrder(
  meta: OmeTiffMeta | null,
  planes: OmeTiffPlane[],
  opts: { explicitPlanes?: boolean } = {},
): AxisOrderFinding[] {
  const out: AxisOrderFinding[] = [];
  const order = meta?.dimensionOrder ?? '';
  const shapeOk = /^[XYZ]{2,3}[CZT]{3}$/.test(order.toUpperCase());
  out.push({
    check: 'dimension-order',
    ok: shapeOk,
    detail: shapeOk ? `DimensionOrder ${order}` : `DimensionOrder ${JSON.stringify(order)} unreadable or absent`,
  });
  const explicit = opts.explicitPlanes ?? false;
  out.push({
    check: 'explicit-planes',
    ok: explicit,
    detail: explicit ? `${planes.length} planes carry explicit (t,c,z)` : 'planes walked the C default (no First* attrs)',
  });
  const want = (meta?.sizeC ?? 0) * (meta?.sizeZ ?? 0) * (meta?.sizeT ?? 0);
  const countOk = planes.length > 0 && (want <= 0 || planes.length <= want);
  out.push({
    check: 'size-consistency',
    ok: countOk,
    detail: countOk
      ? `${planes.length} decoded planes fit SizeC×SizeZ×SizeT=${want}`
      : `${planes.length} planes exceed SizeC×SizeZ×SizeT=${want}`,
  });
  return out;
}

/**
 * Physical pixel sizes (µm) from OME-XML Pixels attributes. Missing or
 * non-positive values degrade to null (unknown) — never guessed, never 1.
 */
export function physicalSizes(xml: string): {
  sizeX: number | null; sizeY: number | null; sizeZ: number | null;
} {
  const num = (name: string): number | null => {
    const m = xml.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    if (!m) return null;
    const v = Number.parseFloat(m[1]!);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  return { sizeX: num('PhysicalSizeX'), sizeY: num('PhysicalSizeY'), sizeZ: num('PhysicalSizeZ') };
}
