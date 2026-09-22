import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DicomWebClient } from '../client.js';
import { buildMultipartRelated, parseMultipartRelated, partsOfType } from '../multipart.js';
import { buildStowBody } from '../stow.js';
import { mulberry32, randInt } from './rng.js';

describe('multipart fuzz', () => {
  it('round-trips 140 CRLF-hostile bodies byte-exact', () => {
    const rng = mulberry32(313131);
    for (let t = 0; t < 140; t++) {
      const nParts = 1 + Math.floor(rng() * 4);
      const parts = Array.from({ length: nParts }, (_, i) => {
        const n = Math.floor(rng() * 3000);
        const body = new Uint8Array(n);
        for (let k = 0; k < n; k++) {
          // bias toward CRLF bytes to stress framing
          const r = rng();
          body[k] = r < 0.2 ? 13 : r < 0.4 ? 10 : r < 0.45 ? 45 : Math.floor(rng() * 256);
        }
        return {
          contentType: i % 2 ? 'application/dicom' : 'application/dicom+json',
          contentLocation: `p${i}`,
          body,
        };
      });
      const boundary = `fuzz-${t}-x`;
      const { body } = buildMultipartRelated(parts, boundary);
      const back = parseMultipartRelated(body, boundary);
      assert.equal(back.length, nParts, `case ${t}`);
      back.forEach((p, i) => {
        assert.deepEqual(p.body, parts[i]!.body, `case ${t} part ${i}`);
        assert.equal(p.contentLocation, `p${i}`, `case ${t}`);
      });
    }
  });
  it('empty bodies survive (20 boundaries)', () => {
    for (let t = 0; t < 20; t++) {
      const { body } = buildMultipartRelated([
        { contentType: 'application/dicom', body: new Uint8Array(0) },
        { contentType: 'application/dicom', body: new Uint8Array([9]) },
      ], `empty-${t}`);
      const back = parseMultipartRelated(body, `empty-${t}`);
      assert.equal(back.length, 2, `case ${t}`);
      assert.equal(back[0]!.body.length, 0, `case ${t}`);
      assert.deepEqual(back[1]!.body, new Uint8Array([9]), `case ${t}`);
    }
  });
  it('partsOfType is exact', () => {
    const { body } = buildMultipartRelated([
      { contentType: 'application/dicom', body: new Uint8Array([1]) },
      { contentType: 'application/dicom+json', body: new Uint8Array([2]) },
    ], 'exact-b');
    const back = parseMultipartRelated(body, 'exact-b');
    assert.equal(partsOfType(back, 'application/dicom').length, 1);
    assert.equal(partsOfType(back, 'application/dicom+json').length, 1);
  });
});

describe('client url matrix', () => {
  const seen: string[] = [];
  const fn = async (url: string): Promise<Response> => {
    seen.push(url);
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/dicom+json' } });
  };
  it('builds every QIDO/series/instance path', async () => {
    const c = new DicomWebClient({ baseUrl: 'https://pacs:8080/base///', fetchFn: fn });
    assert.equal(c.baseUrl, 'https://pacs:8080/base');
    await c.searchStudies({ patientName: 'A^B', modality: 'CT', limit: 7, offset: 3 });
    await c.searchSeries('1.2.3');
    await c.searchInstances('1.2.3', '4.5');
    assert.equal(seen.length, 3);
    assert.ok(seen[0]!.includes('/studies?'));
    assert.ok(seen[0]!.includes('PatientName=A%5EB'));
    assert.ok(seen[0]!.includes('limit=7') && seen[0]!.includes('offset=3'));
    assert.ok(seen[1]!.endsWith('/studies/1.2.3/series?limit=50'));
    assert.ok(seen[2]!.includes('/series/4.5/instances'));
  });
  it('encodes special UIDs', async () => {
    const urls: string[] = [];
    const c = new DicomWebClient({
      baseUrl: 'https://pacs/w',
      fetchFn: async (url: string) => {
        urls.push(url);
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/dicom+json' } });
      },
    });
    await c.searchSeries('1.2/3?x');
    assert.ok(urls[0]!.includes(encodeURIComponent('1.2/3?x')));
  });
});

describe('stow sizes', () => {
  it('40 payloads wrap and unwrap exactly', () => {
    const rng = mulberry32(4141);
    for (let t = 0; t < 40; t++) {
      const n = randInt(rng, 0, 5000);
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = i % 256;
      const { body, contentType } = buildStowBody([{ bytes }], `s-${t}`);
      assert.ok(body.length > n, `case ${t}`);
      assert.ok(contentType.includes(`boundary=s-${t}`), `case ${t}`);
      const back = parseMultipartRelated(body, `s-${t}`);
      assert.deepEqual(back[0]!.body, bytes, `case ${t}`);
    }
  });
});
