// Parse worker: NIfTI / NRRD / OME-TIFF decode off the main thread,
// bundled by Vite like the extract worker. Same contract (id-routed
// replies, transferable buffers, fail-loud error strings). The
// main-thread loaders stay as the fallback when Workers fail.
//
// The decode is the loaders' own, not a copy of it. The copy this replaced
// read NIfTI voxels with `new Float64Array(frameBytes)` — a float64 view over
// int16/uint8 bytes — so an uploaded BraTS FLAIR came back 75% NaN and the
// rest noise, while the main-thread fallback (the only path the fixtures
// exercised) was fine. One implementation cannot drift like that.
import { isNrrdLike, isTiffLike } from '@carys/io';
import { loadNiiBuffer, loadNrrdBuffer, loadOmeTiffBuffer } from '../lib/loaders';
import type { Volume } from '../lib/types';

export interface ParseRequest {
  id: number;
  buffer: ArrayBuffer;
  name: string;
}

type PostFn = (m: unknown, t?: Transferable[]) => void;

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, buffer, name } = e.data;
  const post = (self as unknown as { postMessage: PostFn }).postMessage.bind(self);
  try {
    const bytes = new Uint8Array(buffer);
    let v: Volume;
    let kind = 'nifti';
    if (isNrrdLike(bytes)) {
      kind = 'nrrd';
      v = loadNrrdBuffer(buffer);
    } else if (isTiffLike(bytes)) {
      kind = 'tiff';
      v = loadOmeTiffBuffer(buffer);
    } else {
      v = loadNiiBuffer(buffer);
    }
    const out = v.data.buffer as ArrayBuffer;
    post({
      id, ok: true, kind, name,
      dims: v.dims, spacing: v.spacing, geometry: v.geometry, source: v.source, data: out,
    }, [out]);
  } catch (err) {
    // input buffer transfers only on success (above): on failure the
    // caller retains its copy and falls back to main-thread decode.
    post({ id, ok: false, error: (err as Error).message });
  }
};
