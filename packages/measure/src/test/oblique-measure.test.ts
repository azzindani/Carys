import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cobbAngle3, obliqueEllipseStats, obliquePixelArea, obliqueRectStats,
  obliqueTapVoxel, type ObliqueFrame,
} from '../oblique-measure.js';
import { ellipseStats, roiStats } from '../roi.js';
import { mulberry32 } from './rng.js';

function testVol() {
  const nx = 8, ny = 7, nz = 5;
  const data = new Float64Array(nx * ny * nz);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  return {
    dims: [nx, ny, nz] as [number, number, number],
    spacing: [1, 2, 3] as [number, number, number],
    origin: [0, 0, 0] as [number, number, number],
    dtype: 'float64' as const, data,
  };
}

/** Orthogonal frame for slice z on an 8×7×5 volume (W=nx, H=ny). */
function axialFrame(z: number): ObliqueFrame {
  return { center: [8 / 2, 7 / 2, z], row: [1, 0, 0], col: [0, 1, 0] };
}

/**
 * Pure-yaw frame, written out by hand (not via obliqueBasis, so the test
 * stays an independent oracle and measure gains no render-cpu edge):
 * b=0.3 → row=[cos b, 0, −sin b], col=[0,1,0], normal=[sin b, 0, cos b].
 */
function yawFrame(): { frame: ObliqueFrame; b: number } {
  const b = 0.3;
  return {
    frame: {
      center: [4, 3.5, 2],
      row: [Math.cos(b), 0, -Math.sin(b)],
      col: [0, 1, 0],
    },
    b,
  };
}

describe('oblique measure', () => {
  it('tap inverse is exact on the orthogonal frame', () => {
    const f = axialFrame(2);
    for (const [i, j] of [[0, 0], [7, 6], [3.5, 2.5]] as [number, number][]) {
      const [x, y, z] = obliqueTapVoxel(f, 8, 7, i, j);
      assert.ok(Math.abs(x - i) < 1e-9 && Math.abs(y - j) < 1e-9 && z === 2, `${i},${j}`);
    }
  });
  it('tap inverse on a tilted frame loses only the out-of-plane offset', () => {
    const { frame: g } = yawFrame();
    const { row, col } = g;
    const rng = mulberry32(5);
    for (let t = 0; t < 20; t++) {
      const x = rng() * 8, y = rng() * 7, z = rng() * 5;
      // project onto the frame, then invert
      const dx = x - g.center[0], dy = y - g.center[1], dz = z - g.center[2];
      const i = dx * row[0] + dy * row[1] + dz * row[2] + 8 / 2;
      const j = dx * col[0] + dy * col[1] + dz * col[2] + 7 / 2;
      const [bx, by, bz] = obliqueTapVoxel(g, 8, 7, i, j);
      // residual is parallel to the frame normal: no in-plane component
      const rx = bx - x, ry = by - y, rz = bz - z;
      const dotR = rx * row[0] + ry * row[1] + rz * row[2];
      const dotC = rx * col[0] + ry * col[1] + rz * col[2];
      assert.ok(Math.abs(dotR) < 1e-9 && Math.abs(dotC) < 1e-9, `case ${t}: in-plane lost`);
    }
  });
  it('pixel area: orthogonal reproduces su*sv, yaw matches the hand-derived area', () => {
    const sp: [number, number, number] = [0.5, 0.5, 2];
    assert.ok(Math.abs(obliquePixelArea(axialFrame(1), sp) - 0.25) < 1e-12);
    const { frame: g, b } = yawFrame();
    // R=(sx·cb, 0, −sz·sb), C=(0, sy, 0): R×C=(sz·sy·sb, 0, sx·sy·cb)
    const sb = Math.sin(b), cb = Math.cos(b);
    const want = 0.5 * Math.sqrt((2 * sb) ** 2 + (0.5 * cb) ** 2);
    assert.ok(Math.abs(obliquePixelArea(g, sp) - want) < 1e-9, `${obliquePixelArea(g, sp)} vs ${want}`);
    assert.ok(obliquePixelArea(g, sp) > 0.25, 'tilt grows the pixel footprint');
  });
  it('zero tilt: rect + ellipse reproduce the orthogonal slice stats', () => {
    const v = testVol();
    const f = axialFrame(2);
    assert.deepEqual(obliqueRectStats(v, f, 8, 7, 1, 1, 2, 2), roiStats(v, 1, 1, 2, 2, 2));
    assert.deepEqual(
      obliqueEllipseStats(v, f, 8, 7, 3.5, 3, 2.5, 2),
      ellipseStats(v, 'axial', 2, 3.5, 3, 2.5, 2),
    );
    const bad = obliqueEllipseStats(v, f, 8, 7, 3, 3, 0, 2);
    assert.equal(bad.count, 0);
    assert.ok(Number.isNaN(bad.mean));
  });
  it('tilted stats: voxels distinct, count bounded, ellipse inside rect', () => {
    const v = testVol();
    const { frame: g } = yawFrame();
    const r = obliqueRectStats(v, g, 8, 7, 0, 0, 7, 6);
    assert.ok(r.count > 0 && r.count <= 8 * 7 * 5, `count ${r.count}`);
    assert.ok(r.std >= 0 && Number.isFinite(r.mean) && r.min <= r.max, 'sane moments');
    const e = obliqueEllipseStats(v, g, 8, 7, 4, 3.5, 3, 2.5);
    assert.ok(e.count > 0 && e.count <= r.count, `ellipse ${e.count} inside rect ${r.count}`);
  });
  it('cobbAngle3: axis cases exact, spacing-aware, bounded random', () => {
    const sp: [number, number, number] = [1, 1, 1];
    assert.ok(cobbAngle3([0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0], sp) - 90 < 1e-9);
    assert.ok(cobbAngle3([0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0], sp) < 1e-9);
    assert.ok(Math.abs(cobbAngle3([0, 0, 0], [1, 1, 0], [0, 0, 0], [1, -1, 0], sp) - 90) < 1e-9);
    // spacing-aware: x-compressed 2:1 turns 45° into atan(1/0.5)
    const sq: [number, number, number] = [0.5, 1, 1];
    const g = cobbAngle3([0, 0, 0], [1, 0, 0], [0, 0, 0], [1, 1, 0], sq);
    assert.ok(Math.abs(g - (Math.atan2(1, 0.5) * 180) / Math.PI) < 1e-9, `${g}`);
    const rng = mulberry32(31);
    for (let t = 0; t < 20; t++) {
      const p = (): [number, number, number] => [rng() * 10 - 5, rng() * 10 - 5, 2];
      const a = cobbAngle3(p(), p(), p(), p(), sp);
      assert.ok(a >= 0 && a <= 90, `case ${t}: ${a}`);
    }
  });
});
