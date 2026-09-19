// Enhanced multi-frame geometry (PS3.3 C.7.6.16): Shared Functional Groups
// (52009229, one item) hold geometry common to all frames; Per-Frame
// Functional Groups (52009230, one item per frame) override per frame. Each
// item nests Plane Position (00209113: IPP 00200032), Plane Orientation
// (00209116: IOP 00200037) and Frame Content (00209111: DimensionIndexValues
// 00209157) sequences. The Walker skips sequences, so this re-reads the
// (already inflated) buffer with the repo's own dataset reader; if that
// reader cannot handle the file the groups stay absent and every frame keeps
// file-level geometry (never a pixel-path failure).
import { readDataset, type Dataset } from './dcm-read.js';

export interface FunctionalGroups {
  shared: Dataset | null;
  perFrame: Dataset[];
}

export function readFunctionalGroups(buffer: ArrayBuffer): FunctionalGroups {
  try {
    const ds = readDataset(buffer);
    return { shared: ds.sequence('52009229')[0] ?? null, perFrame: ds.sequence('52009230') };
  } catch {
    return { shared: null, perFrame: [] };
  }
}

export interface GroupGeometry {
  ipp: [number, number, number] | null;
  iop: [number, number, number, number, number, number] | null;
  dimensionIndexValues: number[];
  pixelSpacing: [number, number] | null;
  sliceThickness: number | null;
}

/** Geometry of one shared/per-frame item (null item = all absent). */
export function groupGeometry(item: Dataset | null): GroupGeometry {
  const none: GroupGeometry = { ipp: null, iop: null, dimensionIndexValues: [], pixelSpacing: null, sliceThickness: null };
  if (!item) return none;
  const pos = item.sequence('00209113')[0]?.numbers('00200032') ?? [];
  const ori = item.sequence('00209116')[0]?.numbers('00200037') ?? [];
  const div = item.sequence('00209111')[0]?.numbers('00209157') ?? [];
  const meas = item.sequence('00289110')[0];
  const ps = meas?.numbers('00280030') ?? [];
  const st = meas?.numbers('00180050') ?? [];
  return {
    ipp: pos.length >= 3 ? [pos[0]!, pos[1]!, pos[2]!] : null,
    iop: ori.length >= 6 ? [ori[0]!, ori[1]!, ori[2]!, ori[3]!, ori[4]!, ori[5]!] : null,
    dimensionIndexValues: div,
    pixelSpacing: ps.length >= 2 ? [ps[0]!, ps[1]!] : null,
    sliceThickness: st.length > 0 ? st[0]! : null,
  };
}
