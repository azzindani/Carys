import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import type { BinaryFile } from '@carys/volume-core';
import { readDicomSeries, sortSlicesByPosition, stackVolumes, zSpacing } from '../dicom-series.js';
import { groupGeometry, readFunctionalGroups } from '../dicom-groups.js';
import { isMeshFile, loaderHint } from '../formats.js';
import { runImportChain, SKIP, type ImportHandler } from '../import.js';
import { DataSourceRegistry, defaultRegistry } from '../providers.js';
import { classifySource, getNgffAxes, resolveAttrs } from '../ome-classify.js';
import { parseOmeroMeta } from '../ome-meta.js';
import {
  buildHuffmanTable, decodeBaselineScan, JpegBitReader, JpegError, ZIGZAG,
} from '../jpeg-scan.js';
import { makeUID, writePart10 } from '../dcm-write.js';
import type { DataSource } from '@carys/volume-core';

function slab(nx: number, ny: number, nz: number, fill: number, dtype: Volume['dtype'] = 'uint8'): Volume {
  const n = nx * ny * nz;
  const data = dtype === 'int16' ? new Int16Array(n).fill(fill)
    : dtype === 'float32' ? new Float32Array(n).fill(fill)
    : new Uint8Array(n).fill(fill);
  return { dims: [nx, ny, nz], spacing: [1, 1, 1], origin: [0, 0, 0], dtype, data };
}

function classicFrame(sliceLocation: number, frames = 1): ArrayBuffer {
  const px = new Uint8Array(2 * 2 * frames).fill(9);
  return writePart10('1.2.3', makeUID(), [
    { tag: [0x0008, 0x0016], vr: 'UI', value: '1.2.3' },
    { tag: [0x0028, 0x0002], vr: 'US', value: 1 },
    { tag: [0x0028, 0x0004], vr: 'CS', value: 'MONOCHROME2' },
    { tag: [0x0028, 0x0010], vr: 'US', value: 2 },
    { tag: [0x0028, 0x0011], vr: 'US', value: 2 },
    { tag: [0x0028, 0x0008], vr: 'IS', value: frames },
    { tag: [0x0028, 0x0100], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0101], vr: 'US', value: 8 },
    { tag: [0x0028, 0x0103], vr: 'US', value: 0 },
    { tag: [0x0020, 0x1041], vr: 'DS', value: sliceLocation },
    { tag: [0x7fe0, 0x0010], vr: 'OB', value: px },
  ]);
}

