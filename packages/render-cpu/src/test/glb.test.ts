import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlb } from '../glb.js';

// H3 (docs/PHASES.md): the HRA reference organs are GLB files.

/** A GLB from a glTF JSON and its binary chunk. */
function glb(json: object, bin: Uint8Array): Uint8Array {
  const pad = (b: Uint8Array, fill: number): Uint8Array => {
    const out = new Uint8Array((b.length + 3) & ~3).fill(fill);
    out.set(b);
    return out;
  };
  const j = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const out = new Uint8Array(12 + 8 + j.length + 8 + b.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  dv.setUint32(20 + j.length, b.length, true); dv.setUint32(24 + j.length, 0x004e4942, true); out.set(b, 28 + j.length);
  return out;
}

/** One triangle, (1,0,0) (0,1,0) (0,0,1), with u16 indices. */
function triangleGltf(nodes: object[], scene: number[], extra: object = {}): Uint8Array {
  const pos = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0]);
  const bin = new Uint8Array(36 + 8);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), 36);
  return glb({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: scene }], nodes,
    meshes: [
      { name: 'tri', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    ...extra,
  }, bin);
}

const near = (a: ArrayLike<number>, b: number[]): void => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < b.length; i++) assert.ok(Math.abs(a[i]! - b[i]!) < 1e-6, `[${Array.from(a)}] vs [${b}]`);
};

describe('GLB meshes (H3)', () => {
  it('applies node transforms down the tree, matrix or translation · rotation · scale', () => {
    const h = Math.SQRT1_2;
    const meshes = parseGlb(triangleGltf([
      // parent: move +10 x, scale 2; child: turn 90° about z
      { name: 'parent', translation: [10, 0, 0], scale: [2, 2, 2], children: [1] },
      { name: 'child', mesh: 0, rotation: [0, 0, h, h] },
      // a column-major matrix moving +5 z, and the unindexed mesh
      { name: 'moved', mesh: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1] },
    ], [0, 2]));
    assert.deepEqual(meshes.map((m) => m.name), ['child', 'moved']);
    // (1,0,0) → turn → (0,1,0) → ×2 → (0,2,0) → +10 x → (10,2,0)
    near(meshes[0]!.positions, [10, 2, 0, 8, 0, 0, 10, 0, 2]);
    assert.deepEqual([...meshes[0]!.indices], [0, 1, 2]);
    near(meshes[1]!.positions, [1, 0, 5, 0, 1, 5, 0, 0, 6]);
    assert.deepEqual([...meshes[1]!.indices], [0, 1, 2]);
  });

  it('fails loud on what it does not read', () => {
    const ok = triangleGltf([{ mesh: 0 }], [0]);
    assert.throws(() => parseGlb(ok.slice(0, 10)), /glb-magic/);
    const bad = ok.slice();
    new DataView(bad.buffer).setUint32(4, 1, true);
    assert.throws(() => parseGlb(bad), /glb-version/);
    assert.throws(() => parseGlb(triangleGltf([{ mesh: 0 }], [0], { extensionsRequired: ['KHR_draco_mesh_compression'] })), /glb-extension: needs KHR_draco/);
    assert.throws(() => parseGlb(triangleGltf([{ mesh: 0, children: [0] }], [0])), /glb-node: 0 is its own ancestor/);
    assert.throws(() => parseGlb(triangleGltf([{ mesh: 3 }], [0])), /glb-mesh: 3 missing/);
    assert.throws(() => parseGlb(triangleGltf([{ mesh: 0 }], [0], {
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 1 }] }],
    })), /glb-primitive: mode 1/);
    assert.throws(() => parseGlb(triangleGltf([{ mesh: 0 }], [0], {
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 4, type: 'SCALAR' },
      ],
    })), /glb-accessor: 1 runs past its buffer view/);
  });
});
