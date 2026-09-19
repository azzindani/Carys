// Mammography tomosynthesis helpers (PS3.3 C.8.21.3 BTO): SOP gate +
// stack-geometry resolvers. Pure: tables in, tables out. Digest: OHIF's
// sopClassDictionary (BTO + breast-projection UIDs) and cornerstone's
// calibrated-units idea (imager spacing as the fallback when file Pixel
// Spacing is absent); the WADO/image-loader layers cut, the CPU math kept.
// Implicit-VR region rows stay absent (dcm-read is explicit-only) — never
// an exception, just null.

export const BTO_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.13.1.3';
export const BREAST_PROJ_PRESENTATION_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.13.1.4';
export const BREAST_PROJ_PROCESSING_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.13.1.5';

export function isTomoSopClass(uid: string | null): boolean {
  return uid === BTO_SOP_CLASS
    || uid === BREAST_PROJ_PRESENTATION_SOP_CLASS
    || uid === BREAST_PROJ_PROCESSING_SOP_CLASS;
}

const positive = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0;

/**
 * In-plane spacing for a stack: file Pixel Spacing wins, Imager Pixel
 * Spacing (0018,1164) is the mammo fallback (BTO writers often omit
 * 0028,0030). Null when neither carries a positive pair — the caller
 * keeps unit spacing otherwise.
 */
export function stackPixelSpacing(meta: {
  pixelSpacing: [number, number] | null;
  imagerPixelSpacing: [number, number] | null;
}): [number, number] | null {
  const ps = meta.pixelSpacing;
  if (ps && positive(ps[0]) && positive(ps[1])) return ps;
  const im = meta.imagerPixelSpacing;
  if (im && positive(im[0]) && positive(im[1])) return im;
  return null;
}

/**
 * Slice interval for a stack: Spacing Between Slices (0018,0088) wins
 * (it IS the interval), Slice Thickness is the fallback, 1 mm the last
 * resort. Junk (zero/negative/NaN) never leaks through.
 */
export function stackZGap(meta: {
  sliceThickness: number | null;
  spacingBetweenSlices: number | null;
}): number {
  if (positive(meta.spacingBetweenSlices)) return meta.spacingBetweenSlices;
  if (positive(meta.sliceThickness)) return meta.sliceThickness;
  return 1;
}
