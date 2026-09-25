import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskNets, surfaceNets } from '../surface-nets.js';
import { sliceFactor, smoothSurface, thickSliceNets } from '../thick-slices.js';
import { ellipsoid, sampleIntensity, sampleMask, scoreMesh, sphere, type V3 } from './phantoms.js';

// Surfaces from thick slices. Each case is scored
// against the path it replaces — the one-grid surface of F2 (image) or F3
// (mask) — on the same samples.

const THICK: [string, ReturnType<typeof sphere>, V3, V3][] = [
  ['sphere r10 on 1×1×5 mm', sphere([16, 16, 17.5], 10), [32, 32, 7], [1, 1, 5]],
  ['ellipsoid 12×9×20 on 1×1×5 mm', ellipsoid([16, 16, 32.5], [12, 9, 20]), [32, 32, 13], [1, 1, 5]],
  ['ellipsoid 12×9×7 on 0.8×0.8×2.5 mm', ellipsoid([16, 16, 17.5], [12, 9, 7]), [40, 40, 14], [0.8, 0.8, 2.5]],
];

describe('thick slices (F5)', () => {
  it('interpolates only when the slice gap is thick', () => {
    assert.equal(sliceFactor([1, 1, 1]), 1);
    assert.equal(sliceFactor([0.9, 0.9, 1.2]), 1);
    assert.equal(sliceFactor([0.8, 0.8, 2.5]), 3);
    assert.equal(sliceFactor([0.938, 0.938, 5]), 5);
    assert.equal(sliceFactor([0.5, 0.5, 10]), 8, 'capped');
    // an isotropic grid is the one-grid path, untouched
    const ph = sphere([16, 16, 16], 10), m = sampleMask(ph, [32, 32, 32], [1, 1, 1]);
    const t = thickSliceNets(m, 32, 32, 32, [1, 1, 1], 0.5);
    assert.equal(t.factor, 1);
    assert.deepEqual(t.mesh.positions, maskNets(m, 32, 32, 32).positions);
  });

  it('beats the one-grid surfaces on thick grids, mask and image', () => {
    for (const [id, ph, dims, sp] of THICK) {
      const m = sampleMask(ph, dims, sp), im = sampleIntensity(ph, dims, sp);
      const f3 = scoreMesh(maskNets(m, ...dims), sp, ph);
      const f2 = scoreMesh(surfaceNets(im, ...dims, 500.5), sp, ph);
      const mask = smoothSurface(m, ...dims, sp, 0, true);
      const img = smoothSurface(im, ...dims, sp, 500, false);
      assert.ok(mask.factor >= 3 && img.factor >= 3, `${id}: factor ${mask.factor}`);
      const a = scoreMesh(mask.mesh, sp, ph), b = scoreMesh(img.mesh, sp, ph);
      assert.ok(a.meanErr < f3.meanErr && a.normalDevDeg < f3.normalDevDeg,
        `${id} mask: ${f3.meanErr.toFixed(3)} mm / ${f3.normalDevDeg.toFixed(1)}° → ${a.meanErr.toFixed(3)} / ${a.normalDevDeg.toFixed(1)}°`);
      assert.ok(b.meanErr < f2.meanErr + 0.005 && b.normalDevDeg < f2.normalDevDeg,
        `${id} image: ${f2.meanErr.toFixed(3)} mm / ${f2.normalDevDeg.toFixed(1)}° → ${b.meanErr.toFixed(3)} / ${b.normalDevDeg.toFixed(1)}°`);
    }
  });

  it('the 5 mm sphere: image 0.45 → 0.15 mm, mask 0.59 → 0.21 mm', () => {
    const [, ph, dims, sp] = THICK[0]!;
    const img = scoreMesh(smoothSurface(sampleIntensity(ph, dims, sp), ...dims, sp, 500, false).mesh, sp, ph);
    const mask = scoreMesh(smoothSurface(sampleMask(ph, dims, sp), ...dims, sp, 0, true).mesh, sp, ph);
    assert.ok(img.meanErr < 0.16 && img.normalDevDeg < 7, `image ${img.meanErr.toFixed(3)} mm / ${img.normalDevDeg.toFixed(1)}°`);
    assert.ok(mask.meanErr < 0.25 && mask.normalDevDeg < 9, `mask ${mask.meanErr.toFixed(3)} mm / ${mask.normalDevDeg.toFixed(1)}°`);
  });

  it('F5 acceptance: the 12×9×7 ellipsoid on 1×1×5 mm, on the bound for 5 mm data', () => {
    // Three slices cross this 14 mm-tall shape, so its ends fall inside a
    // 5 mm gap the data does not resolve; even perfect ends would leave a
    // 0.14 mm mean. The 1 mm-grid bounds (0.1 mm; 0.25 mm / 8°)
    // were set for 1 mm grids. The bound for 5 mm data (the owner's call,
    // 2026-09-25) keeps F2's ratio, a mean error of a tenth of the slice
    // gap, and 13° on the normals, on both paths. Measured: image 0.460 mm /
    // 12.2°, mask 0.460 mm / 12.9°; the one-grid paths on the same samples
    // 0.603 mm / 19.0° and 0.685 mm / 21.0°.
    const ph = ellipsoid([16, 16, 17.5], [12, 9, 7]);
    const dims: V3 = [32, 32, 7], sp: V3 = [1, 1, 5];
    const m = sampleMask(ph, dims, sp), im = sampleIntensity(ph, dims, sp);
    const paths = [
      ['mask', scoreMesh(maskNets(m, ...dims), sp, ph), scoreMesh(smoothSurface(m, ...dims, sp, 0, true).mesh, sp, ph)],
      ['image', scoreMesh(surfaceNets(im, ...dims, 500.5), sp, ph), scoreMesh(smoothSurface(im, ...dims, sp, 500, false).mesh, sp, ph)],
    ] as const;
    for (const [id, oneGrid, f5] of paths) {
      const got = `${id}: ${oneGrid.meanErr.toFixed(3)} mm / ${oneGrid.normalDevDeg.toFixed(1)}° → ${f5.meanErr.toFixed(3)} / ${f5.normalDevDeg.toFixed(1)}°`;
      assert.ok(f5.meanErr < oneGrid.meanErr && f5.normalDevDeg < oneGrid.normalDevDeg, got);
      assert.ok(f5.meanErr <= sp[2] / 10 && f5.normalDevDeg <= 13, got);
    }
  });

  it('falls back to the one-grid path when the interpolated grid would not fit', () => {
    const [, ph, dims, sp] = THICK[0]!;
    const m = sampleMask(ph, dims, sp);
    const t = thickSliceNets(m, ...dims, sp, 0.5, { maxVoxels: 1000 });
    assert.equal(t.factor, 1);
    assert.deepEqual(t.mesh.positions, maskNets(m, ...dims).positions);
  });
});
