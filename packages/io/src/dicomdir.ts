// DICOMDIR directory parse: Media Storage Directory (PS3.11) → a
// patient/study/series/image tree with referenced file ids. Pure: bytes
// in, tree out. The viewer resolves Referenced File IDs against the
// user-selected files (exact name match) and opens the picked series —
// DICOMDIR never carries pixels itself, only the index.
//
// Scope: Explicit VR Little Endian directory files (what writers emit).
// Implicit-VR DICOMDIR stays a loud `dcmdata-implicit` follow-up — the
// dcm-read Dataset reader is explicit-only by the same contract.
// US cine + Doppler live in us.ts (shipped on the same TODO line).
import { readDataset, type Dataset } from './dcm-read.js';

export const DICOMDIR_SOP_CLASS = '1.2.840.10008.1.3.10';

/** One IMAGE-level directory record with its file reference. */
export interface DicomDirImage {
  /** Referenced File ID components joined by `/` (DICOM path) */
  fileId: string;
  instanceNumber: number | null;
}

/** One SERIES-level directory record with its images. */
export interface DicomDirSeries {
  modality: string | null;
  seriesNumber: number | null;
  seriesUID: string | null;
  images: DicomDirImage[];
}

/** One STUDY-level directory record with its series. */
export interface DicomDirStudy {
  studyUID: string | null;
  studyDate: string | null;
  studyDescription: string | null;
  series: DicomDirSeries[];
}

export interface DicomDir {
  studies: DicomDirStudy[];
  /** total IMAGE records (handy for the status line) */
  imageCount: number;
}

const textOf = (ds: Dataset, tag: string): string | null => ds.text(tag);
const numOf = (ds: Dataset, tag: string): number | null => ds.number(tag);

/** Record type, uppercased (PATIENT/STUDY/SERIES/IMAGE/...). */
function recordType(item: Dataset): string {
  return (textOf(item, '00041430') ?? '').trim().toUpperCase();
}

/** Referenced File ID (0004,1500): join components with `/`, drop empties. */
function fileIdOf(item: Dataset): string {
  const el = item.get('00041500');
  if (!el) return '';
  let s = '';
  for (const c of el.bytes) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  // CS components are backslash-separated, space-padded per component
  return s.split('\\').map((p) => p.trim()).filter((p) => p.length > 0).join('/');
}

function studyOf(item: Dataset): DicomDirStudy {
  return {
    studyUID: textOf(item, '0020000D'),
    studyDate: textOf(item, '00080020'),
    studyDescription: textOf(item, '00081030'),
    series: [],
  };
}

function seriesOf(item: Dataset): DicomDirSeries {
  return {
    modality: textOf(item, '00080060'),
    seriesNumber: numOf(item, '00200011'),
    seriesUID: textOf(item, '0020000E'),
    images: [],
  };
}

function imageOf(item: Dataset): DicomDirImage {
  return { fileId: fileIdOf(item), instanceNumber: numOf(item, '00200013') };
}

/**
 * Parse a DICOMDIR buffer into the directory tree. PATIENT records group
 * (kept implicit — studies list in file order); STUDY/SERIES nest;
 * IMAGE records attach to the current series. Unknown record types
 * (OVERLAY, VOI LUT, PALETTE, PRIVATE, ...) skip, never fail. Throws
 * `dcmdata-*` on non-DICOMDIR SOP class or a missing record sequence.
 */
export function parseDicomDir(buffer: ArrayBuffer): DicomDir {
  const ds = readDataset(buffer);
  const sop = ds.text('00080016');
  if (sop !== DICOMDIR_SOP_CLASS) {
    throw new Error(`dcmdata-not-dir: SOP ${sop ?? 'unreadable'} != Media Storage Directory`);
  }
  const records = ds.sequence('00041220');
  if (records.length === 0) throw new Error('dcmdata-no-records: empty Directory Record Sequence');
  const studies: DicomDirStudy[] = [];
  let study: DicomDirStudy | null = null;
  let series: DicomDirSeries | null = null;
  for (const item of records) {
    const type = recordType(item);
    if (type === 'STUDY') {
      study = studyOf(item);
      studies.push(study);
      series = null;
    } else if (type === 'SERIES') {
      if (!study) {
        study = { studyUID: null, studyDate: null, studyDescription: null, series: [] };
        studies.push(study);
      }
      series = seriesOf(item);
      study.series.push(series);
    } else if (type === 'IMAGE') {
      const img = imageOf(item);
      if (img.fileId === '') continue; // dangling reference: skip, never crash
      if (!series) {
        if (!study) {
          study = { studyUID: null, studyDate: null, studyDescription: null, series: [] };
          studies.push(study);
        }
        series = { modality: null, seriesNumber: null, seriesUID: null, images: [] };
        study.series.push(series);
      }
      series.images.push(img);
    }
    // PATIENT + everything else: grouping/unknown, skipped by design
  }
  let imageCount = 0;
  for (const s of studies) for (const se of s.series) imageCount += se.images.length;
  return { studies, imageCount };
}

/**
 * Resolve a series' file ids against user-selected files by exact filename
 * (DICOM path separators normalized to the local name). Returns the matched
 * files in record order. Unmatched ids are reported, never silently
 * dropped — the caller toasts the count.
 */
export function resolveDicomDirFiles(
  series: DicomDirSeries, files: { name: string }[],
): { matched: { name: string }[]; missing: string[] } {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const matched: { name: string }[] = [];
  const missing: string[] = [];
  for (const img of series.images) {
    const leaf = img.fileId.split('/').pop() ?? img.fileId;
    const hit = byName.get(leaf.toLowerCase());
    if (hit) matched.push(hit);
    else missing.push(img.fileId);
  }
  return { matched, missing };
}