describe('dicom series', () => {
  it('sortSlicesByPosition orders along the scan normal, desc from reference', () => {
    const s = (z: number) => ({ ipp: [0, 0, z] as [number, number, number] });
    const inOrder = [s(10), s(0), s(5)];
    assert.deepEqual(
      sortSlicesByPosition(inOrder, [1, 0, 0], [0, 1, 0]).map((x) => x.ipp[2]),
      [0, 5, 10],
    );
    assert.deepEqual(sortSlicesByPosition([], [1, 0, 0], [0, 1, 0]), []);
  });
  it('zSpacing spans endpoints, falls back on degenerate input', () => {
    assert.deepEqual(
      [[0, 2, 4], [7], [5, 5]].map((d, i) => zSpacing(d, [9, 9, 9][i]!)),
      [2, 9, 9],
    );
    assert.equal(zSpacing([0, 2], 0), 2); // valid span wins over a bad fallback
    assert.equal(zSpacing([5, 5], 0), 1);
    assert.equal(zSpacing([5, 5], NaN), 1);
  });
  it('stackVolumes stitches slabs, keeps dtype, rejects mismatch', () => {
    const v = stackVolumes([slab(2, 2, 1, 1), slab(2, 2, 2, 2)]);
    assert.deepEqual(v.dims, [2, 2, 3]);
    assert.deepEqual([...v.data.slice(0, 4)], [1, 1, 1, 1]);
    assert.deepEqual([...v.data.slice(4)], [2, 2, 2, 2, 2, 2, 2, 2]);
    assert.ok(stackVolumes([slab(2, 2, 1, 1, 'int16')]).data instanceof Int16Array);
    assert.ok(stackVolumes([slab(2, 2, 1, 1, 'float32')]).data instanceof Float32Array);
    assert.equal(stackVolumes([slab(2, 2, 1, 1)]).dims[2], 1);
    assert.throws(() => stackVolumes([]), /No slabs/);
    assert.throws(() => stackVolumes([slab(2, 2, 1, 1), slab(3, 2, 1, 1)]), /Slab dims mismatch/);
  });
  it('readDicomSeries blocks by 8, stitches, passes filenames through', async () => {
    const files: BinaryFile[] = Array.from({ length: 10 }, (_, i) => ({ path: `s${i}.dcm`, data: new Uint8Array([i]) }));
    const blockSizes: number[] = [];
    const r = await readDicomSeries({ inputImages: files }, async (block) => {
      blockSizes.push(block.length);
      return block.map((f) => slab(1, 1, 1, f.data[0]!));
    });
    assert.deepEqual(blockSizes, [8, 2]);
    assert.deepEqual(r.outputVolume.dims, [1, 1, 10]);
    assert.deepEqual([...r.outputVolume.data], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(r.sortedFilenames, files.map((f) => f.path));
    await assert.rejects(readDicomSeries({ inputImages: [] }, async () => []), /No input images/);
  });
});

describe('functional groups (direct)', () => {
  it('garbage buffers degrade to absent groups, never throw', () => {
    assert.deepEqual(readFunctionalGroups(new ArrayBuffer(8)), { shared: null, perFrame: [] });
    assert.deepEqual(groupGeometry(null), { ipp: null, iop: null, dimensionIndexValues: [], pixelSpacing: null, sliceThickness: null });
  });
  it('classic files report no groups at all', () => {
    assert.deepEqual(readFunctionalGroups(classicFrame(5)), { shared: null, perFrame: [] });
  });
});

describe('format dispatch', () => {
  it('loaderHint maps every staged family, unknowns stay unsupported', () => {
    const cases: Array<[string, ReturnType<typeof loaderHint>]> = [
      ['a.nii', 'nifti1'], ['a.nii.gz', 'nifti1'], ['a.hdr', 'nifti1'],
      ['a.nrrd', 'nrrd'], ['a.mif', 'mrtrix'], ['a.head', 'afni'],
      ['a.mgh', 'mgh'], ['a.mgz', 'mgh'], ['a.mhd', 'itk'], ['a.mha', 'itk'],
      ['a.src', 'dsistudio'], ['a.fib', 'dsistudio'], ['a.v16', 'brainvoyager'],
      ['a.vmr', 'brainvoyager'], ['a.npy', 'numpy'], ['a.npz', 'numpy'],
      ['a.bmp', 'bitmap'], ['a.zarr', 'zarr-staged'], ['a.dcm', 'dicom-series'],
      ['a.xyz', 'unsupported'], ['Makefile', 'unsupported'],
    ];
    for (const [name, want] of cases) assert.equal(loaderHint(name), want, name);
  });
  it('isMeshFile accepts the CPU mesh subset only', () => {
    for (const f of ['a.gii', 'a.mz3', 'a.stl', 'a.pial', 'a.white', 'A.STL']) assert.equal(isMeshFile(f), true, f);
    for (const f of ['a.nii', 'a.dcm', 'a.nrrd', 'a.png', 'noext']) assert.equal(isMeshFile(f), false, f);
  });
});

describe('import chain + providers', () => {
  it('first non-skip handler wins per source; unhandled sources error', async () => {
    const src = (ref: string): DataSource => ({ kind: 'file', ref, label: ref });
    const skipAll: ImportHandler = async () => SKIP;
    const takeDcm: ImportHandler = async (sources) => {
      const s = sources[0]!;
      return s.ref.endsWith('.dcm') ? { status: 'data', source: s } : SKIP;
    };
    const ok: ImportHandler = async () => ({ status: 'ok' });
    assert.deepEqual(await runImportChain([src('a.dcm')], [skipAll, takeDcm, ok]), [
      { status: 'data', source: src('a.dcm') },
    ]);
    assert.deepEqual(await runImportChain([src('a.nii')], [takeDcm, ok]), [{ status: 'ok' }]);
    assert.deepEqual(await runImportChain([src('a.xyz')], [skipAll]), [
      { status: 'error', message: 'Unhandled: a.xyz' },
    ]);
    assert.deepEqual(await runImportChain([], [ok]), []);
  });
  it('default registry resolves known schemes, rejects unknown ones', async () => {
    const r = defaultRegistry();
    assert.ok(r.schemes.includes('zarr') && r.schemes.includes('https'));
    assert.deepEqual(await r.resolve('https://x/y/file.nii'), {
      kind: 'https', ref: 'https://x/y/file.nii', label: 'file.nii',
    });
    await assert.rejects(() => r.resolve('foo://bar'), /No provider for scheme: foo/);
    const custom = new DataSourceRegistry();
    custom.register({ scheme: 'mem', get: async (ref) => ({ kind: 'mem', ref, label: 'm' }) });
    assert.deepEqual(await custom.resolve('mem://x'), { kind: 'mem', ref: 'mem://x', label: 'm' });
  });
});

describe('ome routing + display', () => {
  it('classifySource routes groups/arrays across spec versions', () => {
    assert.equal(classifySource(false, {}, false), 'array');
    assert.equal(classifySource(true, { plate: {} }, false), 'plate');
    assert.equal(classifySource(true, { ome: { plate: {} } }, false), 'plate'); // v0.5 wrapper
    assert.equal(classifySource(true, { well: {} }, false), 'well');
    assert.equal(classifySource(true, { multiscales: [] }, false), 'multiscales');
    assert.equal(classifySource(true, { 'bioformats2raw.layout': 1 }, false), 'bioformats2raw');
    assert.equal(classifySource(true, {}, true), 'empty-group');
    assert.equal(classifySource(true, {}, false), 'unknown');
  });
  it('getNgffAxes handles missing, string and object axes', () => {
    assert.deepEqual(getNgffAxes(undefined), ['t', 'c', 'z', 'y', 'x']);
    assert.deepEqual(getNgffAxes({}), ['t', 'c', 'z', 'y', 'x']);
    assert.deepEqual(getNgffAxes({ axes: ['x', 'y'] }), ['x', 'y']);
    assert.deepEqual(getNgffAxes({ axes: [{ name: 'c' }, { name: 'y' }, { name: 'x' }] }), ['c', 'y', 'x']);
  });
  it('resolveAttrs unwraps the v0.5 ome envelope only', () => {
    assert.deepEqual(resolveAttrs({ ome: { a: 1 } }), { a: 1 });
    assert.deepEqual(resolveAttrs({ multiscales: [] }), { multiscales: [] });
  });
  it('parseOmeroMeta maps colors, windows, visibility defaults', () => {
    const out = parseOmeroMeta({
      channels: [
        { color: 'ff0000', label: 'DAPI', window: { start: 0, end: 100, min: 10, max: 90 }, visible: false },
        { color: '#0f0', label: 'GFP', window: { start: 5, end: 50 } },
      ],
    });
    assert.deepEqual(out[0], {
      color: [255, 0, 0], label: 'DAPI',
      contrastLimits: [0, 100], domain: [10, 90], visible: false,
    });
    assert.deepEqual(out[1], {
      color: [0, 255, 0], label: 'GFP',
      contrastLimits: [5, 50], domain: [5, 50], visible: true,
    });
  });
});

describe('jpeg scan primitives', () => {
  it('bit reader walks bytes MSB-first, honors FF00 stuffing', () => {
    const r = new JpegBitReader(new Uint8Array([0b10110000]), 0);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(() => r.readBit()), [1, 0, 1, 1, 0, 0, 0, 0]);
    const s = new JpegBitReader(new Uint8Array([0xff, 0x00, 0x80]), 0);
    assert.deepEqual(Array.from({ length: 8 }, () => s.readBit()), [1, 1, 1, 1, 1, 1, 1, 1]);
    assert.equal(s.readBit(), 1); // first bit of 0x80
    assert.equal(s.readBit(), 0);
  });
  it('bit reader errors are named: overrun, marker-overrun, bad marker', () => {
    assert.throws(() => new JpegBitReader(new Uint8Array([]), 0).readBit(), (e: unknown) =>
      e instanceof JpegError && e.kind === 'truncated');
    assert.throws(() => new JpegBitReader(new Uint8Array([0xff]), 0).readBit(), (e: unknown) =>
      e instanceof JpegError && e.kind === 'truncated');
    const bad = new JpegBitReader(new Uint8Array([0xff, 0xd1]), 0);
    assert.throws(() => bad.readBit(), (e: unknown) =>
      e instanceof JpegError && (e as JpegError).kind === 'bad-marker');
  });
  it('receive + receiveAndExtend implement the JPEG sign extension', () => {
    const r = new JpegBitReader(new Uint8Array([0b11010000]), 0);
    assert.equal(r.receive(4), 13);
    const neg = new JpegBitReader(new Uint8Array([0b01000000]), 0);
    assert.equal(neg.receiveAndExtend(3), -5); // 010 -> 2 - 8 + 1
    const pos = new JpegBitReader(new Uint8Array([0b11000000]), 0);
    assert.equal(pos.receiveAndExtend(3), 6);
    const zero = new JpegBitReader(new Uint8Array([0x00]), 0);
    assert.equal(zero.receiveAndExtend(0), 0);
    zero.align();
    assert.equal(zero.readBit(), 0);
  });
  it('huffman tables decode canonical codes, reject stray bits', () => {
    const one = buildHuffmanTable(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([42]));
    assert.equal(new JpegBitReader(new Uint8Array([0x00]), 0).decodeHuffman(one), 42);
    const two = buildHuffmanTable(
      new Uint8Array([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([5, 9]));
    assert.equal(new JpegBitReader(new Uint8Array([0b00000000]), 0).decodeHuffman(two), 5);
    assert.equal(new JpegBitReader(new Uint8Array([0b01000000]), 0).decodeHuffman(two), 9);
    assert.throws(
      () => new JpegBitReader(new Uint8Array([0b10000000]), 0).decodeHuffman(two),
      (e: unknown) => e instanceof JpegError && (e as JpegError).kind === 'bad-huffman',
    );
  });
  it('ZIGZAG is a permutation of 0..63 starting at 0', () => {
    assert.equal(ZIGZAG.length, 64);
    assert.equal(ZIGZAG[0], 0);
    assert.deepEqual([...ZIGZAG].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
  });
  it('baseline scan decodes a zero block, consuming one byte', () => {
    const dc = buildHuffmanTable(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([0]));
    const ac = buildHuffmanTable(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([0x00]));
    const blockData = new Int16Array(128);
    const used = decodeBaselineScan(new Uint8Array([0x00]), 0,
      { mcusPerLine: 1, mcusPerColumn: 1, maxH: 1, maxV: 1 },
      [{ h: 1, v: 1, blocksPerLine: 1, blocksPerColumn: 1, blockData, huffmanTableDC: dc, huffmanTableAC: ac, pred: 0 }],
      0);
    assert.equal(used, 1);
    assert.ok(blockData.every((v) => v === 0));
  });
  it('baseline scan throws a named error on run past EOB', () => {
    const dc = buildHuffmanTable(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([0]));
    const ac = buildHuffmanTable(
      new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([0xf1]));
    const blockData = new Int16Array(128);
    assert.throws(
      () => decodeBaselineScan(new Uint8Array([0x00, 0x00]), 0,
        { mcusPerLine: 1, mcusPerColumn: 1, maxH: 1, maxV: 1 },
        [{ h: 1, v: 1, blocksPerLine: 1, blocksPerColumn: 1, blockData, huffmanTableDC: dc, huffmanTableAC: ac, pred: 0 }],
        0),
      (e: unknown) => e instanceof JpegError && (e as JpegError).kind === 'bad-block',
    );
  });
});
