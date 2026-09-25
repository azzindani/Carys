import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bodyBounds, packBody, unpackBody, type BodyPart } from '../body-pack.js';

// The whole-body atlas package format.

/** A part: an n × n grid of vertices, two triangles a cell. */
function grid(element: string, n: number, at: [number, number, number], size: number): BodyPart {
  const positions = new Float32Array(n * n * 3), idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    positions.set([at[0] + (i / (n - 1)) * size, at[1] + (j / (n - 1)) * size, at[2] + Math.sin(i + j) * 3], (j * n + i) * 3);
    if (i < n - 1 && j < n - 1) idx.push(j * n + i, j * n + i + 1, (j + 1) * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i);
  }
  return {
    fma: `FMA${element.slice(2)}`, element, name: `part ${element}`, system: 'skeletal',
    sourceTris: idx.length / 3 * 4, errorMm: 0.25, positions, indices: Uint32Array.from(idx),
  };
}

describe('the body atlas package (H1)', () => {
  const parts = [grid('FJ1', 20, [-300, -200, 0], 400), grid('FJ2', 7, [120, 40, 1500], 90), grid('FJ3', 300, [-250, -150, 200], 500)];
  parts[1]!.system = 'nervous';
  const packed = packBody(parts);
  const back = unpackBody(packed);

  it('round-trips parts, their metadata and their triangles', () => {
    assert.equal(back.parts.length, 3);
    back.parts.forEach((p, n) => {
      const q = parts[n]!;
      assert.deepEqual({ ...p, positions: 0, indices: 0 }, { ...q, positions: 0, indices: 0 });
      assert.deepEqual([...p.indices], [...q.indices]);
    });
    assert.equal(back.parts[2]!.positions.length / 3, 90000, 'a part past 65,536 vertices keeps 32-bit indices');
  });

  it('moves no coordinate more than half a quantization step', () => {
    const { min, max } = bodyBounds(parts);
    const half = [0, 1, 2].map((k) => (max[k]! - min[k]!) / 65535 / 2);
    let worst = 0;
    back.parts.forEach((p, n) => p.positions.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - parts[n]!.positions[i]!) / half[i % 3]!); }));
    assert.ok(worst <= 1.0001, `${worst.toFixed(4)} of half a step`);
  });

  it('shares one grid when given the bounds', () => {
    const b = { min: [-1000, -1000, -100] as [number, number, number], max: [1000, 1000, 1900] as [number, number, number] };
    const one = unpackBody(packBody([parts[1]!], b));
    assert.deepEqual([one.min, one.max], [b.min, b.max]);
    assert.throws(() => packBody([parts[1]!], { min: [0, 0, 0], max: [1, 1, 1] }), /body-pack-outside/);
  });

  it('fails loud on anything malformed', () => {
    assert.throws(() => unpackBody(new Uint8Array(16)), /body-pack-magic/);
    const v2 = packed.slice(); new DataView(v2.buffer).setUint32(4, 2, true);
    assert.throws(() => unpackBody(v2), /body-pack-version/);
    assert.throws(() => unpackBody(packed.slice(0, packed.length - 8)), /body-pack-truncated/);
    const bad = { ...parts[1]!, indices: Uint32Array.from([0, 1, 999]) };
    assert.throws(() => packBody([bad]), /body-pack-index/);
  });
});
