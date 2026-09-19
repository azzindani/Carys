import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitMeshToBox, isStlLike, meshToStl, parseStl, StlError, stlFacets } from '../stl.js';
import { extractBoundary, meshTriangleCount } from '../surface.js';

describe('stl', () => {
  it('round-trips synthetic mesh: count + byte-exact vertices', () => {
    // 4x4x4 solid: fully synthetic, no samples needed (image gate safe)
    const mesh = extractBoundary(new Uint8Array(64).fill(1), 4, 4, 4);
    const tris = meshTriangleCount(mesh);
    assert.ok(tris > 0, 'empty mesh');
    const buf = meshToStl(mesh);
    assert.equal(buf.byteLength, 84 + tris * 50);
    const back = stlFacets(buf);
    assert.equal(back.count, tris);
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = mesh.indices[t * 3 + k]! * 3;
        assert.equal(back.positions[t * 9 + k * 3], mesh.positions[vi]);
        assert.equal(back.positions[t * 9 + k * 3 + 1], mesh.positions[vi + 1]);
        assert.equal(back.positions[t * 9 + k * 3 + 2], mesh.positions[vi + 2]);
      }
    }
  });
});

describe('stl import', () => {
  it('binary parses to soup with unit flat normals + sequential indices', () => {
    const mesh = extractBoundary(new Uint8Array(64).fill(1), 4, 4, 4);
    const parsed = parseStl(meshToStl(mesh));
    const tris = meshTriangleCount(mesh);
    assert.equal(parsed.indices.length / 3, tris);
    for (let t = 0; t < tris; t++) {
      assert.deepEqual([parsed.indices[t * 3], parsed.indices[t * 3 + 1], parsed.indices[t * 3 + 2]], [t * 3, t * 3 + 1, t * 3 + 2]);
    }
    for (let i = 0; i < parsed.normals.length; i += 3) {
      const l = Math.hypot(parsed.normals[i]!, parsed.normals[i + 1]!, parsed.normals[i + 2]!);
      assert.ok(Math.abs(l - 1) < 1e-5, `normal ${i / 3} not unit: ${l}`);
    }
    assert.ok(isStlLike(new Uint8Array(meshToStl(mesh))));
  });
  it('ASCII single triangle parses with exact verts + face normal', () => {
    const text = `solid tri
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 4 0 0
vertex 0 3 0
endloop
endfacet
endsolid tri`;
    const m = parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer);
    assert.equal(m.indices.length / 3, 1);
    assert.deepEqual([...m.positions], [0, 0, 0, 4, 0, 0, 0, 3, 0]);
    assert.deepEqual([...m.normals.slice(0, 3)], [0, 0, 1]);
    assert.ok(isStlLike(new TextEncoder().encode(text)));
  });
  it('garbage, truncated and empty inputs rejected with named error', () => {
    assert.throws(() => parseStl(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer), (e: unknown) => e instanceof StlError);
    assert.throws(() => parseStl(new TextEncoder().encode('solid empty\nendsolid').buffer as ArrayBuffer), (e: unknown) => e instanceof StlError);
    const mesh = extractBoundary(new Uint8Array(64).fill(1), 4, 4, 4);
    const full = new Uint8Array(meshToStl(mesh));
    assert.throws(() => parseStl(full.slice(0, 100).buffer as ArrayBuffer), (e: unknown) => e instanceof StlError);
    assert.equal(isStlLike(new Uint8Array([1, 2, 3])), false);
  });
  it('fitMeshToBox centers + scales into the viewBox', () => {
    const mesh = extractBoundary(new Uint8Array(64).fill(1), 4, 4, 4);
    const fitted = fitMeshToBox(parseStl(meshToStl(mesh)), [100, 200, 300]);
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < fitted.positions.length; i += 3) {
      if (fitted.positions[i]! < x0) x0 = fitted.positions[i]!;
      if (fitted.positions[i]! > x1) x1 = fitted.positions[i]!;
    }
    assert.ok(Math.abs((x0 + x1) / 2 - 50) < 1e-4, `not centered: ${x0}..${x1}`);
    assert.ok(x1 - x0 <= 300 * 0.7 + 1e-4 && x1 - x0 > 0, `bad span ${x1 - x0}`);
    assert.throws(() => fitMeshToBox({ positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) }, [10, 10, 10]), (e: unknown) => e instanceof StlError);
  });
});
