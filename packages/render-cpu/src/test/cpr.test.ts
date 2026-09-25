import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import { centerlineLength, cprPath, cprVoxel, straightenedCpr, type V3 } from '../cpr.js';

// A straightened view along a clicked centreline.

const WL = { width: 1100, center: 500 };
const SP: V3 = [0.8, 0.8, 2];
const R = 30, CX = 38, CY = 38, CZ = 16, A0 = 0.2, A1 = 0.2 + (2 * Math.PI) / 3;

/** A 6 mm tube bent along a 120° arc of radius 30 mm, in the plane z = 16 mm,
 *  on 0.8 × 0.8 × 2 mm voxels (voxel i's centre at i × spacing). */
function arcTube(): Volume {
  const dims: V3 = [96, 96, 16];
  const data = new Float64Array(dims[0] * dims[1] * dims[2]);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    const X = x * SP[0] - CX, Y = y * SP[1] - CY, Z = z * SP[2] - CZ;
    const phi = Math.min(A1, Math.max(A0, Math.atan2(Y, X)));
    const d = Math.hypot(X - R * Math.cos(phi), Y - R * Math.sin(phi), Z);
    data[(z * dims[1] + y) * dims[0] + x] = d < 3 ? 1000 : 0;
  }
  return { dims, spacing: SP, origin: [0, 0, 0], dtype: 'float64', data };
}

/** Voxel point at angle `a` on the arc. */
const onArc = (a: number): V3 => [(CX + R * Math.cos(a)) / SP[0], (CY + R * Math.sin(a)) / SP[1], CZ / SP[2]];
/** Five clicks along the arc, ends included. */
const CLICKS: V3[] = [0, 1, 2, 3, 4].map((k) => onArc(A0 + ((A1 - A0) * k) / 4));

