import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  burnedPixelFraction, checkOrientation, compressionWarning, phantomCheck,
  screenBurnedPixels, summarizeDose,
} from '../safety.js';
import { parseDicomSlice } from '@carys/io';

describe('safety screens', () => {
  it('burned pixels: fraction exact, threshold flags, empties loud', () => {
    const frame = [0, 0, 4095, 4095, 100, 200]; // 2/6 at ceiling
    assert.ok(Math.abs(burnedPixelFraction(frame, 4095) - 2 / 6) < 1e-12);
    assert.deepEqual(screenBurnedPixels(frame, 4095, 0.001), { fraction: 2 / 6, flagged: true });
    assert.equal(screenBurnedPixels(frame, 4095, 0.5).flagged, false);
    assert.equal(screenBurnedPixels([1, 2, 3], 4095).flagged, false);
    assert.throws(() => burnedPixelFraction([], 4095), /burned-empty-frame/);
    assert.throws(() => burnedPixelFraction(frame, NaN), /burned-bad-ceiling/);
  });
  it('orientation: ok path + every reject names its axis', () => {
    assert.deepEqual(checkOrientation([4, 4, 8], [0.5, 0.5, 2]), { ok: true, reason: '' });
    assert.match(checkOrientation([0, 4, 8], [1, 1, 1]).reason, /dims\[0\]/);
    assert.match(checkOrientation([4, 4, 8], [1, -1, 1]).reason, /spacing\[1\]/);
    assert.match(checkOrientation([4, 4, 8], [1, NaN, 1]).reason, /spacing\[1\]/);
    assert.match(checkOrientation([4, 4, 1], [1, 1, 1]).reason, /axial slice/);
  });
  it('dose: numbers pass, junk becomes null (never guessed)', () => {
    assert.deepEqual(summarizeDose({ ctdivol: 12.5, dlp: 400, kvp: 120 }), { ctdivol: 12.5, dlp: 400, kvp: 120 });
    assert.deepEqual(summarizeDose({ ctdivol: 'high', dlp: -3, kvp: NaN }), { ctdivol: null, dlp: null, kvp: null });
    assert.deepEqual(summarizeDose({}), { ctdivol: null, dlp: null, kvp: null });
  });
  it('compression: known syntaxes named, unknown never silent', () => {
    assert.match(compressionWarning('1.2.840.10008.1.2.1'), /^none/);
    assert.match(compressionWarning('1.2.840.10008.1.2.4.50'), /^lossy/);
    assert.match(compressionWarning('9.9.9.made-up'), /^unknown/);
    assert.match(compressionWarning(null), /^unknown/);
  });
  it('phantom: tolerance band exact, bad inputs loud', () => {
    assert.equal(phantomCheck(5, 0, 10), true);
    assert.equal(phantomCheck(11, 0, 10), false);
    assert.throws(() => phantomCheck(NaN, 0, 10), /phantom-nonfinite-input/);
    assert.throws(() => phantomCheck(0, 0, -1), /phantom-negative-tolerance/);
  });
  it('R1 phantom-qc.dcm: real bytes through rescale into the tolerance band', () => {
    // Pinned pydicom bytes (test/e2e/foundry/phantom-qc.dcm): 16x16 water
    // at stored 1024 (= 0 HU via slope 1 / intercept -1024) with a 4x4
    // +100 HU insert at stored 1124. study cannot decode alone (io owns
    // pixels) — the import above is type+value, mirroring pathogens.test.
    const raw = readFileSync(join(process.cwd(), 'test', 'e2e', 'foundry', 'phantom-qc.dcm'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const { slice, meta } = parseDicomSlice(buf);
    assert.equal(meta.rows, 16);
    assert.equal(meta.cols, 16);
    assert.equal(slice.pixelData.length, 256);
    const at = (r: number, c: number): number => slice.pixelData[r * 16 + c]!;
    assert.equal(at(0, 0), 0); // water background in HU
    assert.equal(at(7, 7), 100); // insert center in HU
    const bg: number[] = [];
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        if (r < 6 || r > 9 || c < 6 || c > 9) bg.push(at(r, c));
      }
    }
    const mean = bg.reduce((a, b) => a + b, 0) / bg.length;
    assert.equal(mean, 0);
    assert.equal(phantomCheck(mean, 0, 5), true);
    assert.equal(phantomCheck(mean, 0, 0), true);
    assert.equal(phantomCheck(at(7, 7), 0, 5), false);
  });
});
