// Port of Papaya Ruler/Angle/Ellipse + Cornerstone measurement tools.
// Pure functions over voxel coords + spacing; no DOM.
import type { Volume } from '@carys/volume-core';

type Pt3 = [number, number, number];

function dist(a: Pt3, b: Pt3, spacing: [number, number, number]): number {
  const dx = (a[0] - b[0]) * spacing[0];
  const dy = (a[1] - b[1]) * spacing[1];
  const dz = (a[2] - b[2]) * spacing[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function length(a: Pt3, b: Pt3, spacing: [number, number, number]): number {
  return dist(a, b, spacing);
}

export function angle(a: Pt3, vertex: Pt3, b: Pt3): number {
  const v1 = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
  const v2 = [b[0] - vertex[0], b[1] - vertex[1], b[2] - vertex[2]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2) || 1;
  const n2 = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2) || 1;
  return (Math.acos(Math.min(1, Math.max(-1, dot / (n1 * n2)))) * 180) / Math.PI;
}

/** Voxel-count volume of a binary mask in mm^3. */
export function maskVolume(mask: Uint8Array, vol: Volume): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  const [sx, sy, sz] = vol.spacing;
  return n * sx * sy * sz;
}

export interface MaskStats {
  voxels: number;
  volumeMm3: number;
  volumeCm3: number;
}

export function maskStats(mask: Uint8Array, vol: Volume): MaskStats {
  const mm3 = maskVolume(mask, vol);
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return { voxels: n, volumeMm3: mm3, volumeCm3: mm3 / 1000 };
}

/** One-row CSV of mask stats (the segment half of the Week-2 CSV exit). */
export function maskStatsToCSV(series: string, mask: Uint8Array, vol: Volume): string {
  const s = maskStats(mask, vol);
  const [sx, sy, sz] = vol.spacing;
  const cell = (v: string | number): string => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [
    ['series', 'voxels', 'volume_mm3', 'volume_cm3', 'spacing_x', 'spacing_y', 'spacing_z'].join(','),
    [series, s.voxels, s.volumeMm3, s.volumeCm3, sx, sy, sz].map(cell).join(','),
  ].join('\n') + '\n';
}

/** Frame-to-frame change summary (time slider diff vs baseline). */
export function frameDiff(
  a: ArrayLike<number>, b: ArrayLike<number>, threshold = 0,
): { meanAbs: number; maxAbs: number; changedFrac: number } {
  if (a.length !== b.length) throw new RangeError(`frame length mismatch ${a.length} vs ${b.length}`);
  let sum = 0, max = 0, changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] as number) - (b[i] as number));
    sum += d;
    if (d > max) max = d;
    if (d > threshold) changed++;
  }
  return { meanAbs: a.length ? sum / a.length : 0, maxAbs: max, changedFrac: a.length ? changed / a.length : 0 };
}

/** Intensity profile along a line (for profile-line tool). */
export function profileLine(vol: Volume, a: Pt3, b: Pt3, samples = 64): number[] {
  const out: number[] = [];
  const [nx, ny, nz] = vol.dims;
  for (let s = 0; s < samples; s++) {
    const t = samples === 1 ? 0 : s / (samples - 1);
    const x = Math.round(a[0] + (b[0] - a[0]) * t);
    const y = Math.round(a[1] + (b[1] - a[1]) * t);
    const z = Math.round(a[2] + (b[2] - a[2]) * t);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) {
      out.push(NaN);
    } else {
      out.push(vol.data[z * nx * ny + y * nx + x] as number);
    }
  }
  return out;
}
