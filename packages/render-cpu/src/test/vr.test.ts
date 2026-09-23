import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { presetTF, sampleTF, TF_PRESETS, validateTF } from '../tf.js';
import { intersectAABB, renderVolume } from '../vr.js';

const OPAQUE: import('../tf.js').TF = [
  { value: 0, color: [200, 100, 50], opacity: 1 },
  { value: 10, color: [200, 100, 50], opacity: 1 },
];

describe('transfer function', () => {
  it('samples exact stops, lerps segments, clamps ends', () => {
    const tf = [
      { value: 0, color: [0, 0, 0] as [number, number, number], opacity: 0 },
      { value: 10, color: [100, 200, 50] as [number, number, number], opacity: 1 },
    ];
    assert.deepEqual(sampleTF(tf, 0), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(sampleTF(tf, 10), { r: 100, g: 200, b: 50, a: 1 });
    assert.deepEqual(sampleTF(tf, 5), { r: 50, g: 100, b: 25, a: 0.5 });
    assert.deepEqual(sampleTF(tf, -99), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(sampleTF(tf, 99), { r: 100, g: 200, b: 50, a: 1 });
    assert.deepEqual(sampleTF([], 5), { r: 0, g: 0, b: 0, a: 0 });
  });
  it('presets span the data range with valid stops', () => {
    for (const name of TF_PRESETS) {
      const tf = presetTF(name, -100, 900);
      assert.ok(tf.length >= 2, name);
      assert.equal(tf[0]!.value, -100);
      assert.equal(tf[tf.length - 1]!.value, 900);
      assert.deepEqual(validateTF(tf), [], name);
    }
  });
  it('validates broken functions', () => {
    assert.ok(validateTF([{ value: 0, color: [0, 0, 0], opacity: 0 }]).length > 0);
    assert.ok(validateTF([
      { value: 0, color: [0, 0, 0], opacity: 2 },
      { value: 1, color: [0, 0, 0], opacity: 0 },
    ]).some((e) => e.includes('opacity')));
  });
});

function solid(dims: [number, number, number], v: number) {
  const [nx, ny, nz] = dims;
  return { dims, data: new Float64Array(nx * ny * nz).fill(v) };
}

describe('aabb', () => {
  it('hits, misses, and handles parallel rays', () => {
    const min: [number, number, number] = [2, 2, 2];
    const max: [number, number, number] = [6, 6, 6];
    assert.deepEqual(intersectAABB([0, 4, 4], [1, 0, 0], min, max), [2, 6]);
    assert.equal(intersectAABB([0, 0, 0], [1, 0, 0], min, max), null);
    assert.deepEqual(intersectAABB([4, 0, 4], [0, 1, 0], min, max), [2, 6]);
    assert.equal(intersectAABB([0, 0, 4], [0, 1, 0], min, max), null); // parallel, outside slab
  });
  it('bounded render matches unbounded render', () => {
    const vol = solid([12, 12, 12], 0);
    vol.data[6 * 144 + 6 * 12 + 6] = 10;
    const base = {
      width: 24, height: 24, angleY: 0.4, tiltX: 0.2, tf: OPAQUE, step: 1, shade: false,
    };
    const a = renderVolume(vol, base).rgba;
    const b = renderVolume(vol, {
      ...base, bounds: { min: [0, 0, 0], max: [12, 12, 12] },
    }).rgba;
    assert.deepEqual(a, b);
  });
});

describe('physical spacing', () => {
  // An 8 mm cube on a 1 × 1 × 2 mm grid: x, y voxels 4..11, z voxels 2..5.
  // Trilinear crossings of the 5-threshold sit half a voxel out on each side,
  // so the cube is exactly 8 mm on every axis.
  const CUBE_TF = [
    { value: 0, color: [200, 100, 50] as [number, number, number], opacity: 0 },
    { value: 4.99, color: [200, 100, 50] as [number, number, number], opacity: 0 },
    { value: 5, color: [200, 100, 50] as [number, number, number], opacity: 1 },
    { value: 10, color: [200, 100, 50] as [number, number, number], opacity: 1 },
  ];
  const dims: [number, number, number] = [16, 16, 8];
  const cube = solid(dims, 0);
  for (let z = 2; z < 6; z++) {
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) cube.data[z * 256 + y * 16 + x] = 10;
    }
  }
  /** Opaque run lengths through the image centre: [across, down]. */
  const extent = (rgba: Uint8ClampedArray, w: number, h: number): [number, number] => {
    const lit = (x: number, y: number): boolean => rgba[(y * w + x) * 4] !== 17;
    let across = 0, down = 0;
    for (let x = 0; x < w; x++) if (lit(x, h >> 1)) across++;
    for (let y = 0; y < h; y++) if (lit(w >> 1, y)) down++;
    return [across, down];
  };
  // orbit 90°: z runs across the screen, y down it
  const side = { width: 64, height: 64, angleY: Math.PI / 2, tiltX: 0, tf: CUBE_TF, step: 0.5, shade: false };

  it('unit spacing is bit-identical to the voxel-space render', () => {
    const base = { width: 24, height: 24, angleY: 0.4, tiltX: 0.2, tf: CUBE_TF, step: 1, shade: true };
    assert.deepEqual(
      renderVolume(cube, { ...base, spacing: [1, 1, 1] }).rgba,
      renderVolume(cube, base).rgba,
    );
    const bounds = { min: [2, 2, 0] as [number, number, number], max: [14, 14, 8] as [number, number, number] };
    assert.deepEqual(
      renderVolume(cube, { ...base, bounds, spacing: [1, 1, 1] }).rgba,
      renderVolume(cube, { ...base, bounds }).rgba,
    );
  });
  it('an anisotropic grid renders at physical proportions', () => {
    const r = renderVolume(cube, { ...side, spacing: [1, 1, 2] });
    const [across, down] = extent(r.rgba, r.w, r.h);
    assert.ok(down > 20, `cube visible (${down} px)`);
    assert.ok(Math.abs(across - down) <= 2, `8 mm × 8 mm drew ${across} × ${down} px`);
  });
  it('without spacing the same grid is squashed to voxel units', () => {
    const r = renderVolume(cube, side);
    const [across, down] = extent(r.rgba, r.w, r.h);
    assert.ok(Math.abs(across / down - 0.5) < 0.1, `4 of 8 voxels deep: ${across} × ${down} px`);
  });
  it('voxel bounds clip in mm: bounded matches unbounded', () => {
    const opts = { ...side, angleY: 1.1, tiltX: 0.3, spacing: [1, 1, 2] as [number, number, number] };
    assert.deepEqual(
      renderVolume(cube, { ...opts, bounds: { min: [0, 0, 0], max: [16, 16, 8] } }).rgba,
      renderVolume(cube, opts).rgba,
    );
  });
  it('rejects spacing that is not positive', () => {
    assert.throws(() => renderVolume(cube, { ...side, spacing: [1, 0, 2] }), /vr-spacing/);
    assert.throws(() => renderVolume(cube, { ...side, spacing: [1, Number.NaN, 2] }), /vr-spacing/);
  });
});

