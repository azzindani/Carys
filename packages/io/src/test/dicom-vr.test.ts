import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_VR, VR_BINARY, VR_LENGTH32, VR_SINGLE,
  allowsMultipleVR, isBinaryVR, isKnownVR, isLength32VR,
} from '../dicom-vr.js';
import { Walker } from '../dicom-parse.js';
import { readDataset } from '../dcm-read.js';
import { writePart10 } from '../dcm-write.js';

describe('dicom-vr (dcmjs tables)', () => {
  it('classification matches dcmjs ValueRepresentation + OL/OV', () => {
    // length-32: dcmjs length32VRs [OB OW OF SQ UC UR UT UN OD UV] + OL OV
    assert.deepEqual([...VR_LENGTH32].sort(), ['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT', 'UV']);
    assert.deepEqual([...VR_BINARY].sort(), ['AT', 'FD', 'FL', 'SL', 'SS', 'UL', 'US', 'UV']);
    assert.deepEqual([...VR_SINGLE].sort(), ['OB', 'OF', 'OW', 'SQ', 'UN']);
    // dcmjs VRinstances (31) + OL/OV = 33 known
    assert.equal(KNOWN_VR.size, 33);
    for (const vr of ['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'OL', 'OV']) {
      assert.ok(isKnownVR(vr), vr);
    }
    assert.ok(!isKnownVR('XX') && !isKnownVR('') && !isKnownVR('ob'));
    // spot helpers (dcmjs rule: multiple iff not binary and not single)
    assert.ok(isLength32VR('OD') && isLength32VR('UR') && isLength32VR('UV'));
    assert.ok(!isLength32VR('US') && !isLength32VR('LO'));
    assert.ok(isBinaryVR('US') && !isBinaryVR('LO'));
    assert.ok(allowsMultipleVR('LO') && allowsMultipleVR('DS'));
    assert.ok(!allowsMultipleVR('US') && !allowsMultipleVR('SQ') && !allowsMultipleVR('OB'));
  });
  it('Explicit-VR OD/UR elements parse with 32-bit lengths (regression)', () => {
    // Old dicom-parse copy lacked OD/UR in LONG_VRS: the 16-bit length read
    // at p+6 hit the reserved 0000 and silently truncated the value to 0.
    const bytes: number[] = new Array(128).fill(0);
    bytes.push(68, 73, 67, 77); // DICM
    const push = (...xs: number[]): void => { bytes.push(...xs); };
    const u16 = (v: number): void => { push(v & 0xff, (v >> 8) & 0xff); };
    const u32 = (v: number): void => { push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); };
    const elem = (g: number, e: number, vr: string, len: number, val: number[]): void => {
      u16(g); u16(e);
      push(vr.charCodeAt(0), vr.charCodeAt(1));
      u16(len);
      push(...val);
    };
    // meta group: (0002,0000) UL=28, (0002,0010) UI Explicit LE (20 w/ pad)
    push(0x02, 0x00, 0x00, 0x00, 0x55, 0x4c); u16(4); u32(28);
    elem(0x0002, 0x0010, 'UI', 20, [...new TextEncoder().encode('1.2.840.10008.1.2.1'), 0]);
    // dataset: OD + UR with 32-bit lengths (reserved 0000 traps old readers)
    const odPayload = Array.from({ length: 16 }, (_, i) => i + 1);
    push(0x19, 0x00, 0x01, 0x10, 0x4f, 0x44, 0x00, 0x00); u32(16); push(...odPayload);
    const urPayload = [...new TextEncoder().encode('http://x'), 0x20];
    push(0x19, 0x00, 0x02, 0x10, 0x55, 0x52, 0x00, 0x00); u32(urPayload.length); push(...urPayload);
    const buf = Uint8Array.from(bytes).buffer as ArrayBuffer;
    const w = new Walker(buf);
    w.walk();
    const od = w.tags.get('00191001');
    assert.ok(od, 'OD element missing');
    assert.equal(od.vr, 'OD');
    assert.equal(od.valueLength, 16);
    assert.deepEqual([...new Uint8Array(buf, od.valueOffset, 16)], odPayload);
    const ur = w.tags.get('00191002');
    assert.ok(ur, 'UR element missing');
    assert.equal(ur.valueLength, urPayload.length);
  });
  it('writer emits 12-byte headers for OD, reader round-trips bytes', () => {
    const payload = Uint8Array.from({ length: 24 }, (_, i) => (i * 7) % 251);
    const buf = writePart10('1.2.3', '1.2.4', [
      { tag: [0x0019, 0x1001], vr: 'OD', value: payload },
    ]);
    const back = readDataset(buf).bytes('00191001')!;
    assert.deepEqual(back, payload);
  });
});
