// DICOM Value Representation tables, ported from dcmjs
// src/ValueRepresentation.js (MIT): binaryVRs / length32VRs / singleVRs and
// the VRinstances code list. dcmjs predates OL/OV (standard additions our
// reader/writer already carried), so the length-32 set is the union.
// SV is absent here exactly as in dcmjs; unknown VRs keep the Daikon
// implicit fallback in dicom-parse.ts. Single source of truth: dcm-read,
// dcm-write and dicom-parse all import from here (three divergent copies
// collapsed — dicom-parse's copy was missing OD/OL/OV/UR/UV and misparsed
// Explicit-VR elements with those VRs as 16-bit lengths).

/** 32-bit value-length encoding in Explicit VR (dcmjs length32VRs + OL/OV). */
export const VR_LENGTH32: ReadonlySet<string> = new Set([
  'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN', 'UV',
]);

/** Binary VRs: no string splitting, no multiplicity (dcmjs binaryVRs). */
export const VR_BINARY: ReadonlySet<string> = new Set([
  'FL', 'FD', 'SL', 'SS', 'UL', 'US', 'AT', 'UV',
]);

/** VRs that never carry multiple values (dcmjs singleVRs). */
export const VR_SINGLE: ReadonlySet<string> = new Set([
  'SQ', 'OF', 'OW', 'OB', 'UN',
]);

/** Every VR dcmjs instantiates, plus OL/OV. */
export const KNOWN_VR: ReadonlySet<string> = new Set([
  'AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FL', 'FD', 'IS', 'LO', 'LT',
  'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST',
  'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV',
]);

export function isLength32VR(vr: string): boolean {
  return VR_LENGTH32.has(vr);
}

export function isBinaryVR(vr: string): boolean {
  return VR_BINARY.has(vr);
}

/** dcmjs rule: multiple values iff not binary and not single. */
export function allowsMultipleVR(vr: string): boolean {
  return !VR_BINARY.has(vr) && !VR_SINGLE.has(vr);
}

export function isKnownVR(vr: string): boolean {
  return KNOWN_VR.has(vr);
}
