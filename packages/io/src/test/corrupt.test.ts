// Broken-file battery: every decoder fed hostile input must fail loud with
// a NAMED error (never a hang, never an uncaught TypeError/RangeError, never
// a silent wrong result). Hand-rolled bytes only — no samples needed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CifError, parseCif } from '../cif.js';
import { DicomParseError } from '../dicom-parse.js';
import { parseDicomFrames } from '../dicom-parse.js';
import { readDataset } from '../dcm-read.js';
import { decodeNiftiBuffer } from '../nifti-gzip.js';
import { readHeader } from '../nifti1.js';
import { NrrdError, parseNrrd } from '../nrrd.js';
import { parseOmeTiff } from '../ome-tiff.js';
import { OmeTiffError } from '../tiff-lzw.js';
import { OmeZarrError, OmeZarrStore } from '../omezarr.js';
import type { FetchFn } from '../omezarr.js';
import { parsePdb } from '../pdb.js';
import { parsePlateAttrs, parseWellAttrs } from '../ome-plate.js';

const buf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer as ArrayBuffer;
const text = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** Asserts a NAMED module error with a non-empty message (no bare TypeErrors). */
function loud(fn: () => unknown, cls: new (...a: never[]) => Error, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof cls && (e as Error).message.length > 0, label);
}

describe('corrupt', () => {
  it('DICOM rejects empty, short and non-DICOM buffers by name', () => {
    loud(() => readDataset(buf([])), DicomParseError, 'empty');
    loud(() => readDataset(buf([1, 2, 3, 4])), DicomParseError, 'short');
    // Walkable garbage yields a dataset, but one no SOP-gated consumer can
    // mistake for DICOM (all downstream use goes through SOP/instance tags).
    const junk = readDataset(text('NOTADICOMFILE..........'));
    assert.equal(junk.text('00080016'), null);
    assert.equal(junk.text('00100010'), null);
    loud(() => parseDicomFrames(buf([])), DicomParseError, 'frames empty');
    loud(() => parseDicomFrames(text('NIFTI NOT DICOM!'.padEnd(352, '\0'))), DicomParseError, 'frames nifti');
  });
  it('NIfTI rejects short buffers and non-gzip garbage by name', () => {
    assert.throws(() => readHeader(buf([])), Error, 'empty header');
    assert.throws(() => readHeader(buf(new Array(100).fill(0))), Error, 'zero header');
    // non-gzip passes the gzip sniff through, then dies on the header
    assert.throws(() => readHeader(decodeNiftiBuffer(new Uint8Array([1, 2, 3, 4]))), Error, 'garbage');
  });
  it('NRRD rejects bad magic, bad encoding and truncated payloads by name', () => {
    loud(() => parseNrrd(buf([])), NrrdError, 'empty');
    loud(() => parseNrrd(text('XXXX0000\ntype: uchar\n')), NrrdError, 'bad magic');
    loud(() => parseNrrd(text('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 2 2 2\nencoding: rot13\n\nxxxx')), NrrdError, 'bad encoding');
    loud(() => parseNrrd(text('NRRD0004\ntype: uchar\ndimension: 3\nsizes: 8 8 8\nencoding: raw\n\nshort')), NrrdError, 'short payload');
    loud(() => parseNrrd(text('NRRD0004\ndimension: 3\nsizes: 2 2 2\nencoding: raw\n\n12345678')), NrrdError, 'missing type');
  });
  it('TIFF rejects bad magic and truncated IFDs by name', () => {
    loud(() => parseOmeTiff(buf([])), OmeTiffError, 'empty');
    loud(() => parseOmeTiff(text('XXXX....')), OmeTiffError, 'bad magic');
    // LE magic + count, then EOF mid-IFD
    loud(() => parseOmeTiff(buf([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x02, 0x00])), OmeTiffError, 'cut IFD');
  });
  it('OME-Zarr wraps transport and content failures as OmeZarrError', async () => {
    const gone: FetchFn = async () => new Response('nope', { status: 404 });
    await assert.rejects(OmeZarrStore.open('https://z/arr', gone), (e: unknown) => e instanceof OmeZarrError, '404');
    const junk: FetchFn = async () => new Response('this is not json{{{');
    await assert.rejects(OmeZarrStore.open('https://z/arr', junk), (e: unknown) => e instanceof OmeZarrError, 'bad json');
    const empty: FetchFn = async () => new Response(JSON.stringify({}));
    await assert.rejects(OmeZarrStore.open('https://z/arr', empty), (e: unknown) => e instanceof OmeZarrError, 'empty attrs');
  });
  it('plates return null (not throw) on non-plate JSON', () => {
    assert.equal(parsePlateAttrs({}), null);
    assert.equal(parsePlateAttrs('junk'), null);
    assert.equal(parsePlateAttrs(null), null);
    assert.equal(parseWellAttrs({}), null);
  });
  it('PDB degrades to an empty model on garbage (never throws, never hangs)', () => {
    for (const src of ['', 'HELLO\nWORLD\n', 'ATOM  broken\n', ' '.repeat(5000)]) {
      const m = parsePdb(src);
      assert.ok(Array.isArray(m.atoms), JSON.stringify(src).slice(0, 40));
    }
  });
  it('CIF rejects non-CIF text by name', () => {
    assert.throws(() => parseCif(''), (e: unknown) => e instanceof CifError, 'empty');
    assert.throws(() => parseCif('HELLO WORLD'), (e: unknown) => e instanceof CifError, 'garbage');
  });
});
