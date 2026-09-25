// What the boot path needs to know about DICOM uploads without loading a
// DICOM decoder: whether bytes look like Part 10, and the upload stacks held
// by series name (an upload cannot be re-fetched, so a sibling series builds
// its volume from here when it is first opened). dicomSets.ts, imported on
// first use, reads the files and fills this.
import type { DicomStack } from '@carys/io';

const held = new Map<string, DicomStack>();

/** A held upload stack by series name, or null when `name` is not one. */
export function heldStack(name: string): DicomStack | null {
  return held.get(name) ?? null;
}

export function holdStack(name: string, stack: DicomStack): void {
  held.set(name, stack);
}

/** True when the bytes look like DICOM Part 10 (the "DICM" preamble tag). */
export function isDicomPart10(head: Uint8Array): boolean {
  return head.length >= 132 && head[128] === 0x44 && head[129] === 0x49 && head[130] === 0x43 && head[131] === 0x4d;
}
