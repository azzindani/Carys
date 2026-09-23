// DICOM-SEG / RTSTRUCT import + SEG export. Split out of sessionOps when
// the multi-label roundtrip landed (700-line gate). Pure import/export
// over the session mask; undo + toast + status shared with the caller.
import {
  parseRTSTRUCT, parseSEG, readDataset, rtToMasks,
  RTSTRUCT_SOP_CLASS, segToMasks, SEG_SOP_CLASS, writeSEG, type DicomFileMeta,
} from '@carys/io';
import { labelmapToMasks, segmentsTable } from '@carys/editor-seg';
import { session } from './session';
import { getUi } from './store';
import { setStatus } from './status';
import { toast } from './toasts';
import { bump } from './version';
import { pushUndo } from './sessionOps';

function currentSliceZs(): number[] {
  const img = session.img;
  if (!img) return [];
  const sp = img.spacing ?? [1, 1, 1];
  return Array.from({ length: img.dims[2] }, (_, i) => i * sp[2]);
}

/** Import a SEG/RTSTRUCT buffer into the session mask (multi-label aware). */
export async function importDicomSeg(buf: ArrayBuffer, name: string): Promise<void> {
  const img = session.img;
  if (!img || !session.editMask) {
    setStatus('open a series first, then import the segmentation');
    return;
  }
  const sop = readDataset(buf.slice(0)).text('00080016');
  const geo = { dims: img.dims, sliceZs: currentSliceZs() };
  let incoming: Uint8Array | null = null;
  let label = name;
  if (sop === SEG_SOP_CLASS) {
    const seg = parseSEG(buf);
    const masks = segToMasks(seg, geo);
    // multi-label: every segment keeps its value (sorted by segment number);
    // single-segment files take the legacy largest-wins path unchanged
    if (masks.size > 1) {
      const lm = new Uint8Array(img.data.length);
      const names: { value: number; label: string }[] = [];
      let v = 0;
      for (const [num, m] of [...masks.entries()].sort((a, b) => a[0] - b[0])) {
        v++;
        if (v > 255) break; // labelmap is Uint8; extras stay out (loud below)
        for (let i = 0; i < m.length; i++) if (m[i] && lm[i] === 0) lm[i] = v;
        names.push({ value: v, label: seg.segments.find((s) => s.number === num)?.label ?? `Segment ${v}` });
      }
      incoming = lm;
      label = `${names.length} segments (${names.map((s) => s.label).join(', ')})`;
      if (masks.size > v) label += ` · ${masks.size - v} dropped (>255)`;
    } else {
      let best = 0;
      for (const [num, m] of masks) {
        let n = 0;
        for (const v of m) if (v) n++;
        if (n > best) {
          best = n;
          incoming = m;
          label = seg.segments.find((s) => s.number === num)?.label ?? name;
        }
      }
    }
  } else if (sop === RTSTRUCT_SOP_CLASS) {
    const rt = parseRTSTRUCT(buf);
    const masks = rtToMasks(rt, { dims: img.dims, spacing: img.spacing ?? [1, 1, 1] });
    let best = 0;
    for (const [num, m] of masks) {
      let n = 0;
      for (const v of m) if (v) n++;
      if (n > best) {
        best = n;
        incoming = m;
        label = rt.rois.find((r) => r.number === num)?.name ?? name;
      }
    }
  } else {
    setStatus(`not a SEG/RTSTRUCT (${sop ?? 'unreadable'}) — volume import needs .nii`);
    return;
  }
  if (!incoming) {
    setStatus('no segments decoded');
    return;
  }
  session.editMask.set(incoming);
  pushUndo();
  session.maskVer++;
  session.seg = { dims: img.dims, data: session.editMask };
  bump();
  toast(`Imported ${label}`, 'ok');
  setStatus(`imported ${label} from ${name}`);
}

/** Export the editable mask as a DICOM-SEG Part-10 file (labels kept). */
export function saveSegDcm(): void {
  const { editMask, img } = session;
  if (!editMask || !img) return;
  const sp = img.spacing ?? [1, 1, 1];
  // multi-label roundtrip: one segment per label value (labels preserved),
  // binary masks take the legacy single-segment path unchanged
  const masks = labelmapToMasks(editMask);
  const table = segmentsTable(editMask, sp);
  const segments = masks.size > 0
    ? [...masks.entries()].sort((a, b) => a[0] - b[0]).map(([v, mask]) => ({
      label: table.find((r) => r.value === v)?.label ?? `Segment ${v}`, mask,
    }))
    : [{ label: `Mask ${getUi().series}`, mask: editMask }];
  const buf = writeSEG({
    segments,
    dims: img.dims, spacing: sp,
    seriesUID: undefined, studyUID: undefined,
  });
  const a = document.createElement('a');
  a.download = `mask-${getUi().series}.dcm`;
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/dicom' }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(segments.length > 1 ? `SEG .dcm saved: ${segments.length} segments` : 'Mask SEG .dcm saved');
}

export type { DicomFileMeta };
