// Content sniffs and SOP Class constants: what a viewer needs to route a
// file before it decodes one. Dependency-free on purpose — a bundle that
// imports only these must not pull in the parsers they route to (a module
// reached for one constant lands in the entry chunk whole).

/** Content sniff: NRRD magic line (any 0001-0005 version). */
export function isNrrdLike(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return /^NRRD000[1-5]/.test(new TextDecoder().decode(bytes.slice(0, 8)));
}

/** Content sniff: TIFF magic (any OME-TIFF is a TIFF). */
export function isTiffLike(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!le && !be) return false;
  const v = le ? bytes[2]! | (bytes[3]! << 8) : (bytes[2]! << 8) | bytes[3]!;
  return v === 42;
}

/** DICOM Segmentation Storage (Sup 58). */
export const SEG_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.66.4';

/** RT Structure Set Storage (Sup 11). */
export const RTSTRUCT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.481.3';
