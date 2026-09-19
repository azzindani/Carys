// Parse worker: NIfTI / NRRD / OME-TIFF decode off the main thread,
// bundled by Vite like the extract worker. Same contract (id-routed
// replies, transferable buffers, fail-loud error strings). The
// main-thread loaders stay as the fallback when Workers fail.
import {
  decodeNiftiBuffer, isNrrdLike, isTiffLike, parseNrrd, parseOmeTiff,
  readHeader, readImage,
} from '@carys/io';

export interface ParseRequest {
  id: number;
  buffer: ArrayBuffer;
  name: string;
}

type PostFn = (m: unknown, t?: Transferable[]) => void;

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, buffer, name } = e.data;
  const post = (self as unknown as { postMessage: PostFn }).postMessage.bind(self);
  const reply = (ok: boolean, payload: Record<string, unknown>, transfer?: Transferable[]): void => {
    post({ id, ok, ...payload }, transfer);
  };
  try {
    const bytes = new Uint8Array(buffer);
    let dims: [number, number, number];
    let spacing: [number, number, number];
    let data: Float64Array;
    let kind = 'nifti';
    if (isNrrdLike(bytes)) {
      kind = 'nrrd';
      const v = parseNrrd(buffer);
      const n = v.dims[0] * v.dims[1] * v.dims[2];
      data = new Float64Array(n);
      for (let i = 0; i < n; i++) data[i] = v.data[i]!;
      dims = v.dims;
      spacing = v.spacing;
    } else if (isTiffLike(bytes)) {
      kind = 'tiff';
      // Same z-stack rule as the main-thread loadOmeTiffBuffer: planes of
      // the first channel with matching geometry stack in z-order (a bare
      // first-plane-only decode collapses every stack to a single slice).
      const { planes } = parseOmeTiff(buffer);
      if (planes.length === 0) throw new Error('TIFF has no decodable planes');
      const first = planes[0]!;
      const stack = planes
        .filter((p) => p.c === first.c && p.width === first.width && p.height === first.height && p.dtype === first.dtype)
        .sort((a, b) => a.z - b.z);
      const use = stack.length > 1 ? stack : [first];
      const n = first.width * first.height;
      data = new Float64Array(n * use.length);
      use.forEach((p, k) => {
        for (let i = 0; i < n; i++) data[k * n + i] = p.data[i]!;
      });
      dims = [first.width, first.height, use.length];
      spacing = [1, 1, 1];
    } else {
      const buf = decodeNiftiBuffer(bytes);
      const h = readHeader(buf);
      const frame = readImage(h, buf);
      const raw = new Float64Array(frame);
      const n = h.dims[0] * h.dims[1] * h.dims[2];
      data = new Float64Array(n);
      const useSlope = Number.isFinite(h.scl_slope) && h.scl_slope !== 0;
      for (let i = 0; i < n; i++) data[i] = useSlope ? raw[i]! * h.scl_slope + h.scl_inter : raw[i]!;
      dims = h.dims;
      spacing = [h.pixDims[1], h.pixDims[2], h.pixDims[3]];
    }
    const out = data.buffer.slice(0) as ArrayBuffer;
    reply(true, { kind, dims, spacing, data: out, name }, [out]);
  } catch (err) {
    // input buffer transfers only on success (above): on failure the
    // caller retains its copy and falls back to main-thread decode.
    reply(false, { error: (err as Error).message });
  }
};
