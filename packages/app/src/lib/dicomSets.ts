// A set of DICOM files → the series it really contains.
//
// Real DICOM arrives as a folder of files, one image each, often without a
// .dcm extension, usually mixing a localizer or two with the axial stack —
// and the file router used to open only the first file of the selection.
// This is the one path from "some DICOM files" to open series: parse what
// parses, group it into stacks (io/dicom-stack.ts decides what a stack is),
// open the largest, and list the rest as series of their own. The catalog's
// sample sets take the same path, so they can no longer pass five exams off
// as one volume either.
import { groupDicomStacks, parseDicomFrames, stackLabel, type DicomStack, type ParsedDicomSlice } from '@carys/io';
import { addUploadedSeries, SERIES } from './catalog';
import { volumeFromStack } from './loaders';
import { session } from './session';
import { setStatus } from './status';
import { toast } from './toasts';
import { bump } from './version';
import type { SeriesSpec, Volume } from './types';

/** Upload stacks held by series name: an upload cannot be re-fetched, so a
 *  sibling series builds its volume from here when it is first opened. */
const held = new Map<string, DicomStack>();

/** Volume of a held upload stack, or null when `name` is not one. */
export function heldStackVolume(name: string): { vol: Volume; stack: DicomStack } | null {
  const stack = held.get(name);
  return stack ? { vol: volumeFromStack(stack), stack } : null;
}

function siblingName(base: string, k: number, stacks: DicomStack[]): string {
  return `${base} · ${k + 1}/${stacks.length} ${stackLabel(stacks[k]!)}`;
}

/**
 * The catalog path: a sample set that grouped into several stacks opened
 * the largest under its own name; the others become their own entries,
 * re-resolvable from the same files by stack index.
 */
export function registerSiblingStacks(name: string, spec: SeriesSpec, stacks: DicomStack[]): void {
  for (let k = 1; k < stacks.length; k++) {
    SERIES[siblingName(name, k, stacks)] = {
      ...spec, stackIndex: k,
      modality: spec.modality ?? stacks[k]!.meta.modality ?? undefined,
    };
  }
  toast(`${name}: these files are ${stacks.length} separate series, not one volume — the others are in the series list`);
}

/** True when the bytes look like DICOM Part 10 (the "DICM" preamble tag). */
export function isDicomPart10(head: Uint8Array): boolean {
  return head.length >= 132 && head[128] === 0x44 && head[129] === 0x49 && head[130] === 0x43 && head[131] === 0x4d;
}

/**
 * Open a multi-file DICOM selection (a folder, a PACS export). Files that do
 * not parse as images are counted and named, never silently dropped.
 * Returns the series names in the order they were registered.
 */
export async function openDicomFiles(
  files: File[], open: (name: string, vol: Volume) => Promise<void>,
): Promise<string[]> {
  const parts: ParsedDicomSlice[] = [];
  const skipped: string[] = [];
  setStatus(`reading ${files.length} DICOM file(s)…`);
  for (const f of files) {
    try {
      for (const p of parseDicomFrames(await f.arrayBuffer())) parts.push(p);
    } catch {
      // a DICOMDIR, a report, a stray .txt: not an image, and said so below
      skipped.push(f.name);
    }
  }
  const stacks = groupDicomStacks(parts);
  if (stacks.length === 0) {
    setStatus(`no DICOM images in ${files.length} file(s)${skipped.length ? ` (unreadable: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''})` : ''}`, 'error');
    return [];
  }
  const root = files.length === 1 ? files[0]!.name : `${files.length} files`;
  const names = stacks.map((s, k) => (stacks.length === 1 ? `uploaded: ${root}` : siblingName(`uploaded: ${root}`, k, stacks)));
  stacks.forEach((s, k) => {
    held.set(names[k]!, s);
    addUploadedSeries(names[k]!, undefined, { modality: s.meta.modality ?? undefined });
    session.seriesMeta.set(names[k]!, { meta: s.meta, warnings: s.warnings.map((w) => w.message) });
  });
  await open(names[0]!, volumeFromStack(stacks[0]!));
  const extra = skipped.length > 0 ? ` · ${skipped.length} non-image file(s) skipped` : '';
  const msg = stacks.length > 1
    ? `${files.length} files → ${stacks.length} series; opened the largest (${stacks[0]!.slices.length} images)${extra}`
    : `Loaded ${stacks[0]!.slices.length} images as one series${extra}`;
  setStatus(msg);
  toast(msg, 'ok');
  bump();
  return names;
}
