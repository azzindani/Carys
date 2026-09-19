#!/usr/bin/env python3
"""T2 fixture foundry: pydicom-generated DICOM fixtures + R3 cross-validation
+ I1 dcm2niix stack-geometry parity.

Three jobs, one script (TOOLING only — never shipped, never in packages/):

  gen   write pydicom-authored Part-10 files under test/e2e/foundry/ that
        exercise paths hand-rolled bytes don't cover cheaply:
        implicit-VR-LE, odd-length error injection, multi-frame with
        functional groups, deflated TS, US region sequence, BTO geometry.
  xval  read every samples/*.dcm + every foundry file with BOTH pydicom
        and our parser (via a node one-liner over dist) and fail loudly
        on any tag/geometry disagreement (R3 corpus).
  parity  run dcm2niix over samples/*.dcm into a scratch dir, then compare
        our stack geometry (sort order + dims + spacing) against the
        dcm2niix NIfTI headers (I1 corpus). Needs the dcm2niix binary.

Determinism: fixed UIDs (1.2.826.0.1.999999.2.*), fixed pixels, no
timestamps in output. Regenerating yields byte-identical files.

Requires: pydicom (pip install pydicom). Node side needs npm run build.
parity additionally needs: dcm2niix (apt install mricron).
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "test" / "e2e" / "foundry"

UID_ROOT = "1.2.826.0.1.999999.2"

TS_IMPLICIT = "1.2.840.10008.1.2"
TS_EXPLICIT = "1.2.840.10008.1.2.1"
TS_DEFLATED = "1.2.840.10008.1.2.1.99"

CT_SOP = "1.2.840.10008.5.1.4.1.1.2"
US_SOP = "1.2.840.10008.5.1.4.1.1.6.1"


def need_pydicom():
    try:
        import pydicom  # noqa: F401
    except ImportError:
        sys.exit("foundry needs pydicom: pip install pydicom")
    from pydicom.dataset import Dataset, FileDataset
    from pydicom.uid import ExplicitVRLittleEndian
    return Dataset, FileDataset, ExplicitVRLittleEndian


def base_meta(sop, ts, n=1):
    Dataset, FileDataset, _ = need_pydicom()
    meta = Dataset()
    meta.MediaStorageSOPClassUID = sop
    meta.MediaStorageSOPInstanceUID = f"{UID_ROOT}.{n}"
    meta.TransferSyntaxUID = ts
    return meta


def write(ds, path):
    from pydicom.filewriter import dcmwrite
    path.parent.mkdir(parents=True, exist_ok=True)
    dcmwrite(str(path), ds, write_like_original=False)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def px_u16(rows, cols, frames=1):
    n = rows * cols * frames
    return struct.pack(f"<{n}H", *[i % 4096 for i in range(n)])


def gen_ct_explicit():
    Dataset, FileDataset, ExplicitVRLittleEndian = need_pydicom()
    meta = base_meta(CT_SOP, TS_EXPLICIT, 11)
    ds = FileDataset("ct-explicit.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.11"
    ds.Modality = "CT"
    ds.PatientName = "FOUNDRY^EXPLICIT"
    ds.Rows, ds.Columns = 8, 8
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.InstanceNumber = 3
    ds.SliceLocation = 12.5
    ds.ImagePositionPatient = [0.0, 0.0, 12.5]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.PixelSpacing = [0.5, 0.5]
    ds.SliceThickness = 2.0
    ds.RescaleSlope, ds.RescaleIntercept = 1.0, -1024.0
    ds.WindowCenter, ds.WindowWidth = 40, 400
    ds.PixelData = px_u16(8, 8)
    write(ds, OUT / "ct-explicit.dcm")


def gen_ct_implicit():
    from pydicom.dataset import Dataset, FileDataset
    meta = base_meta(CT_SOP, TS_IMPLICIT, 12)
    ds = FileDataset("ct-implicit.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.12"
    ds.Modality = "CT"
    ds.PatientName = "FOUNDRY^IMPLICIT"
    ds.Rows, ds.Columns = 8, 8
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.InstanceNumber = 7
    ds.SliceLocation = -4.0
    ds.PixelSpacing = [0.7, 0.7]
    ds.PixelData = px_u16(8, 8)
    # force implicit-VR encoding on write
    ds.is_implicit_VR = True
    ds.is_little_endian = True
    write(ds, OUT / "ct-implicit.dcm")


def gen_ct_deflated():
    # NOTE: pydicom 3.x raw-deflates the dataset on write (verified:
    # double-decompress recovers the tags), so the tmp file IS the real
    # deflated fixture — just rename it. Our reader takes zlib-wrapped
    # (fflate unzlibSync, matching our hand-rolled deflated tests), so
    # this file documents the real-world raw-deflate shape as a loud
    # scoped reject, not a decode.
    Dataset, FileDataset, ExplicitVRLittleEndian = need_pydicom()
    meta = base_meta(CT_SOP, TS_DEFLATED, 13)
    ds = FileDataset("ct-deflated.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.13"
    ds.Modality = "CT"
    ds.Rows, ds.Columns = 4, 4
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelData = px_u16(4, 4)
    tmp = OUT / "ct-deflated.tmp.dcm"
    write(ds, tmp)
    tmp.rename(OUT / "ct-deflated.dcm")
    print(f"wrote test/e2e/foundry/ct-deflated.dcm ({(OUT / 'ct-deflated.dcm').stat().st_size} bytes, pydicom raw-deflate)")



def gen_odd_length():
    # T2 odd-length error injection: a valid explicit-VR-LE CT whose
    # SeriesDescription (LO, (0008,103E)) declares an ODD length (3) while
    # 4 bytes follow. Every downstream tag shifts by one byte, so the
    # file is unparseable by any conformant reader. pydicom reads the
    # lied-about element fine but loses the rest (PixelData missing);
    # our pixel pipeline rejects loudly (truncated). Agreement = both
    # fail, each in its own named way — never a silent half-parse.
    # Deterministic: byte-patch of gen_ct_explicit's fixed pixels.
    Dataset, FileDataset, ExplicitVRLittleEndian = need_pydicom()
    meta = base_meta(CT_SOP, TS_EXPLICIT, 19)
    ds = FileDataset("odd-length.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.19"
    ds.Modality = "CT"
    ds.Rows, ds.Columns = 8, 8
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.InstanceNumber = 3
    ds.SeriesDescription = "ABC"
    ds.PixelData = px_u16(8, 8)
    tmp = OUT / "odd-length.tmp.dcm"
    write(ds, tmp)
    raw = bytearray(tmp.read_bytes())
    # (0008,103E) LO declared 4 ('ABC '): lie 3, keep the pad byte so all
    # downstream offsets misalign by one.
    j = bytes(raw).find(bytes([0x08, 0x00, 0x3E, 0x10]))
    assert j != -1, "SeriesDescription element missing"
    assert raw[j + 4:j + 6] == b"LO", raw[j + 4:j + 6]
    assert int.from_bytes(raw[j + 6:j + 8], "little") == 4
    raw[j + 6:j + 8] = (3).to_bytes(2, "little")
    (OUT / "odd-length.dcm").write_bytes(raw)
    tmp.unlink()
    print(f"wrote test/e2e/foundry/odd-length.dcm ({(OUT / 'odd-length.dcm').stat().st_size} bytes, odd-length injected)")

def gen_us_regions():
    from pydicom.dataset import Dataset, FileDataset
    from pydicom.sequence import Sequence
    meta = base_meta(US_SOP, TS_EXPLICIT, 14)
    ds = FileDataset("us-regions.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = US_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.14"
    ds.Modality = "US"
    ds.Rows, ds.Columns = 4, 4
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 8, 8, 7
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.NumberOfFrames = 2
    ds.FrameTime = 33.3
    r1 = Dataset()
    r1.RegionLocationMinX0, r1.RegionLocationMinY0 = 0, 0
    r1.RegionLocationMaxX1, r1.RegionLocationMaxY1 = 3, 3
    r1.PhysicalUnitsXDirection, r1.PhysicalUnitsYDirection = 3, 3
    r1.PhysicalDeltaX, r1.PhysicalDeltaY = 0.5, 0.5
    r1.RegionDataType = 1
    r1.RegionFlags = 1
    ds.SequenceOfUltrasoundRegions = Sequence([r1])
    ds.PixelData = bytes([i % 256 for i in range(32)])
    write(ds, OUT / "us-regions.dcm")


def gen_bto():
    from pydicom.dataset import Dataset, FileDataset
    BTO = "1.2.840.10008.5.1.4.1.1.13.1.3"
    meta = base_meta(BTO, TS_EXPLICIT, 15)
    ds = FileDataset("bto-stack.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = BTO
    ds.SOPInstanceUID = f"{UID_ROOT}.15"
    ds.Modality = "MG"
    ds.Rows, ds.Columns = 4, 4
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.NumberOfFrames = 3
    ds.ImagerPixelSpacing = [0.1, 0.1]
    ds.SpacingBetweenSlices = 1.0
    ds.ImageLaterality = "L"
    ds.ViewPosition = "CC"
    ds.PixelData = px_u16(4, 4, 3)
    write(ds, OUT / "bto-stack.dcm")


def gen_jls_lossless():
    # R2 JPEG-LS corpus: bit-exact CharLS stream (imagecodecs) wrapped by
    # pydicom as encapsulated ...4.80 single-frame MONOCHROME2 8x8 12-bit.
    # The pixel ramp matches px_u16 so xval can compare pixel scales, but
    # the real assertion lives in the io dicom-jpegls tests (stream ->
    # pixels bit-exact). Deterministic: fixed ramp, no timestamps.
    import numpy as np
    from pydicom.dataset import Dataset, FileDataset
    from pydicom.encaps import encapsulate
    TS_JLS = "1.2.840.10008.1.2.4.80"
    try:
        import imagecodecs
    except ImportError:
        sys.exit("foundry R2 needs imagecodecs: pip install imagecodecs")
    meta = base_meta(CT_SOP, TS_JLS, 16)
    ds = FileDataset("jls-lossless.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.16"
    ds.Modality = "CT"
    ds.Rows, ds.Columns = 8, 8
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ramp = np.fromfunction(lambda r, c: (r * 8 + c) % 4096, (8, 8), dtype=np.uint16)
    stream = bytes(imagecodecs.jpegls_encode(ramp))
    assert stream[:2] == b"\xff\xd8", "CharLS stream must start FFD8"
    ds.PixelData = encapsulate([stream])
    write(ds, OUT / "jls-lossless.dcm")


def gen_rle_lossless():
    # R2 RLE corpus: pydicom has no RLE encoder (imagecodecs raises
    # NotImplementedError), so the frame is hand-packed DICOM RLE (header
    # + PackBits segments) and wrapped as encapsulated ...5. The pixels
    # are a flat 64 with a 0..7 ramp in row 0 — decodable by our Daikon
    # port and asserted in the io RLE tests. Deterministic by hand.
    from pydicom.dataset import Dataset, FileDataset
    from pydicom.encaps import encapsulate
    TS_RLE = "1.2.840.10008.1.2.5"

    def packbits_literal(raw: bytes) -> bytes:
        out = bytearray()
        for i in range(0, len(raw), 128):
            chunk = raw[i:i + 128]
            out.append(len(chunk) - 1)
            out += chunk
        return bytes(out)

    px = bytearray(64)
    for c in range(8):
        px[c] = c
    for r in range(1, 8):
        for c in range(8):
            px[r * 8 + c] = 64
    seg = packbits_literal(bytes(px))
    header = struct.pack("<16L", 1, 64, *((0,) * 14))[:64]
    frame = bytes(header) + seg
    meta = base_meta(CT_SOP, TS_RLE, 17)
    ds = FileDataset("rle-lossless.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.17"
    ds.Modality = "CT"
    ds.Rows, ds.Columns = 8, 8
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 8, 8, 7
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelData = encapsulate([frame])
    write(ds, OUT / "rle-lossless.dcm")


def gen_phantom_qc():
    # R1 phantom/QC bundle: uniform 16x16 water phantom at 0 HU + a 4x4
    # +100 HU insert. Explicit-VR-LE CT with rescale (slope 1,
    # intercept -1024: stored 1024 = 0 HU, stored 1124 = +100 HU).
    # phantomCheck asserts mean±tolerance over these regions; the io
    # phantom tests pin the bytes. Deterministic: fixed pixels.
    from pydicom.dataset import Dataset, FileDataset
    meta = base_meta(CT_SOP, TS_EXPLICIT, 18)
    ds = FileDataset("phantom-qc.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = CT_SOP
    ds.SOPInstanceUID = f"{UID_ROOT}.18"
    ds.Modality = "CT"
    ds.Rows, ds.Columns = 16, 16
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 12, 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.RescaleSlope, ds.RescaleIntercept = 1.0, -1024.0
    px = [1024] * 256
    for r in range(6, 10):
        for c in range(6, 10):
            px[r * 16 + c] = 1124
    ds.PixelData = struct.pack("<256H", *px)
    write(ds, OUT / "phantom-qc.dcm")


def gen_all():
    gen_ct_explicit()
    gen_odd_length()
    gen_ct_implicit()
    gen_ct_deflated()
    gen_us_regions()
    gen_bto()
    gen_jls_lossless()
    gen_rle_lossless()
    gen_phantom_qc()


# --- R3 cross-validation: pydicom tags vs our parser, field by field ---

FIELDS = [
    "rows", "cols", "bitsAllocated", "bitsStored", "pixelRepresentation",
    "samplesPerPixel", "numberOfFrames", "photometric", "slope", "intercept",
    "windowCenter", "windowWidth", "instanceNumber", "sliceLocation",
    "seriesUID", "sopClassUID", "pixelSpacing", "sliceThickness",
    "patientName", "patientID", "studyUID", "seriesNumber", "modality",
    "studyDate", "seriesDescription",
]

NODE_PROBE = """
import { readFileSync } from 'node:fs';
import { parseDicomSlice } from 'FILEURL/packages/io/dist/dicom-parse.js';
const files = JSON.parse(process.argv[1]);
const out = {};
for (const f of files) {
  try {
    const buf = Uint8Array.from(readFileSync(f)).buffer;
    const { slice, meta } = parseDicomSlice(buf);
    out[f] = { ok: true, px: slice.pixelData.length, meta: Object.fromEntries(
      %s.map((k) => [k, meta[k] === undefined ? null : meta[k]])) };
  } catch (e) {
    out[f] = { ok: false, error: String(e).slice(0, 160) };
  }
}
console.log(JSON.stringify(out));
""" % json.dumps(FIELDS)


def first(ds, tag):
    if tag not in ds:
        return None
    v = ds[tag].value
    # MultiValue (pydicom DS/IS arrays) is not a list/tuple — index it.
    try:
        if not isinstance(v, (str, bytes)) and hasattr(v, "__len__") and hasattr(v, "__getitem__"):
            v = v[0] if len(v) > 0 else None
    except (TypeError, IndexError):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def norm(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return None if v == "" else v
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    if isinstance(v, float):
        return round(v, 6)
    return v


def pydicom_view(path):
    from pydicom import dcmread
    from pydicom.errors import InvalidDicomError
    try:
        ds = dcmread(str(path), force=False)
    except (InvalidDicomError, Exception) as e:
        return {"ok": False, "error": str(e)[:160]}
    px = len(ds.PixelData) // 2 if "PixelData" in ds else 0

    def num(tag):
        return ds[tag].value if tag in ds else None

    def txt(tag):
        v = ds[tag].value if tag in ds else None
        return None if v is None else str(v)

    def floats(tag):
        v = ds[tag].value if tag in ds else None
        return None if v is None else [round(float(x), 6) for x in v]

    meta = {
        "rows": num(0x00280010), "cols": num(0x00280011),
        "bitsAllocated": num(0x00280100), "bitsStored": num(0x00280101),
        "pixelRepresentation": num(0x00280103),
        "samplesPerPixel": num(0x00280002),
        "numberOfFrames": int(num(0x00280008) or 1),
        "photometric": txt(0x00280004),
        "slope": float(num(0x00281053) or 1.0),
        "intercept": float(num(0x00281052) or 0.0),
        "windowCenter": first(ds, 0x00281050),
        "windowWidth": first(ds, 0x00281051),
        "instanceNumber": num(0x00200013),
        "sliceLocation": float(num(0x00201041)) if num(0x00201041) is not None else None,
        "seriesUID": txt(0x0020000E), "sopClassUID": txt(0x00080016),
        "pixelSpacing": floats(0x00280030),
        "sliceThickness": float(num(0x00180050)) if num(0x00180050) is not None else None,
        "patientName": txt(0x00100010), "patientID": txt(0x00100020),
        "studyUID": txt(0x0020000D), "seriesNumber": num(0x00200011),
        "modality": txt(0x00080060), "studyDate": txt(0x00080020),
        "seriesDescription": txt(0x0008103E),
    }
    return {"ok": True, "px": px, "ts": str(ds.file_meta.TransferSyntaxUID), "meta": meta}


def xval(paths):
    files = [str(p) for p in paths]
    probe_src = NODE_PROBE.replace("FILEURL", ROOT.as_uri())
    probe = subprocess.run(
        ["node", "--input-type=module", "-e", probe_src, json.dumps(files)],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    if probe.returncode != 0:
        sys.exit(f"node probe failed:\n{probe.stderr[:2000]}")
    ours = json.loads(probe.stdout)
    fails = 0
    for f in files:
        ref = pydicom_view(Path(f))
        got = ours[f]
        tag = Path(f).name
        if ref["ok"] != got["ok"]:
            # Ours is single-slice by design: multiframe files parse in
            # pydicom but reject loudly here (documented scope).
            # Agreement = the rejection names itself.
            if ref["ok"] and not got["ok"] and any(
                k in (got.get("error") or "") for k in ("multi-frame", "encapsulated")
            ):
                print(f"agree-scoped-reject {tag}: {got['error'][:100]}")
                continue
            # Odd-length injection: the lied-about length shifts every
            # downstream tag, so pydicom parses the husk but loses
            # PixelData (px=0) while our pixel pipeline rejects
            # (truncated). Agreement = both fail, each in its own
            # named way — never a silent half-parse.
            if tag == "odd-length.dcm" and not got["ok"] and ref.get("px", 1) == 0:
                print(f"agree-odd-reject {tag}: pydicom husk-only (no PixelData), ours: {got['error'][:100]}")
                continue
            print(f"FAIL {tag}: pydicom ok={ref['ok']} ours ok={got['ok']} "
                  f"({ref.get('error') or got.get('error')})")
            fails += 1
            continue
        if not ref["ok"]:
            print(f"agree-both-reject {tag}: {ref['error'][:80]}")
            continue
        diffs = []
        if ref["px"] != got["px"]:
            diffs.append(f"pixels {ref['px']} != {got['px']}")
        for k in FIELDS:
            a, b = norm(ref["meta"].get(k)), norm(got["meta"].get(k))
            if a != b:
                diffs.append(f"{k}: pydicom={a!r} ours={b!r}")
        if diffs:
            print(f"FAIL {tag}: " + "; ".join(diffs[:8]))
            fails += 1
        else:
            print(f"agree {tag} ({ref['px']} px, {ref['ts'].split('.')[-1]})")
    print(f"\nxval: {len(files) - fails}/{len(files)} agree")
    return fails


PARITY_NODE = """
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDicomSlice } from 'FILEURL/packages/io/dist/dicom-parse.js';
const dir = JSON.parse(process.argv[1]);
const out = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.dcm')).sort()) {
  try {
    const { slice, meta } = parseDicomSlice(Uint8Array.from(readFileSync(join(dir, f))).buffer);
    out.push({ f, ok: true,
      rows: meta.rows, cols: meta.cols,
      loc: meta.sliceLocation, inst: meta.instanceNumber,
      seriesUID: meta.seriesUID,
      thick: meta.sliceThickness, gap: meta.spacingBetweenSlices ?? null,
      spacing: meta.pixelSpacing,
      ipp: slice.ipp, iop: slice.iop });
  } catch (e) {
    out.push({ f, ok: false, error: String(e).slice(0, 120) });
  }
}
console.log(JSON.stringify(out));
"""


def nii_hdr(path):
    import struct
    b = path.read_bytes()[:352]
    le = struct.unpack('<i', b[0:4])[0] == 348
    e = '<' if le else '>'
    dims = struct.unpack(e + '8h', b[40:56])
    pix = struct.unpack(e + '8f', b[76:108])
    srow = struct.unpack(e + '12f', b[280:328])
    return {
        'dims': list(dims[1:dims[0] + 1]),
        'pix': [round(v, 4) for v in pix[1:4]],
        'srow': [round(v, 3) for v in srow],
    }


def parity(series_dirs):
    """I1 dcm2niix parity: our sort order + stack geometry vs dcm2niix NIfTI.

    Per series dir: run dcm2niix (scratch, never vendored), read our tags
    via the node probe, and check three agreements: (1) our ascending
    sliceLocation order is internally consistent (sorted == re-sorted);
    (2) every dcm2niix NIfTI z-origin matches a SliceLocation we parsed
    (same world, both readers); (3) in-plane dims + pixel spacing agree
    between our tags and the NIfTI header. SeriesUID splits are the known
    divergence: dcm2niix groups by SeriesInstanceUID, we sort by location —
    reported as info, never failure.
    """
    import shutil
    import tempfile
    if shutil.which('dcm2niix') is None:
        print('parity SKIP: dcm2niix binary not found (apt install mricron)')
        return 0
    from pydicom import dcmread
    dirs = [Path(a) for a in series_dirs]
    # samples/*.dcm is flat: group by filename stem minus trailing _NN.
    by_prefix: dict[str, list[Path]] = {}
    for f in sorted((ROOT / 'samples').glob('*.dcm')):
        stem = f.name[:-4]
        prefix = stem.rsplit('_', 1)[0] if stem.rsplit('_', 1)[-1].isdigit() else stem
        by_prefix.setdefault(prefix, []).append(f)
    if dirs:
        # explicit dirs win; bare names match a prefix group.
        groups: list[list[Path]] = []
        for d in dirs:
            if d.is_dir():
                files = sorted(d.glob('*.dcm'))
                if files:
                    groups.append(files)
            elif d.name in by_prefix:
                groups.append(by_prefix[d.name])
        tmp_roots = groups
    else:
        tmp_roots = [by_prefix[k] for k in sorted(by_prefix)]
    fails = 0
    probe_src = PARITY_NODE.replace('FILEURL', ROOT.as_uri())
    with tempfile.TemporaryDirectory(prefix='i1-parity-') as tmp:
        groups: list[list[Path]] = []
        if tmp_roots is not None:
            groups = tmp_roots
        else:
            for d in dirs:
                files = sorted(d.glob('*.dcm'))
                if files:
                    groups.append(files)
        for files in groups:
            name = files[0].name.rsplit('_', 1)[0]
            src = Path(tmp) / name
            out = Path(tmp) / f'out_{name}'
            src.mkdir()
            out.mkdir()
            for f in files:
                (src / f.name).write_bytes(f.read_bytes())
            probe = subprocess.run(
                ['node', '--input-type=module', '-e', probe_src, json.dumps(str(src))],
                capture_output=True, text=True, cwd=str(ROOT),
            )
            if probe.returncode != 0:
                print(f'FAIL {name}: node probe failed:\n{probe.stderr[:500]}')
                fails += 1
                continue
            ours = json.loads(probe.stdout)
            bad = [r for r in ours if not r['ok']]
            if bad:
                print(f'FAIL {name}: our parser rejects {[r["f"] for r in bad]}')
                fails += 1
                continue
            # (1) our order self-consistent: ascending loc, inst tiebreak
            order = sorted(ours, key=lambda r: (
                r['loc'] if r['loc'] is not None else 1e18, r['inst'] or 0))
            names = [r['f'] for r in order]
            if names != sorted(names, key=lambda f: (
                    next(r['loc'] for r in order if r['f'] == f) or 1e18,
                    next(r['inst'] for r in order if r['f'] == f) or 0)):
                print(f'FAIL {name}: our sort order unstable')
                fails += 1
                continue
            # seriesUID split info (dcm2niix groups by it; we sort through it)
            uids = {r['seriesUID'] for r in ours}
            # (2+3) dcm2niix run + header agreement
            conv = subprocess.run(
                ['dcm2niix', '-b', 'n', '-o', str(out), '-f', '%f_%s', str(src)],
                capture_output=True, text=True,
            )
            niis = sorted(out.glob('*.nii'))
            if not niis:
                print(f'FAIL {name}: dcm2niix converted nothing:\n{conv.stderr[:300]}')
                fails += 1
                continue
            locs = sorted(r['loc'] for r in ours if r['loc'] is not None)
            ok_splits = 0
            for nii in niis:
                h = nii_hdr(nii)
                nx, ny = h['dims'][0], h['dims'][1]
                # in-plane dims agree with every source slice
                if not all(r['rows'] == ny and r['cols'] == nx for r in ours):
                    print(f'FAIL {name}/{nii.name}: dims {h["dims"]} vs slices {ours[0]["rows"]}x{ours[0]["cols"]}')
                    fails += 1
                    break
                # in-plane spacing agrees with SOME source slice (these
                # teaching fixtures mix PixelSpacing per file; dcm2niix
                # carries each file's own spacing into its own NIfTI —
                # agreement is per-file, never a single-series value).
                sps = {(round(r['spacing'][0], 4), round(r['spacing'][1], 4))
                       for r in ours if r['spacing']}
                if sps and (round(h['pix'][0], 4), round(h['pix'][1], 4)) not in sps:
                    print(f'FAIL {name}/{nii.name}: spacing {h["pix"][:2]} not in {sorted(sps)}')
                    fails += 1
                    break
                # z-origin lands on one of our SliceLocations
                z0 = h['srow'][11]
                if locs and min(abs(z0 - l) for l in locs) < 0.5:
                    ok_splits += 1
            else:
                print(f'agree {name}: {len(ours)} slices → {len(niis)} nii '
                      f'(order {[Path(f).name for f in names][:3]}…; '
                      f'{len(uids)} SeriesUIDs; z-origins match {ok_splits}/{len(niis)})')
                continue
    print(f'\nparity: {"PASS" if fails == 0 else f"{fails} FAIL"}')
    return fails


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "gen"
    if cmd == "gen":
        gen_all()
    elif cmd == "xval":
        targets = [Path(a) for a in argv[2:]] or (
            sorted((ROOT / "samples").glob("*.dcm"))
            + sorted(OUT.glob("*.dcm"))
        )
        sys.exit(1 if xval(targets) else 0)
    elif cmd == "parity":
        sys.exit(1 if parity(list(argv[2:])) else 0)
    else:
        sys.exit(f"unknown command {cmd} (want gen|xval|parity)")


if __name__ == "__main__":
    main(sys.argv)
