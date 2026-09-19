# Digest Group 16 — dcmjs VR tables (first new-repo digest)

## dcmjs (dcmjs-org/dcmjs) — surveyed `src/ValueRepresentation.js` (1,577 lines)
- VR as behavior, not labels: `binaryVRs` (no string splitting/multiplicity),
  `length32VRs` (32-bit length encoding), `singleVRs` (never multiple), plus
  the 31-entry `VRinstances` code list. Skipped: read/write paths, dictionary
  data files, anonymizer, normalizers, SEG derivations (all app-shaped, and
  our SEG/codec paths are already proven).

## Ported: `io/dicom-vr.ts` (single source of truth)
- dcmjs tables ported exactly, plus OL/OV (standard additions dcmjs predates
  that our reader/writer already carried). SV stays out exactly as in dcmjs;
  unknown VRs keep the Daikon implicit fallback. Helpers: `isLength32VR`,
  `isBinaryVR`, `allowsMultipleVR` (dcmjs rule), `isKnownVR`.

## Bug it fixed (latent misparse, no sample hit it)
- Three divergent LONG_VRS copies existed; `dicom-parse.ts` (the file
  decoder) lacked OD/OL/OV/UR/UV, so Explicit-VR elements with those VRs read
  the 16-bit length at p+6 — which is the reserved 0000 — and silently
  truncated the value to zero length. `dcm-read.ts`/`dcm-write.ts` agreed on
  the fuller set; all three now import one table.
- Proven: synthetic Explicit-LE buffer with OD (16 payload bytes) + UR
  elements walks to exact value lengths and bytes; writer emits 12-byte OD
  headers and the reader round-trips them. Dead `BINARY_VRS` set in
  dicom-parse (defined, never referenced) removed in passing.

## Deliberately out
- Full dcmjs read/write/normalize stack, data-dictionary files, anonymizer
  port (ours is proven), SEG derivation helpers, JPEG codecs, SV membership
  claim (left exactly where dcmjs leaves it).
