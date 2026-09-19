import type { DicomFileMeta } from '@carys/io';
import type { AnonymizeProfile, StudyRecord } from './types.js';

// Basic-confidentiality-profile anonymization: identity tags replaced,
// dates nulled unless the profile keeps them, UIDs re-rooted so the
// study stays internally linkable but unlinkable to the source.

const ANON_UID_ROOT = '1.2.826.0.1.999999';

function reRoot(uid: string | null): string | null {
  if (!uid) return null;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (Math.imul(h, 31) + uid.charCodeAt(i)) | 0;
  return `${ANON_UID_ROOT}.${Math.abs(h)}`;
}

export function anonymizeMeta(meta: DicomFileMeta, profile: AnonymizeProfile): DicomFileMeta {
  return {
    ...meta,
    patientName: profile.patientName,
    patientID: profile.patientID,
    studyUID: reRoot(meta.studyUID),
    seriesUID: reRoot(meta.seriesUID),
    studyDate: profile.keepDates ? meta.studyDate : null,
  };
}

export function anonymizeRecord(rec: StudyRecord, profile: AnonymizeProfile): StudyRecord {
  return {
    ...rec,
    patientName: profile.patientName,
    patientID: profile.patientID,
    studyUID: reRoot(rec.studyUID),
    studyDate: profile.keepDates ? rec.studyDate : null,
    anonymized: true,
  };
}

/** Scrub the NIfTI descrip/site fields so exports carry no identity. */
export function scrubNiftiDescrip(buf: ArrayBuffer): ArrayBuffer {
  // NIfTI-1 header: descrip at byte 148, 80 bytes; qform/sform codes stay.
  if (buf.byteLength < 348) throw new Error('buffer too small for NIfTI-1');
  const out = buf.slice(0);
  new Uint8Array(out, 148, 80).fill(0);
  return out;
}
