// Binary STL export for TriMesh (README export vision: NIfTI/STL/CSV/PNG).
// Layout: 80B header + u32 facet count + 50B/facet (normal + 3 verts f32LE + u16 attr).
import type { TriMesh } from './surface.js';

export function meshToStl(mesh: TriMesh, label = 'Carys'): ArrayBuffer {
  const tris = mesh.indices.length / 3;
  const out = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(out);
  const head = new TextEncoder().encode(label.slice(0, 79));
  new Uint8Array(out, 0, 80).set(head);
  dv.setUint32(80, tris, true);
  const P = mesh.positions, I = mesh.indices;
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const a = I[t * 3]! * 3, b = I[t * 3 + 1]! * 3, c = I[t * 3 + 2]! * 3;
    const ax = P[a]!, ay = P[a + 1]!, az = P[a + 2]!;
    const e1 = [P[b]! - ax, P[b + 1]! - ay, P[b + 2]! - az];
    const e2 = [P[c]! - ax, P[c + 1]! - ay, P[c + 2]! - az];
    let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    let ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    let nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    const verts = [a, b, c];
    for (let k = 0; k < 3; k++) {
      dv.setFloat32(o + 12 + k * 12, P[verts[k]!]!, true);
      dv.setFloat32(o + 16 + k * 12, P[verts[k]! + 1]!, true);
      dv.setFloat32(o + 20 + k * 12, P[verts[k]! + 2]!, true);
    }
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return out;
}

export class StlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StlError';
  }
}

/** Content sniff: binary size-match or ASCII solid/facet markers. */
export function isStlLike(bytes: Uint8Array): boolean {
  if (bytes.length >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 84);
    const count = dv.getUint32(80, true);
    if (count > 0 && 84 + count * 50 === bytes.length) return true;
  }
  if (bytes.length >= 64) {
    const head = new TextDecoder().decode(bytes.slice(0, 64));
    if (/^\s*solid\b/.test(head) && new TextDecoder().decode(bytes.slice(0, 512)).includes('facet')) return true;
  }
  return false;
}

function faceNormal(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): [number, number, number] {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function soupToMesh(tris: Float32Array): TriMesh {
  const n = tris.length / 9;
  const positions = new Float32Array(tris);
  const normals = new Float32Array(n * 9);
  const indices = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const [nx, ny, nz] = faceNormal(
      tris[o]!, tris[o + 1]!, tris[o + 2]!, tris[o + 3]!, tris[o + 4]!, tris[o + 5]!,
      tris[o + 6]!, tris[o + 7]!, tris[o + 8]!,
    );
    for (let k = 0; k < 3; k++) {
      normals[o + k * 3] = nx; normals[o + k * 3 + 1] = ny; normals[o + k * 3 + 2] = nz;
      indices[t * 3 + k] = t * 3 + k;
    }
  }
  return { positions, normals, indices };
}

function parseBinaryStl(buf: ArrayBuffer): TriMesh {
  if (buf.byteLength < 84) throw new StlError(`truncated header (${buf.byteLength} bytes)`);
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  if (count === 0 || count > 20_000_000) throw new StlError(`implausible facet count ${count}`);
  if (buf.byteLength < 84 + count * 50) throw new StlError(`truncated body: ${count} facets need ${84 + count * 50} bytes`);
  const tris = new Float32Array(count * 9);
  let o = 84;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      tris[t * 9 + k * 3] = dv.getFloat32(o + 12 + k * 12, true);
      tris[t * 9 + k * 3 + 1] = dv.getFloat32(o + 16 + k * 12, true);
      tris[t * 9 + k * 3 + 2] = dv.getFloat32(o + 20 + k * 12, true);
    }
    o += 50;
  }
  return soupToMesh(tris);
}

function parseAsciiStl(text: string): TriMesh {
  const nums: number[] = [];
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = [parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!)];
    if (v.some((x) => !Number.isFinite(x))) throw new StlError('non-numeric vertex in ASCII facet');
    nums.push(v[0]!, v[1]!, v[2]!);
  }
  if (nums.length === 0 || nums.length % 9 !== 0) throw new StlError(`no facets parsed (${nums.length} coords)`);
  return soupToMesh(new Float32Array(nums));
}

/**
 * Full STL reader (binary + ASCII) -> TriMesh soup with flat normals.
 * Throws StlError on truncated/garbage input.
 */
export function parseStl(buf: ArrayBuffer): TriMesh {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 84) {
    const dv = new DataView(buf);
    const count = dv.getUint32(80, true);
    if (count > 0 && count <= 20_000_000 && 84 + count * 50 === bytes.length) return parseBinaryStl(buf);
  }
  const text = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 16_000_000)));
  if (/^\s*solid\b/.test(text) && text.includes('facet')) return parseAsciiStl(text);
  throw new StlError('not an STL file (no binary size-match, no ASCII solid/facet)');
}

/**
 * Uniform-scale + recenter a mesh into a voxel viewBox so the CPU rasterizer
 * (which frames by dims) shows an imported mesh at a sane size.
 */
export function fitMeshToBox(mesh: TriMesh, dims: [number, number, number]): TriMesh {
  const P = mesh.positions;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!Number.isFinite(x0)) throw new StlError('empty mesh has no bounding box');
  const span = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-9);
  const target = Math.max(...dims) * 0.7;
  const s = target / span;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    out[i] = (P[i]! - cx) * s + dims[0] / 2;
    out[i + 1] = (P[i + 1]! - cy) * s + dims[1] / 2;
    out[i + 2] = (P[i + 2]! - cz) * s + dims[2] / 2;
  }
  return { positions: out, normals: mesh.normals.slice(), indices: mesh.indices.slice() };
}

/** Minimal STL reader — test-only inverse: returns facet count + vertex positions. */
export function stlFacets(buf: ArrayBuffer): { count: number; positions: Float32Array } {
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  let o = 84;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      positions[t * 9 + k * 3] = dv.getFloat32(o + 12 + k * 12, true);
      positions[t * 9 + k * 3 + 1] = dv.getFloat32(o + 16 + k * 12, true);
      positions[t * 9 + k * 3 + 2] = dv.getFloat32(o + 20 + k * 12, true);
    }
    o += 50;
  }
  return { count, positions };
}
