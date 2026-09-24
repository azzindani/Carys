// glTF 2.0 binary (GLB) meshes (H3, docs/PHASES.md: the HuBMAP HRA 3D
// reference organs ship as GLB). Every node of the default scene that has a
// mesh comes back as one mesh in the scene's frame, the node transforms
// applied down the tree, its triangle primitives joined. Pure; throws
// `glb-*` on what it does not read (a required extension such as Draco,
// sparse accessors, points or lines) rather than returning part of a model.

export interface GlbMesh {
  /** the node's name, else its mesh's, else "node <i>" */
  name: string;
  /** scene frame, the file's units (glTF: metres) */
  positions: Float32Array;
  indices: Uint32Array;
}

interface Accessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }
interface BufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }
interface Node { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface Primitive { attributes: Record<string, number>; indices?: number; mode?: number }
interface Gltf {
  asset?: { version?: string };
  extensionsRequired?: string[];
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  meshes?: { name?: string; primitives: Primitive[] }[];
  nodes?: Node[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TRIANGLES = 4;

type M4 = number[]; // column-major, as glTF writes it

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

/** A node's local matrix: `matrix`, else translation · rotation · scale. */
function local(n: Node): M4 {
  if (n.matrix) {
    if (n.matrix.length !== 16) throw new RangeError('glb-node: matrix is not 16 numbers');
    return n.matrix;
  }
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! + z! * w!), 2 * (x! * z! - y! * w!),
    2 * (x! * y! - z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! + x! * w!),
    2 * (x! * z! + y! * w!), 2 * (y! * z! - x! * w!), 1 - 2 * (x! * x! + y! * y!),
  ];
  return [
    r[0]! * sx!, r[1]! * sx!, r[2]! * sx!, 0,
    r[3]! * sy!, r[4]! * sy!, r[5]! * sy!, 0,
    r[6]! * sz!, r[7]! * sz!, r[8]! * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

/** Read the meshes of a GLB file. */
export function parseGlb(src: ArrayBuffer | Uint8Array): GlbMesh[] {
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new RangeError('glb-magic: not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new RangeError(`glb-version: ${dv.getUint32(4, true)}`);
  let json: Gltf | null = null, bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const len = dv.getUint32(at, true), type = dv.getUint32(at + 4, true);
    if (at + 8 + len > bytes.length) throw new RangeError('glb-truncated: chunk runs past the file');
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as Gltf;
    else if (type === CHUNK_BIN && !bin) bin = body;
    at += 8 + len;
  }
  if (!json) throw new RangeError('glb-json: no JSON chunk');
  const g = json;
  if (g.extensionsRequired?.length) throw new RangeError(`glb-extension: needs ${g.extensionsRequired.join(', ')}`);

  const read = (i: number, want: 'float3' | 'index'): Float32Array | Uint32Array => {
    const a = g.accessors?.[i];
    if (!a) throw new RangeError(`glb-accessor: ${i} missing`);
    if (a.sparse) throw new RangeError(`glb-accessor: ${i} is sparse`);
    const bv = a.bufferView === undefined ? undefined : g.bufferViews?.[a.bufferView];
    if (!bv || !bin || bv.buffer !== 0) throw new RangeError(`glb-accessor: ${i} has no data in the binary chunk`);
    const n = COMPONENTS[a.type];
    if (!n) throw new RangeError(`glb-accessor: ${i} type ${a.type}`);
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    if (!size) throw new RangeError(`glb-accessor: ${i} component type ${a.componentType}`);
    if (want === 'float3' && (a.componentType !== 5126 || n !== 3)) throw new RangeError(`glb-accessor: ${i} is not float VEC3`);
    if (want === 'index' && (a.componentType === 5126 || n !== 1)) throw new RangeError(`glb-accessor: ${i} is not an index list`);
    const stride = bv.byteStride ?? n * size, base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (a.count > 0 && base + (a.count - 1) * stride + n * size > (bv.byteOffset ?? 0) + bv.byteLength) {
      throw new RangeError(`glb-accessor: ${i} runs past its buffer view`);
    }
    const bd = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const out = want === 'float3' ? new Float32Array(a.count * 3) : new Uint32Array(a.count);
    for (let e = 0; e < a.count; e++) {
      for (let c = 0; c < n; c++) {
        const o = base + e * stride + c * size;
        out[e * n + c] = size === 4 ? (a.componentType === 5126 ? bd.getFloat32(o, true) : bd.getUint32(o, true))
          : size === 2 ? bd.getUint16(o, true) : bd.getUint8(o);
      }
    }
    return out;
  };

  const out: GlbMesh[] = [];
  const visit = (ni: number, parent: M4, seen: Set<number>): void => {
    const n = g.nodes?.[ni];
    if (!n) throw new RangeError(`glb-node: ${ni} missing`);
    if (seen.has(ni)) throw new RangeError(`glb-node: ${ni} is its own ancestor`);
    const m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      const mesh = g.meshes?.[n.mesh];
      if (!mesh) throw new RangeError(`glb-mesh: ${n.mesh} missing`);
      const P: number[] = [], I: number[] = [];
      for (const pr of mesh.primitives) {
        if ((pr.mode ?? TRIANGLES) !== TRIANGLES) throw new RangeError(`glb-primitive: mode ${pr.mode} in ${n.name ?? ni}`);
        if (pr.attributes['POSITION'] === undefined) throw new RangeError(`glb-primitive: no POSITION in ${n.name ?? ni}`);
        const pos = read(pr.attributes['POSITION'], 'float3');
        const idx = pr.indices === undefined ? Uint32Array.from({ length: pos.length / 3 }, (_, k) => k) : read(pr.indices, 'index');
        if (idx.length % 3) throw new RangeError(`glb-primitive: ${idx.length} indices in ${n.name ?? ni}`);
        const base = P.length / 3, nv = pos.length / 3;
        for (let v = 0; v < nv; v++) {
          const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
          for (let r = 0; r < 3; r++) P.push(m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!);
        }
        for (const x of idx) {
          if (x >= nv) throw new RangeError(`glb-primitive: index ${x} of ${nv} vertices in ${n.name ?? ni}`);
          I.push(base + x);
        }
      }
      out.push({ name: n.name ?? mesh.name ?? `node ${ni}`, positions: Float32Array.from(P), indices: Uint32Array.from(I) });
    }
    const next = new Set(seen).add(ni);
    for (const c of n.children ?? []) visit(c, m, next);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  if (!scene) throw new RangeError('glb-scene: no scene');
  for (const ni of scene.nodes ?? []) visit(ni, IDENTITY, new Set());
  return out;
}
