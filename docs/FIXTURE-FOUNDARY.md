# Fixture foundry (X2): the four-rung ladder

Every test pixel in this repo comes from exactly one of four rungs. Each
lane states which rung it proved on; higher rungs never silently replace
lower ones (bit-exact fixtures stay bit-exact).

## Rung 1 — hand-rolled bytes (minimal boundary cases)

Files: `packages/*/src/test/fixtures*.ts`, inline builders in
`dicom-compressed.test.ts` / `dicom-jpegls.test.ts` (`nativeFile`,
`encapFile`, `encapLs`, `rleEncodeFrame`, `encodeLossless`).

Use for: single-tag boundaries (odd lengths, truncated sequences, empty
BOT, bad offsets, corrupt PackBits, truncated JLS streams, deflated edge
cases). Small enough to read; every byte intentional.

## Rung 1b — synthetic preview volumes (`scripts/gen-phantom.mjs`)

Script: `node scripts/gen-phantom.mjs`. Output: `samples/*.nii` (gitignored).

`samples/` holds real study data and is gitignored, so a fresh clone has
nothing to render and no way to drive or demo the UI. This writes head
phantoms through the repo's own `writeNifti1` — skull, grey/white brain,
paired ventricles and one enhancing lesion, at real Hounsfield values so the
stock window/level presets land on actual contrast. The lesion sits at the
depth `axialFrac` opens on, so the mask overlay is on screen at load.

Deterministic (fixed LCG seed, fixed geometry, no timestamps): rerunning
yields byte-identical files. Synthetic only — no patient data enters the
repo (README privacy note).

Use for: previewing and demoing the viewer, and driving UI work that needs a
volume. NOT a substitute for rung 3/4 data: golden-hash and real-archive
geometry tests still need the actual samples. With phantoms alone the unit
suite goes from 650/26 to 654/22 — the four tests that only needed a valid
NIfTI to exist.

## Rung 2 — pydicom-generated (T2 foundry, TOOLING)

Script: `test/e2e/foundry.py` (`npm run gen:foundry`). Output:
`test/e2e/foundry/*.dcm` (8 files: ct-explicit, ct-implicit, ct-deflated,
us-regions, bto-stack, jls-lossless, rle-lossless, phantom-qc).

Use for: breadth hand-rolling cannot cover cheaply (implicit VR, deflated
TS, US region sequences, BTO geometry, real CharLS streams, hand-packed
RLE frames, rescale phantoms). Deterministic: fixed UIDs
(`1.2.826.0.1.999999.2.*`), fixed pixels, no timestamps — regenerating
yields byte-identical files. TOOLING only: never imported by `packages/`.

Known encoder gaps (documented, not hidden): pydicom/imagecodecs have no
RLE encoder (RLE frame hand-packed in `gen_rle_lossless`); JPEG-2000 has
no encoder here (stays out).

## Rung 3 — pinned public data (D1–D6 digests)

Dirs: `digests/*` + `DIGESTS.json` registry (X1). Each digest carries
`SOURCES.json` (source URL, retrieval date, SPDX, version pin, entry
count); the license-CI gate walks the registry.

Use for: real-archive geometry (BodyParts3D meshes, PDB structures, SPL
brain labels, IDR screens). Vendored bytes are pinned by hash/count
tests; remote pixels stay remote (IDR zarr mirrors, SPL label volume).

## Rung 4 — live-server conformance (R4, future)

Target: Orthanc sidecar (docker) for DICOMweb QIDO/WADO/STOW conformance
beyond the mock PACS (`pacs-verify.mjs` pattern extended to a real
server). Blocked: AGPL sidecar needs a human license confirmation +
docker host. Never shipped.

## Cross-validation (R3): the rungs check each other

`npm run xval` reads every `samples/*.dcm` + every foundry file with BOTH
pydicom and our parser and fails loudly on tag/geometry disagreement
(current: 34/36 agree; 2 documented scale notes — pydicom reports
encapsulated bytes/bitsStored, we report decoded pixels/bits — plus 1
odd-length injection both sides reject, each in its own named way).
