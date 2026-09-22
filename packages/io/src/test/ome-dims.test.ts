import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needs, sample } from '@carys/testkit';
import { auditAxisOrder, physicalSizes, planeExtents, selectPlane } from '../ome-dims.js';
import { parseOmeTiff, type OmeTiffPlane } from '../ome-tiff.js';

const P = (t: number, c: number, z: number): OmeTiffPlane => ({
  width: 4, height: 4, dtype: 'uint8', data: new Uint8Array(16), c, z, t,
});

describe('ome 5d selection', () => {
  const planes = [P(0, 0, 0), P(0, 0, 1), P(0, 1, 0), P(1, 0, 0)];
  it('exact hits resolve, out-of-range clamps, sparse falls back nearest', () => {
    assert.deepEqual(selectPlane(null, planes, { t: 0, c: 1, z: 0 }).index, { t: 0, c: 1, z: 0 });
    const cl = selectPlane(null, planes, { t: 9, c: 0, z: 0 });
    assert.equal(cl.index.t, 1); // clamped to max decoded t
    const near = selectPlane(null, [P(0, 0, 0), P(0, 0, 5)], { t: 0, c: 0, z: 3 });
    assert.ok(near.index.z === 0 || near.index.z === 5); // nearest decoded wins
  });
  it('empty planes throw, extents count decoded axes', () => {
    assert.throws(() => selectPlane(null, [], {}), /ome-5d-empty/);
    assert.deepEqual(planeExtents(planes), { sizeT: 2, sizeC: 2, sizeZ: 2 });
    assert.deepEqual(planeExtents([]), { sizeT: 0, sizeC: 0, sizeZ: 0 });
  });
});

describe('vendored 5d fixture', () => {
  it('tczyx.ome.tif decodes 2x2x3 with pinned (t,c,z) + pixel signatures', needs('tczyx.ome.tif'), () => {
    const buf = Uint8Array.from(
      readFileSync(sample('tczyx.ome.tif')!),
    ).buffer as ArrayBuffer;
    const { meta, planes } = parseOmeTiff(buf);
    assert.equal(planes.length, 12);
    assert.equal(meta?.sizeT, 2);
    assert.equal(meta?.sizeC, 2);
    assert.equal(meta?.sizeZ, 3);
    assert.deepEqual(planeExtents(planes), { sizeT: 2, sizeC: 2, sizeZ: 3 });
    for (const p of planes) {
      // generator signature: t*100 + c*40 + z*8 + ramp
      const want = (p.t * 100 + p.c * 40 + p.z * 8) % 256;
      assert.equal(p.data[0], want, `(t${p.t},c${p.c},z${p.z}) pixel 0`);
    }
    const hit = selectPlane(meta, planes, { t: 1, c: 1, z: 2 });
    assert.deepEqual(hit.index, { t: 1, c: 1, z: 2 });
    assert.equal(hit.plane.data[0], (100 + 40 + 16) % 256);
  });
});

describe('napari-studied axis-order audit', () => {
  it('vendored tczyx: order clean, explicit planes, counts fit', needs('tczyx.ome.tif'), () => {
    const buf = Uint8Array.from(
      readFileSync(sample('tczyx.ome.tif')!),
    ).buffer as ArrayBuffer;
    const { meta, planes } = parseOmeTiff(buf);
    const findings = auditAxisOrder(meta, planes, { explicitPlanes: true });
    assert.deepEqual(findings.map((f) => f.check), ['dimension-order', 'explicit-planes', 'size-consistency']);
    assert.ok(findings.every((f) => f.ok), JSON.stringify(findings));
    assert.ok(findings[0]!.detail.includes('XYZCT'));
  });
  it('null meta + walked planes fail loud as findings, never throws', () => {
    const findings = auditAxisOrder(null, [P(0, 0, 0)]);
    assert.equal(findings[0]!.ok, false);
    assert.equal(findings[1]!.ok, false);
    assert.ok(findings[0]!.detail.includes('unreadable'));
  });
  it('over-count planes fail size-consistency', needs('tczyx.ome.tif'), () => {
    const buf = Uint8Array.from(
      readFileSync(sample('tczyx.ome.tif')!),
    ).buffer as ArrayBuffer;
    const { meta, planes } = parseOmeTiff(buf);
    const doubled = [...planes, ...planes];
    const findings = auditAxisOrder(meta, doubled, { explicitPlanes: true });
    assert.equal(findings[2]!.ok, false);
    assert.ok(findings[2]!.detail.includes('exceed'));
  });
});

describe('physical sizes', () => {
  it('parses present sizes, nulls missing/junk (never 1)', () => {
    const xml = '<Pixels PhysicalSizeX="0.65" PhysicalSizeY="0.65" PhysicalSizeZ="2.0" />';
    assert.deepEqual(physicalSizes(xml), { sizeX: 0.65, sizeY: 0.65, sizeZ: 2 });
    assert.deepEqual(
      physicalSizes('<Pixels PhysicalSizeX="0" PhysicalSizeY="junk" />'),
      { sizeX: null, sizeY: null, sizeZ: null },
    );
    assert.deepEqual(physicalSizes('<Pixels />'), { sizeX: null, sizeY: null, sizeZ: null });
  });
});
