// STOW-RS request builder: wrap SOP instances in multipart/related.
import { buildMultipartRelated } from './multipart.js';

export interface StowItem {
  /** raw Part-10 file bytes */
  bytes: Uint8Array;
  contentLocation?: string;
}

/** Build a STOW-RS body + the Content-Type header value to send with it. */
export function buildStowBody(items: StowItem[], boundary?: string): { body: Uint8Array; contentType: string } {
  if (items.length === 0) throw new Error('STOW-RS requires at least one instance');
  const { body, boundary: b } = buildMultipartRelated(
    items.map((i) => ({ contentType: 'application/dicom', contentLocation: i.contentLocation, body: i.bytes })),
    boundary,
  );
  return { body, contentType: `multipart/related; type="application/dicom"; boundary=${b}` };
}

/** Parse a STOW-RS XML/JSON response summary: stored vs failed SOP UIDs.
 * Servers vary; this handles the common `{ Stored: [...], Failed: [...] }`
 * JSON shape and returns UIDs (or refs) verbatim. */
export function parseStowResponse(json: unknown): { stored: string[]; failed: { uid: string; reason: string }[] } {
  const pick = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.map((e) => {
      if (typeof e === 'string') return e;
      const o = e as Record<string, unknown>;
      return String(o['SOPInstanceUID'] ?? o['uid'] ?? o['00080018'] ?? JSON.stringify(e));
    });
  };
  const fails = (v: unknown): { uid: string; reason: string }[] => {
    if (!Array.isArray(v)) return [];
    return v.map((e) => {
      const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
      return {
        uid: String(o['SOPInstanceUID'] ?? o['uid'] ?? 'unknown'),
        reason: String(o['reason'] ?? o['message'] ?? 'rejected'),
      };
    });
  };
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const stored = pick(o['Stored'] ?? o['stored'] ?? o['success']);
  const failed = fails(o['Failed'] ?? o['failed'] ?? o['failures']);
  return { stored, failed };
}
