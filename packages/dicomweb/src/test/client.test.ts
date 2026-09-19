import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DicomWebClient } from '../client.js';
import { DicomWebError } from '../types.js';

// Fake transport: records requests, replays canned responses. No network.
function fakeFetch(routes: Record<string, { status: number; body: unknown; contentType: string }>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ url, init });
    const u = new URL(url);
    const key = `${u.pathname}${u.search}`;
    const r = routes[key] ?? routes[u.pathname];
    if (!r) return new Response('missing', { status: 404 });
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers: { 'content-type': r.contentType } });
  };
  return { fn, seen };
}

const STUDY = [{
  '0020000D': { vr: 'UI', Value: ['1.2.3'] },
  '00100010': { vr: 'PN', Value: [{ Alphabetic: 'QIDO^TEST' }] },
}];

describe('dicomweb client', () => {
  it('rejects non-http base urls', () => {
    const never: import('../types.js').FetchFn = () => Promise.reject(new Error('unused'));
    assert.throws(() => new DicomWebClient({ baseUrl: 'ftp://x', fetchFn: never }), DicomWebError);
  });
  it('searchStudies builds QIDO urls and parses rows', async () => {
    const { fn, seen } = fakeFetch({
      '/w/studies?PatientName=QIDO%5ETEST&limit=50': { status: 200, body: STUDY, contentType: 'application/dicom+json' },
    });
    const c = new DicomWebClient({ baseUrl: 'https://pacs/w/', fetchFn: fn });
    const rows = await c.searchStudies({ patientName: 'QIDO^TEST' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.patientName, 'QIDO^TEST');
    assert.ok(seen[0]!.init!.headers);
    assert.match((seen[0]!.init!.headers as Record<string, string>)['Accept'], /dicom\+json/);
  });
  it('maps HTTP failures to DicomWebError with status', async () => {
    const { fn } = fakeFetch({ '/w/studies?limit=50': { status: 401, body: 'x', contentType: 'text/plain' } });
    const c = new DicomWebClient({ baseUrl: 'https://pacs/w', fetchFn: fn });
    await assert.rejects(() => c.searchStudies(), (e: unknown) => {
      assert.ok(e instanceof DicomWebError);
      assert.equal(e.status, 401);
      return true;
    });
  });
  it('maps transport exceptions to status 0', async () => {
    const c = new DicomWebClient({
      baseUrl: 'https://pacs/w',
      fetchFn: () => Promise.reject(new Error('down')),
    });
    await assert.rejects(() => c.searchStudies(), (e: unknown) => e instanceof DicomWebError && e.status === 0);
  });
  it('rejects non-array QIDO payloads', async () => {
    const { fn } = fakeFetch({ '/w/studies?limit=50': { status: 200, body: { oops: 1 }, contentType: 'application/dicom+json' } });
    const c = new DicomWebClient({ baseUrl: 'https://pacs/w', fetchFn: fn });
    await assert.rejects(() => c.searchStudies(), /expected a JSON array/);
  });
  it('retrieveInstances accepts single-part bodies', async () => {
    const { fn } = fakeFetch({
      '/w/studies/1/series/2/instances/3': { status: 200, body: 'DICMbytes', contentType: 'application/dicom' },
    });
    const c = new DicomWebClient({ baseUrl: 'https://pacs/w', fetchFn: fn });
    const [part] = await c.retrieveInstances('1', '2', ['3']);
    assert.equal(new TextDecoder().decode(part!), 'DICMbytes');
  });
});
