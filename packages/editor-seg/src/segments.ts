// Ported from VolView store/segmentGroups.ts labelmap conventions.
// Uint8 labelmap, 0 = background; segments {order, byValue}; SEG -> .seg.nrrd
// enumeration fallback noted for Week 3. No VTK.

import type { Volume } from '@carys/volume-core';

export interface Segment {
  value: number;
  label: string;
  visible: boolean;
  locked: boolean;
}

export interface SegmentGroup {
  id: string;
  parentImageID: string;
  labelmap: Uint8Array;
  dims: [number, number, number];
  segments: { order: number[]; byValue: Record<number, Segment> };
}

export function createLabelmapFromVolume(vol: Volume): Uint8Array {
  return new Uint8Array(vol.dims[0] * vol.dims[1] * vol.dims[2]);
}

export function toLabelMap(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 1 : 0;
  return out;
}

export function replaceLabelValue(
  labelmap: Uint8Array,
  from: number,
  to: number,
): void {
  for (let i = 0; i < labelmap.length; i++) {
    if (labelmap[i] === from) labelmap[i] = to;
  }
}
