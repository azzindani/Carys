import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSpheres, sphereScratch, type SphereSet, type SphereView } from '../spheres.js';

const view = (o: Partial<SphereView> = {}): SphereView => ({
  width: 64, height: 64, orbit: 0, tilt: 0, centre: [0, 0, 0], scale: 2,
  bg: [0, 0, 0], depthSpan: 20, fog: 0, ao: false, ...o,
});

function set(spheres: [number, number, number, number][], rgb = [200, 100, 50]): SphereSet {
  return {
    count: spheres.length,
    x: spheres.map((s) => s[0]), y: spheres.map((s) => s[1]), z: spheres.map((s) => s[2]), r: spheres.map((s) => s[3]),
    rgb: Uint8Array.from(spheres.flatMap(() => rgb)),
  };
}

const covered = (id: Int32Array, which: number): number => id.reduce((n, v) => n + (v === which ? 1 : 0), 0);

describe('sphere rasterizer (H7)', () => {
  it('fills a disc of the sphere\'s projected area, deepest at its centre', () => {
    const f = renderSpheres(set([[0, 0, 0, 10]]), view());
    // radius 20 px: area π·400
    assert.ok(Math.abs(covered(f.id, 0) / (Math.PI * 400) - 1) < 0.02, `${covered(f.id, 0)} px`);
    const c = 32 * 64 + 32;
    assert.equal(f.id[c], 0);
    assert.ok(Math.abs(f.depth[c]! - 10) < 0.1, `${f.depth[c]}`);
    assert.equal(f.depth[0], -Infinity);
    assert.equal(f.id[0], -1);
    assert.equal(f.drawn, 1);
  });

  it('keeps the nearest sphere whatever the order', () => {
    const a: [number, number, number, number] = [0, 0, 5, 6];
    const b: [number, number, number, number] = [3, 0, -5, 6];
    const ab = renderSpheres(set([a, b]), view());
    const ba = renderSpheres(set([b, a]), view());
    assert.deepEqual(ab.rgba, ba.rgba);
    assert.deepEqual(ab.depth, ba.depth);
    // the nearer sphere (z = +5) owns the frame centre
    assert.equal(ab.id[32 * 64 + 32], 0);
    assert.equal(ba.id[32 * 64 + 32], 1);
  });

  it('turns with the orbit and tilt of protein.ts', () => {
    // orbit π puts +x on the left; tilt +π/2 takes +z (towards the viewer) down
    const left = renderSpheres(set([[10, 0, 0, 2]]), view({ orbit: Math.PI }));
    assert.equal(left.id[32 * 64 + 12], 0);
    const down = renderSpheres(set([[0, 0, 10, 2]]), view({ tilt: Math.PI / 2 }));
    assert.equal(down.id[52 * 64 + 32], 0);
  });

  it('draws a sphere under a pixel as one pixel', () => {
    const f = renderSpheres(set([[0, 0, 0, 0.1], [5, 5, 0, 0.1]]), view());
    assert.equal(covered(f.id, 0), 1);
    assert.equal(covered(f.id, 1), 1);
    assert.equal(f.id[32 * 64 + 32], 0);
    assert.equal(f.id[22 * 64 + 42], 1);
  });

  it('lights the side facing the light and fogs the far side', () => {
    const f = renderSpheres(set([[0, 0, 0, 10]]), view());
    const at = (x: number, y: number): number => f.rgba[(y * 64 + x) * 4]!;
    // light comes from the upper left
    assert.ok(at(24, 24) > at(40, 40), `${at(24, 24)} vs ${at(40, 40)}`);
    const near = renderSpheres(set([[0, 0, 10, 2]]), view({ fog: 0.8 }));
    const far = renderSpheres(set([[0, 0, -10, 2]]), view({ fog: 0.8 }));
    // fog keeps 1 − fog·(span − depth)/(2·span) of the colour: the near
    // centre (depth 12) keeps 0.84, the far one (depth −8) 0.44
    const c = (32 * 64 + 32) * 4;
    assert.ok(Math.abs(far.rgba[c]! / near.rgba[c]! - 0.44 / 0.84) < 0.02, `${far.rgba[c]} vs ${near.rgba[c]}`);
  });

  it('darkens the crevice between touching spheres with ambient occlusion', () => {
    const pair = set([[-6, 0, 0, 6], [6, 0, 0, 6]]);
    const plain = renderSpheres(pair, view({ width: 160, height: 160, scale: 4 }));
    const ao = renderSpheres(pair, view({ width: 160, height: 160, scale: 4, ao: true }));
    // where the two meet (x = 0), and a sphere's front far from the other
    const gap = (80 * 160 + 79) * 4, front = (80 * 160 + 56) * 4;
    assert.ok(ao.rgba[gap]! < plain.rgba[gap]! * 0.93, `${ao.rgba[gap]} vs ${plain.rgba[gap]}`);
    assert.ok(Math.abs(ao.rgba[front]! - plain.rgba[front]!) <= 1, `${ao.rgba[front]} vs ${plain.rgba[front]}`);
  });

  it('reuses scratch and fails loud on a bad frame or colours', () => {
    const s = set([[0, 0, 0, 5]]);
    const sc = sphereScratch(4);
    assert.deepEqual(renderSpheres(s, view(), sc).rgba, renderSpheres(s, view()).rgba);
    assert.throws(() => renderSpheres(s, view({ width: 0 })), /spheres-frame/);
    assert.throws(() => renderSpheres(s, view({ scale: 0 })), /spheres-scale/);
    assert.throws(() => renderSpheres({ ...s, rgb: new Uint8Array(2) }, view()), /spheres-rgb/);
  });
});
