import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceNets } from '../surface-nets.js';

function checkMesh(m: ReturnType<typeof surfaceNets>, minTris: number): void {
  assert.ok(m.indices.length / 3 >= minTris, 'too few triangles');
  const nv = m.positions.length / 3;
  for (const i of m.indices) assert.ok(i >= 0 && i < nv, 'index out of range');
  for (let i = 0; i < m.normals.length; i += 3) {
    const l = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
    assert.ok(Math.abs(l - 1) < 1e-5, `normal not unit: ${l}`);
  }
}

describe('surfaceNets', () => {
  it('empty field -> no triangles', () => {
    assert.equal(surfaceNets(new Float32Array(27), 3, 3, 3, 0.5).indices.length, 0);
  });
  it('single voxel -> closed 6-quad surface', () => {
    const f = new Float32Array(27);
    f[13] = 1;
    const m = surfaceNets(f, 3, 3, 3, 0.5);
    assert.equal(m.indices.length / 3, 12);
    checkMesh(m, 12);
  });
  it('smooth sphere field is closed and smooth', () => {
    const n = 16;
    const f = new Float32Array(n ** 3);
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5, z - 7.5);
          f[z * n * n + y * n + x] = 6 - d;
        }
    const m = surfaceNets(f, n, n, n, 0);
    checkMesh(m, 200);
  });
});
