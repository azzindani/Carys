import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMesh } from '../raster.js';
import type { TriMesh } from '../surface.js';

// Rotation center: default stays volume-centered (goldens frozen); an
// explicit center translates the frame without changing its content.
describe('renderMesh rotation center', () => {
  // One front-facing triangle in a 40^3 volume.
  const mesh: TriMesh = {
    positions: new Float32Array([10, 10, 20, 30, 10, 20, 20, 30, 20]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const dims: [number, number, number] = [40, 40, 40];
  const base = {
    width: 100, height: 100, angleY: 0, tiltX: 0,
    color: [200, 200, 200] as [number, number, number],
  };
  const painted = (out: Uint8ClampedArray): number => {
    let n = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] !== 17 || out[i + 1] !== 17 || out[i + 2] !== 17) n++;
    }
    return n;
  };

  it('omitted center renders identically to the volume center', () => {
    const a = renderMesh(mesh, dims, base);
    const b = renderMesh(mesh, dims, { ...base, center: [20, 20, 20] });
    assert.deepEqual(a, b);
    assert.ok(painted(a) > 50, `triangle should paint, got ${painted(a)}px`);
  });

  it('shifted center translates the frame, content preserved', () => {
    const a = renderMesh(mesh, dims, base);
    const b = renderMesh(mesh, dims, { ...base, center: [25, 20, 20] });
    assert.notDeepEqual(a, b);
    // Edge pixels may rasterize differently; the painted area must match.
    const pa = painted(a), pb = painted(b);
    assert.ok(Math.abs(pa - pb) <= Math.max(4, pa * 0.02), `${pa} vs ${pb}`);
  });
});
