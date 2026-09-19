# Digest Group 11 — DICOM parse + NIfTI write receipts

## dicom-parse.ts (Daikon Parser/Series/Image pattern, native only)
- Preamble→meta(LE explicit)→dataset walker, implicit/explicit LE + explicit BE.
- Transfer-syntax gate: non-native UIDs throw `unsupported-transfer-syntax`;
  undefined-length pixel data throws `encapsulated-requires-decoder` (never misdecoded).
- Tags read: rows/cols/bits/rep/samples/frames/photometric/slope/intercept/
  window/instance/slice-location/seriesUID/IPP/IOP/spacing/thickness.
- interpret: 8/16-bit mask+sign+MONOCHROME1+slope → Int16Array + DicomSlice.
- Proven: 27/28 samples decode; abdomen_ct_01 removed (space-corrupted meta,
  unparseable by any conformant reader) with a synthetic replica as negative test.
- Stacking via filename prefix (synthetic seriesUIDs), dims asserted per series.

## nifti-write.ts (new, no upstream — inverse of nifti1.readHeader)
- 348B LE header, vox_offset=352, all 8 dtypes, pixdim from spacing,
  qform=sform=0 (METHOD 0 diag on re-read). Proven: per-dtype round-trip +
  skull-seg byte-identical data round-trip.
