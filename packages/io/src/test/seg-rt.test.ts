import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRTSTRUCT, rtToMasks, writeRTSTRUCT } from '../rtstruct.js';
import { parseSEG, segToMasks, unpackFrame, writeSEG } from '../seg.js';
import { mulberry32 } from './rng.js';

function blob(dims: [number, number, number], seed: number, p: number): Uint8Array {
  const rng = mulberry32(seed);
  const m = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let i = 0; i < m.length; i++) m[i] = rng() < p ? 1 : 0;
  return m;
}

function dice(a: Uint8Array, b: Uint8Array): number {
  let inter = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) na++;
    if (b[i]) nb++;
    if (a[i] && b[i]) inter++;
  }
  if (na + nb === 0) return 1;
  return (2 * inter) / (na + nb);
}

describe('SEG round-trip', () => {
  it('single segment exact (odd cols stress bit packing)', () => {
    const dims: [number, number, number] = [13, 9, 4]; // 13 cols: byte padding
    const mask = blob(dims, 7, 0.3);
    const buf = writeSEG({ segments: [{ label: 'Tumor', mask }], dims });
    const seg = parseSEG(buf);
    assert.equal(seg.segments.length, 1);
    assert.equal(seg.segments[0]!.label, 'Tumor');
    assert.equal(seg.frames.length, 4);
    assert.equal(seg.rows, 9);
    assert.equal(seg.cols, 13);
    const back = segToMasks(seg, { dims, sliceZs: [0, 1, 2, 3] });
    assert.deepEqual(back.get(1), mask);
  });
  it('multi-segment round-trip exact', () => {
    const dims: [number, number, number] = [8, 8, 3];
    const a = blob(dims, 11, 0.4);
    const b = blob(dims, 22, 0.25);
    const buf = writeSEG({ segments: [{ label: 'A', mask: a }, { label: 'B', mask: b }], dims });
    const seg = parseSEG(buf);
    assert.equal(seg.frames.length, 6);
    const back = segToMasks(seg, { dims, sliceZs: [0, 1, 2] });
    assert.deepEqual(back.get(1), a);
    assert.deepEqual(back.get(2), b);
  });
  it('empty frames survive', () => {
    const dims: [number, number, number] = [6, 6, 3];
    const buf = writeSEG({ segments: [{ label: 'E', mask: new Uint8Array(108) }], dims });
    const back = segToMasks(parseSEG(buf), { dims, sliceZs: [0, 1, 2] });
    assert.ok(back.get(1)!.every((v) => v === 0));
  });
  it('rejects non-SEG', () => {
    assert.throws(() => parseSEG(new ArrayBuffer(200)), /not a SEG|truncated|boundary|expected|tag/i);
  });
  it('unpackFrame bit order (MSB first)', () => {
    // cols=10 -> stride 2; first byte 0b10000000 => only col 0 set
    const bits = new Uint8Array([0b10000000, 0b00000000]);
    const out = unpackFrame(bits, 10, 1);
    assert.equal(out[0], 1);
    assert.ok(out.slice(1).every((v) => v === 0));
  });
});

describe('RTSTRUCT round-trip', () => {
  it('8 discs round-trip at dice > 0.93', () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 8; t++) {
      const n = 24 + (t % 3) * 4;
      const dims: [number, number, number] = [n, n, 3];
      const mask = new Uint8Array(n * n * 3);
      const cx = n / 2 + (rng() - 0.5) * 4;
      const cy = n / 2 + (rng() - 0.5) * 4;
      const r = n / 4;
      for (let z = 0; z < 3; z++) {
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            if (Math.hypot(x - cx, y - cy) <= r) mask[z * n * n + y * n + x] = 1;
          }
        }
      }
      const buf = writeRTSTRUCT({ rois: [{ name: `Disc${t}`, mask }], dims });
      const rt = parseRTSTRUCT(buf);
      assert.equal(rt.rois[0]!.name, `Disc${t}`, `case ${t}`);
      assert.ok(rt.contours.length >= 3, `case ${t}: ${rt.contours.length} contours`);
      const back = rtToMasks(rt, { dims });
      const d = dice(back.get(1)!, mask);
      assert.ok(d > 0.93, `case ${t}: dice ${d}`);
    }
  });
  it('multi-ROI names + empty slices skipped', () => {
    const dims: [number, number, number] = [10, 10, 4];
    const a = new Uint8Array(400);
    const b = new Uint8Array(400);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) a[1 * 100 + y * 10 + x] = 1;
    for (let y = 6; y <= 8; y++) for (let x = 6; x <= 8; x++) b[2 * 100 + y * 10 + x] = 1;
    const buf = writeRTSTRUCT({ rois: [{ name: 'A', mask: a }, { name: 'B', mask: b }], dims });
    const rt = parseRTSTRUCT(buf);
    assert.deepEqual(rt.rois.map((r) => r.name), ['A', 'B']);
    const back = rtToMasks(rt, { dims });
    assert.equal(back.size, 2);
    assert.ok(dice(back.get(1)!, a) > 0.9);
    assert.ok(dice(back.get(2)!, b) > 0.9);
  });
  it('rejects non-RTSTRUCT', () => {
    assert.throws(() => parseRTSTRUCT(new ArrayBuffer(200)), /not an RTSTRUCT|truncated|tag|expected/i);
  });
});

describe('RTSTRUCT fidelity', () => {
  it('donut hole survives the round trip (even-odd fill)', () => {
    const n = 24;
    const dims: [number, number, number] = [n, n, 1];
    const mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - n / 2, y - n / 2);
        if (d <= 9 && d >= 4) mask[y * n + x] = 1;
      }
    }
    const buf = writeRTSTRUCT({ rois: [{ name: 'Donut', mask }], dims });
    const back = rtToMasks(parseRTSTRUCT(buf), { dims });
    const m = back.get(1)!;
    // center stays empty, ring stays full
    assert.equal(m[Math.floor(n / 2) * n + Math.floor(n / 2)], 0);
    assert.equal(m[Math.floor(n / 2) * n + Math.floor(n / 2) + 6], 1);
    assert.ok(dice(m, mask) > 0.9, `donut dice ${dice(m, mask)}`);
  });
});