describe('curved reformat (F16)', () => {
  const vol = arcTube();

  it('centerline length exact, spacing-aware, loud on bad input', () => {
    assert.equal(centerlineLength([[0, 0, 0], [3, 4, 0]], [1, 1, 1]).total, 5);
    assert.equal(centerlineLength([[0, 0, 0], [1, 0, 0]], [0.5, 1, 2]).total, 0.5);
    assert.throws(() => centerlineLength([[0, 0, 0]], [1, 1, 1]), /cpr-centerline/);
    assert.throws(() => centerlineLength([[0, 0, 0], [1, 0, 0]], [0, 1, 1]), /cpr-spacing/);
  });

  it('five clicks on an arc follow the arc, in millimetres', () => {
    const c = straightenedCpr(vol, CLICKS, WL, { step: 0.8, halfWidth: 12, up: [0, 0, 1] });
    const arc = R * (A1 - A0);
    assert.ok(Math.abs(c.length - arc) / arc < 0.005, `length ${c.length.toFixed(2)} mm vs ${arc.toFixed(2)}`);
    // every station within 0.15 mm of the circle (measured 0.142, in the
    // end segments; the clicks' polyline cuts corners by R(1 − cos 15°) =
    // 1.02 mm)
    let worst = 0;
    for (const q of c.stations) worst = Math.max(worst, Math.abs(Math.hypot(q[0] * SP[0] - CX, q[1] * SP[1] - CY) - R));
    assert.ok(worst < 0.15, `off the arc by ${worst.toFixed(3)} mm`);
    // the panes draw the same curve the view follows
    const path = cprPath(CLICKS, SP, 0.8);
    assert.equal(path.length, c.width + 1, 'a point per column, and the last click');
    assert.deepEqual(path.slice(0, c.width), c.stations);
    // the clicks land on their columns
    c.knots.forEach((k, i) => {
      const q = c.stations[k]!, p = CLICKS[i]!;
      assert.ok(Math.hypot((q[0] - p[0]) * SP[0], (q[1] - p[1]) * SP[1], (q[2] - p[2]) * SP[2]) <= 0.8, `click ${i}`);
    });
  });

  it('straightens the tube into a band along the middle row, as well as the exact centreline does', () => {
    /** Worst band centre off the middle row, and worst band width error, mm. */
    const band = (pts: V3[]): [number, number] => {
      const c = straightenedCpr(vol, pts, WL, { step: 0.8, halfWidth: 12, up: [0, 0, 1] });
      const mid = (c.height - 1) / 2;
      let offCentre = 0, widthErr = 0;
      // away from the rounded ends
      for (let x = 6; x < c.width - 6; x++) {
        let w = 0, m = 0, n = 0;
        for (let r = 0; r < c.height; r++) {
          const g = c.rgba[(r * c.width + x) * 4]!;
          w += g; m += g * r;
          if (g > 127) n++;
        }
        offCentre = Math.max(offCentre, Math.abs(m / w - mid) * c.step);
        widthErr = Math.max(widthErr, Math.abs(n * c.step - 6));
      }
      return [offCentre, widthErr];
    };
    // the floor is the voxelized tube itself: 61 points on the exact arc
    const [exactOff, exactWidth] = band(Array.from({ length: 61 }, (_, k) => onArc(A0 + ((A1 - A0) * k) / 60)));
    const [off, width] = band(CLICKS);
    assert.ok(off <= exactOff + 0.05, `band off centre by ${off.toFixed(2)} mm (exact centreline ${exactOff.toFixed(2)})`);
    assert.ok(width <= exactWidth + 0.01, `band width off by ${width.toFixed(1)} mm (exact ${exactWidth.toFixed(1)})`);
  });

  it('turns about the curve, and maps pixels back to voxels', () => {
    const flat = straightenedCpr(vol, CLICKS, WL, { step: 0.8, halfWidth: 12, up: [0, 0, 1] });
    const turned = straightenedCpr(vol, CLICKS, WL, { step: 0.8, halfWidth: 12, up: [0, 0, 1], angle: Math.PI / 2 });
    const x = Math.floor(flat.width / 2), mid = (flat.height - 1) / 2;
    // a quarter turn goes across along z: the far rows leave the slab the tube is in
    const flatCol = flat.across[x]!, turnedCol = turned.across[x]!;
    assert.ok(Math.abs(flatCol[2]) < 1e-9 && Math.abs(turnedCol[2] * SP[2]) > 0.999, 'across in the plane, then along z');
    assert.deepEqual(cprVoxel(flat, x, mid), flat.stations[x]);
    const top = cprVoxel(flat, x, 0), q = flat.stations[x]!;
    const mm = Math.hypot((top[0] - q[0]) * SP[0], (top[1] - q[1]) * SP[1], (top[2] - q[2]) * SP[2]);
    assert.ok(Math.abs(mm - mid * 0.8) < 1e-9, `row 0 is ${mm} mm out`);
  });

  it('a curve along the pane normal still has an across', () => {
    const c = straightenedCpr(vol, [onArc(1), [onArc(1)[0], onArc(1)[1], 1], [onArc(1)[0] + 3, onArc(1)[1], 0]], WL, { step: 0.8, halfWidth: 4, up: [0, 0, 1] });
    for (const a of c.across) assert.ok(a.every(Number.isFinite) && Math.hypot(a[0] * SP[0], a[1] * SP[1], a[2] * SP[2]) > 0.99);
  });

  it('bad geometry throws named errors', () => {
    assert.throws(() => straightenedCpr(vol, CLICKS, WL, { step: 0, halfWidth: 4, up: [0, 0, 1] }), /cpr-step/);
    assert.throws(() => straightenedCpr(vol, CLICKS, WL, { step: 1, halfWidth: 0.5, up: [0, 0, 1] }), /cpr-width/);
    assert.throws(() => straightenedCpr(vol, CLICKS, WL, { step: 1, halfWidth: 4, up: [0, 0, 0] }), /cpr-up/);
    assert.throws(() => straightenedCpr(vol, [CLICKS[0]!, CLICKS[0]!], WL, { step: 1, halfWidth: 4, up: [0, 0, 1] }), /cpr-centerline/);
  });
});
