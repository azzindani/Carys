import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryFromContentType, buildMultipartRelated, parseMultipartRelated, partsOfType,
} from '../multipart.js';

const enc = new TextEncoder();

function sample(): { body: Uint8Array; boundary: string; dcm: Uint8Array; json: Uint8Array } {
  const dcm = new Uint8Array([0, 1, 2, 3, 255, 254, 13, 10, 5]); // includes CRLF bytes
  const json = enc.encode('{"a":1}');
  const { body, boundary } = buildMultipartRelated([
    { contentType: 'application/dicom', contentLocation: 'i1', body: dcm },
    { contentType: 'application/dicom+json', body: json },
  ], 'test-boundary-1');
  return { body, boundary, dcm, json };
}

describe('multipart/related', () => {
  it('round-trips binary bodies byte-exact (incl. embedded CRLF)', () => {
    const { body, boundary, dcm, json } = sample();
    const parts = parseMultipartRelated(body, boundary);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]!.contentType, 'application/dicom');
    assert.equal(parts[0]!.contentLocation, 'i1');
    assert.deepEqual(parts[0]!.body, dcm);
    assert.deepEqual(parts[1]!.body, json);
  });
  it('tolerates preamble and filters by type', () => {
    const { body, boundary } = sample();
    const pre = enc.encode('preamble junk\r\n');
    const joined = new Uint8Array(pre.length + body.length);
    joined.set(pre, 0);
    joined.set(body, pre.length);
    const parts = parseMultipartRelated(joined, boundary);
    assert.equal(parts.length, 2);
    assert.equal(partsOfType(parts, 'application/dicom').length, 1);
    assert.equal(partsOfType(parts, 'application/dicom+json').length, 1);
  });
  it('rejects truncation and missing boundaries', () => {
    const { body, boundary } = sample();
    assert.throws(() => parseMultipartRelated(body.slice(0, 40), boundary), /truncated|terminator/);
    assert.throws(() => parseMultipartRelated(enc.encode('nope'), boundary), /boundary not found/);
    assert.throws(() => parseMultipartRelated(body, ''), /requires a boundary/);
  });
  it('extracts boundary from content-type', () => {
    assert.equal(
      boundaryFromContentType('multipart/related; type="application/dicom"; boundary=abc-123'),
      'abc-123',
    );
    assert.equal(boundaryFromContentType('multipart/related; boundary="q q"'), 'q q');
    assert.throws(() => boundaryFromContentType('application/json'), /no boundary/);
  });
});
