# Digest Group 14 — clinical I/O receipts (DICOMweb, SEG/RT, gzip)

## DICOMweb (`packages/dicomweb`, 472 lines + 22 tests)
- QIDO-RS (study/series/instance search), WADO-RS retrieve (single + multipart),
  STOW-RS store. Pattern: forced `fetchFn` injection — no ambient fetch, so
  `test/e2e/pacs-verify.mjs` runs the client against a mock PACS end to end.
- `multipart/related` parser is exact-type strict; JSON model maps
  ModalitiesInStudy fallback + instance lists. Fuzz tests plant malformed
  boundaries, non-array QIDO payloads, special-character UIDs.
- Boundary: proven against the mock only — real-PACS quirks (QIDO paging,
  multipart variants) await an Orthanc digest.

## SEG + RTSTRUCT (`io/seg.ts`, `io/rtstruct.ts`, 8 tests in seg-rt.test.ts)
- SEG: bit-packed frame decode → per-segment masks (`segToMasks`); write path
  round-trips. RTSTRUCT: contour-sequence parse → marching-squares-equivalent
  stitch (undirected walk, disc dice 1.000) → `rtToMasks`.
- Part-10 codec (`dcm-read.ts`/`dcm-write.ts`): Explicit VR LE read/write,
  even-length padding, undefined-length SQ, megabyte OB without spread
  overflow (chunked `pushAll`, regression-tested).
- Uploads are content-sniffed (SOP UID), never extension-trusted; SEG/RTSTRUCT
  import as the editable mask with largest-segment-wins.

## NIfTI gzip (`io/nifti-gzip.ts`, 4 tests)
- fflate was a declared dependency that was never imported — every `.nii.gz`
  failed with a header error. Now: gunzip/gzip/decode + named `NiftiGzipError`,
  wired centrally in `loadNiiBuffer` so fetch + upload both accept `.gz`.
- Proven: byte-exact round-trip on all 8 dtypes + a real sample's header and
  pixels; corrupt input rejected by name.

## Compressed-DICOM boundary (dcm-codec.test.ts, assessed not faked)
- All 27 repo samples are uncompressed (18 Explicit LE + 9 Implicit LE), so no
  in-repo demand exists. A JPEG codec is thousands of lines; instead the
  boundary is pinned: a synthetically recompressed file (TS UID patched to
  JPEG Baseline at its measured offset, length field updated, value asserted
  first so the test fails loudly if the sample moves) throws
  `unsupported-transfer-syntax` as a `DicomParseError` before pixel decode.
- Encapsulated undefined-length pixels throw `encapsulated-requires-decoder`.
  Neither path can silently misdecode.

## Deliberately out
- JPEG/RLE pixel decoders, NIfTI-2, blosc/zstd zarr chunks, real-PACS
  conformance, PACS server internals (we are a client).
