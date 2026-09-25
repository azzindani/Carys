// A synthetic CT study as a real DICOM series — one Part-10 file per slice,
// written with the repo's own writer.
//
//   node scripts/gen-ct-series.mjs   → samples/ct-head-series/ct-head-###.dcm
//
// Why this exists: the viewer's 3D surface is format-agnostic (it consumes a
// Float64Array + dims), but nothing in a fresh clone proved that, because every
// phantom was NIfTI. A multi-slice CT series exercises the whole DICOM lane —
// per-slice parse, sortSlices, stackToVolume, the rescale to Hounsfield — and
// lands in the same Volume the .nii path produces, so "3D from DICOM" is
// demonstrable rather than asserted.
//
// The pixels are stored as unsigned 16-bit with RescaleIntercept -1024, which
// is how real CT scanners store Hounsfield units. Reading it back must return
// the phantom's HU, not the stored values — that round trip is the point.
//
// Deterministic: same LCG seed and geometry as the NIfTI phantom, fixed UIDs,
// no timestamps. Rerunning yields byte-identical files. No patient data ever
// enters the repo (README privacy note).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePart10 } from '../packages/io/dist/dcm-write.js';
import { head } from './phantom.mjs';
import { samplesDir } from './samples-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(samplesDir(ROOT), 'ct-head-series');

// CT Image Storage. Fixed UID roots (2.25.* is the UUID-derived arc) keep the
// output byte-identical across runs; makeUID() embeds a timestamp and would not.
const CT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.2';
const STUDY_UID = '2.25.101010101010101010101010101010101';
const SERIES_UID = '2.25.202020202020202020202020202020202';
const sopUid = (i) => `2.25.3030303030303030303030303030${String(i).padStart(5, '0')}`;

const NX = 160, NY = 160, NZ = 120;
const PIXEL_SPACING = [1.1, 1.1];   // row, column (mm)
const SLICE_THICKNESS = 1.4;        // mm
const INTERCEPT = -1024;            // how scanners store HU unsigned

const { img } = head(NX, NY, NZ, 777);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`synthetic CT series → samples/ct-head-series/ (${NZ} slices, ${NX}x${NY})`);

let bytes = 0;
for (let z = 0; z < NZ; z++) {
  // stored = HU - intercept, clamped into uint16. Air (-1000 HU) stores as 24,
  // bone (~1100 HU) as ~2124 — the ordinary CT convention.
  const px = new Uint8Array(NX * NY * 2);
  const dv = new DataView(px.buffer);
  for (let i = 0; i < NX * NY; i++) {
    const hu = img[z * NX * NY + i];
    const stored = Math.max(0, Math.min(65535, Math.round(hu - INTERCEPT)));
    dv.setUint16(i * 2, stored, true);
  }
  const zPos = z * SLICE_THICKNESS;
  const ds = [
    { tag: [0x0008, 0x0016], vr: 'UI', value: CT_SOP_CLASS },
    { tag: [0x0008, 0x0018], vr: 'UI', value: sopUid(z) },
    { tag: [0x0008, 0x0060], vr: 'CS', value: 'CT' },
    { tag: [0x0008, 0x103e], vr: 'LO', value: 'Synthetic head phantom' },
    // Identity: a phantom, labelled as one. Nothing here is a person.
    { tag: [0x0010, 0x0010], vr: 'PN', value: 'PHANTOM^SYNTHETIC' },
    { tag: [0x0010, 0x0020], vr: 'LO', value: 'CARYS-PHANTOM-001' },
    { tag: [0x0020, 0x000d], vr: 'UI', value: STUDY_UID },
    { tag: [0x0020, 0x000e], vr: 'UI', value: SERIES_UID },
    { tag: [0x0020, 0x0011], vr: 'IS', value: '1' },
    { tag: [0x0020, 0x0013], vr: 'IS', value: String(z + 1) },
    // Axial, patient-aligned: LPS row/column direction cosines.
    { tag: [0x0020, 0x0032], vr: 'DS', value: `0\\0\\${zPos}` },
    { tag: [0x0020, 0x0037], vr: 'DS', value: '1\\0\\0\\0\\1\\0' },
    { tag: [0x0020, 0x1041], vr: 'DS', value: String(zPos) },
    { tag: [0x0018, 0x0050], vr: 'DS', value: String(SLICE_THICKNESS) },
    { tag: [0x0018, 0x0088], vr: 'DS', value: String(SLICE_THICKNESS) },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0028, 0x0010], vr: 'US', value: NY },
    { tag: [0x0028, 0x0011], vr: 'US', value: NX },
    { tag: [0x0028, 0x0030], vr: 'DS', value: `${PIXEL_SPACING[0]}\\${PIXEL_SPACING[1]}` },
    { tag: [0x0028, 0x0100], vr: 'US', value: 16 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 16 },
    { tag: [0x0028, 0x0102], vr: 'US', value: 15 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },   // unsigned
    // A bone window, so the series opens on the structure the 3D view finds.
    { tag: [0x0028, 0x1050], vr: 'DS', value: '300' },
    { tag: [0x0028, 0x1051], vr: 'DS', value: '1500' },
    { tag: [0x0028, 0x1052], vr: 'DS', value: String(INTERCEPT) },
    { tag: [0x0028, 0x1053], vr: 'DS', value: '1' },
    { tag: [0x7fe0, 0x0010], vr: 'OW', value: px },
  ];
  const buf = writePart10(CT_SOP_CLASS, sopUid(z), ds);
  writeFileSync(join(OUT, `ct-head-${String(z).padStart(3, '0')}.dcm`), Buffer.from(buf));
  bytes += buf.byteLength;
}

console.log(`  ${NZ} files, ${(bytes / 1e6).toFixed(1)} MB total`);
console.log(`  HU range in phantom: air -1000 … bone ~1200 (stored +${-INTERCEPT})`);
console.log('done — synthetic only, no patient data (README privacy note)');