describe('raycaster', () => {
  it('renders background for empty volumes', () => {
    const { rgba } = renderVolume(solid([8, 8, 8], 0), {
      width: 16, height: 16, angleY: 0, tiltX: 0,
      // value 0 samples the transparent first stop (clamped ends)
      tf: [{ value: 0, color: [255, 0, 0], opacity: 0 }, { value: 10, color: [255, 0, 0], opacity: 1 }],
      step: 2, shade: false,
    });
    assert.ok(rgba.every((x, i) => (i % 4 === 3 ? x === 255 : x === 17)));
  });
  it('fills an opaque uniform volume with the TF color', () => {
    const { rgba, w, h } = renderVolume(solid([8, 8, 8], 7), {
      width: 16, height: 16, angleY: 0.7, tiltX: 0.3, tf: OPAQUE, step: 1, shade: false,
    });
    const c = (w / 2) * w + (h / 2);
    void c;
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const o = (cy * w + cx) * 4;
    assert.ok(rgba[o]! > 150 && rgba[o + 1]! > 50, `center ${rgba[o]},${rgba[o + 1]},${rgba[o + 2]}`);
    // corners look past the cube
    assert.equal(rgba[0], 17);
  });
  it('is left-right symmetric for a centered sphere', () => {
    // Odd grid: lattice 0..16 IS symmetric about the rotation center 8.5,
    // so mirrored rays sample mirrored neighborhoods with mirrored weights.
    // (Even grids cannot mirror exactly: 0..15 is asymmetric about 8.)
    const n = 17;
    const SPHERE_TF = [
      { value: 0, color: [0, 0, 0] as [number, number, number], opacity: 0 },
      { value: 5, color: [200, 100, 50] as [number, number, number], opacity: 1 },
      { value: 10, color: [200, 100, 50] as [number, number, number], opacity: 1 },
    ];
    const data = new Float64Array(n * n * n);
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const d = Math.hypot(x - 8.5, y - 8.5, z - 8.5);
          data[z * n * n + y * n + x] = d < 5 ? 10 - d : 0;
        }
      }
    }
    // odd width => exact pixel mirror (even widths offset the mirror by half a voxel)
    const { rgba, w, h } = renderVolume({ dims: [n, n, n], data }, {
      width: 33, height: 32, angleY: 0, tiltX: 0, tf: SPHERE_TF, step: 1, shade: false,
    });
    for (let y = 0; y < h; y++) {
      for (let x = 1; x <= Math.floor(w / 2); x++) {
        const a = (y * w + x) * 4, b = (y * w + (w - x)) * 4;
        assert.equal(rgba[a], rgba[b], `row ${y} col ${x}`);
        assert.equal(rgba[a + 1], rgba[b + 1]);
        assert.equal(rgba[a + 2], rgba[b + 2]);
      }
    }
  });
});
