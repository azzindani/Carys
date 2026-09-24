import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBodyIndex, type BodyPart } from '../body-pack.js';
import { assembleScene, clusterScene, frameParts, sceneColors, sceneDims, toScenePart, type BodyBox } from '../body-scene.js';
import { pickSurface } from '../pick.js';
import { renderMesh } from '../raster.js';
import { uvSphere, type V3 } from './phantoms.js';

// H2 (docs/PHASES.md): the whole body as one scene.

/** A ball as a BodyParts3D part: mm, z up. */
function ball(element: string, c: V3, r: number, system: BodyPart['system'] = 'skeletal'): BodyPart {
  const m = uvSphere(c, r, 24, 32);
  return { fma: 'FMA1', element, name: element, system, sourceTris: m.indices.length / 3, errorMm: 0, positions: m.positions, indices: m.indices };
}

const box: BodyBox = { min: [-100, -50, 0], max: [100, 50, 400] };

describe('body scene (H2)', () => {
  it('turns BodyParts3D z-up to the renderer y-up, front toward the viewer, normals outward', () => {
    const p = toScenePart(ball('FJ1', [10, -20, 300], 5), box);
    assert.deepEqual(sceneDims(box), [200, 400, 100]);
    // (x, y, z) → (x − min.x, z − min.z, max.y − y): the centre lands at (110, 300, 70)
    const c: V3 = [110, 300, 70];
    let out = 0;
    for (let v = 0; v < p.positions.length; v += 3) {
      const d = [0, 1, 2].map((k) => p.positions[v + k]! - c[k]!);
      assert.ok(Math.abs(Math.hypot(...d) - 5) < 1e-3);
      if (d[0]! * p.normals[v]! + d[1]! * p.normals[v + 1]! + d[2]! * p.normals[v + 2]! > 0) out++;
    }
    assert.equal(out, p.positions.length / 3);
  });

  it('merges the shown parts and knows every triangle\'s part', () => {
    const parts = [ball('FJ1', [-50, 0, 200], 20), ball('FJ2', [0, 0, 200], 20), ball('FJ3', [50, 0, 200], 20)].map((p) => toScenePart(p, box));
    const s = assembleScene(parts, (i) => i !== 1);
    const n = parts[0]!.indices.length / 3;
    assert.equal(s.triPart.length, 2 * n);
    assert.deepEqual([s.triPart[0], s.triPart[n - 1], s.triPart[n], s.triPart[2 * n - 1]], [0, 0, 2, 2]);
    // the second shown part's indices are offset past the first's vertices
    assert.equal(s.mesh.indices[n * 3], parts[2]!.indices[0]! + parts[0]!.positions.length / 3);
  });

  it('draws a colour per triangle, bit-identical to one colour when they agree', () => {
    const parts = [ball('FJ1', [-50, 0, 200], 30), ball('FJ2', [50, 0, 200], 30)].map((p) => toScenePart(p, box));
    const s = assembleScene(parts, () => true);
    const dims = sceneDims(box);
    const view = { width: 96, height: 96, angleY: 0, tiltX: 0 };
    const one = renderMesh(s.mesh, dims, { ...view, color: [200, 180, 150] });
    const same = renderMesh(s.mesh, dims, { ...view, color: [0, 0, 0], triColor: sceneColors(s, () => [200, 180, 150]) });
    assert.deepEqual(same, one);
    const two = renderMesh(s.mesh, dims, { ...view, color: [0, 0, 0], triColor: sceneColors(s, (i) => (i === 0 ? [255, 0, 0] : [0, 0, 255])) });
    // the left ball (patient right, x −50) red, the right one blue
    const at = (x: number, y: number): number[] => [...two.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 3)];
    const [lr, , lb] = at(37, 48), [rr, , rb] = at(59, 48);
    // (the highlight adds a grey level or so to every channel)
    assert.ok(lr! > 60 && lb! < 8, `left ${at(37, 48)}`);
    assert.ok(rb! > 60 && rr! < 8, `right ${at(59, 48)}`);
    assert.throws(() => renderMesh(s.mesh, dims, { ...view, color: [0, 0, 0], triColor: new Uint8Array(3) }), /raster-tricolor/);
  });

  it('names the part a tap lands on', () => {
    const parts = [ball('FJ1', [-50, 0, 200], 30), ball('FJ2', [50, 0, 200], 30)].map((p) => toScenePart(p, box));
    const s = assembleScene(parts, () => true);
    const view = { width: 96, height: 96, angleY: 0, tiltX: 0 };
    const hit = (x: number): number | undefined => {
      const h = pickSurface(s.mesh, sceneDims(box), view, x, 48);
      return h?.tri === undefined ? undefined : s.triPart[h.tri];
    };
    assert.deepEqual([hit(37), hit(59), hit(48)], [0, 1, undefined]);
  });

  it('clusters into fewer triangles without merging parts or leaving the surface', () => {
    // two parts on the same sphere: coincident vertices, never one cluster
    const a = toScenePart(ball('FJ1', [0, 0, 200], 40), box), b = toScenePart(ball('FJ2', [0, 0, 200], 40), box);
    const s = assembleScene([a, b], () => true);
    const cell = 8;
    const lod = clusterScene(s, cell);
    assert.ok(lod.mesh.indices.length < s.mesh.indices.length / 2, `${lod.mesh.indices.length / 3} of ${s.mesh.indices.length / 3}`);
    const owner = new Map<number, number>();
    for (let t = 0; t < lod.triPart.length; t++) {
      for (let k = 0; k < 3; k++) {
        const v = lod.mesh.indices[t * 3 + k]!;
        assert.equal(owner.get(v) ?? lod.triPart[t], lod.triPart[t]);
        owner.set(v, lod.triPart[t]!);
      }
    }
    assert.deepEqual(new Set(lod.triPart), new Set([0, 1]));
    // a cluster's mean sits inside its cell, so within a cell diagonal of the sphere
    const c = [100, 200, 50];
    for (let v = 0; v < lod.mesh.positions.length; v += 3) {
      const r = Math.hypot(...[0, 1, 2].map((k) => lod.mesh.positions[v + k]! - c[k]!));
      assert.ok(r <= 40 + 1e-3 && r > 40 - cell * Math.sqrt(3), `radius ${r}`);
    }
    assert.throws(() => clusterScene(s, 0), /body-scene-cell/);
  });

  it('keeps the two sheets of a thin shell apart', () => {
    // one part: an outer sheet and, 1 mm under it, an inner one facing in
    const outer = uvSphere([0, 0, 200], 40, 24, 32), inner = uvSphere([0, 0, 200], 39, 24, 32);
    const flip = Uint32Array.from(inner.indices, (_, k) => inner.indices[k - (k % 3) + [0, 2, 1][k % 3]!]! + outer.positions.length / 3);
    const shell: BodyPart = {
      fma: 'FMA1', element: 'FJ1', name: 'skin', system: 'integumentary', sourceTris: 0, errorMm: 0,
      positions: Float32Array.from([...outer.positions, ...inner.positions]), indices: Uint32Array.from([...outer.indices, ...flip]),
    };
    const lod = clusterScene(assembleScene([toScenePart(shell, box)], () => true), 8);
    const c = [100, 200, 50], P = lod.mesh.positions, N = lod.mesh.normals;
    for (let v = 0; v < P.length; v += 3) {
      const d = [0, 1, 2].map((k) => P[v + k]! - c[k]!), r = Math.hypot(...d);
      const facing = (d[0]! * N[v]! + d[1]! * N[v + 1]! + d[2]! * N[v + 2]!) / r;
      // the sheet a vertex sits on is the way it faces
      assert.ok(r > 39.5 ? facing > 0.8 : facing < -0.8, `r ${r.toFixed(2)} faces ${facing.toFixed(2)}`);
    }
  });

  it('frames parts: centred, and their box inside the frame at any orbit', () => {
    const parts = [ball('FJ1', [-80, 0, 50], 6), ball('FJ2', [60, 20, 350], 10)].map((p) => toScenePart(p, box));
    const dims = sceneDims(box);
    const f = frameParts(parts, [0], dims)!;
    assert.deepEqual(f.center.map((v) => Math.round(v)), [20, 50, 50]);
    const s = assembleScene(parts, (i) => i === 0);
    for (const angleY of [0, 0.8, 2.1]) {
      const px = renderMesh(s.mesh, dims, { width: 64, height: 48, angleY, tiltX: 0.4, zoom: f.zoom, center: f.center, color: [255, 255, 255], bg: [0, 0, 0] });
      let lit = 0, edge = 0;
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 64; x++) {
          if (!px[(y * 64 + x) * 4]) continue;
          lit++;
          if (x === 0 || y === 0 || x === 63 || y === 47) edge++;
        }
      }
      assert.ok(lit > 250 && edge === 0, `orbit ${angleY}: ${lit} lit, ${edge} on the edge`);
    }
    assert.equal(frameParts(parts, [], dims), null);
  });
});

describe('body index (H2)', () => {
  const good = (): Record<string, unknown> => ({
    format: 'carys-body-index/1', pin: 'P', attribution: 'A', min: [0, 0, 0], max: [1, 1, 1], elements: 3,
    systems: {
      skeletal: { file: 'skeletal.cbdy', parts: 2, tris: 10, sourceTris: 20, bytes: 100, worstErrorMm: 0.1 },
      nervous: { file: 'nervous.cbdy', parts: 1, tris: 5, sourceTris: 9, bytes: 50, worstErrorMm: 0.2 },
    },
    tris: 15, bytes: 150, worstErrorMm: 0.2,
    parts: [['FJ1', 'FMA1', 'a', 'skeletal'], ['FJ2', 'FMA2', 'b', 'nervous'], ['FJ3', 'FMA3', 'c', 'skeletal']],
  });

  it('passes a consistent index and throws on counts, systems and repeats', () => {
    assert.equal(validateBodyIndex(good()).parts.length, 3);
    const bad = (edit: (x: Record<string, unknown>) => void, re: RegExp): void => {
      const x = good();
      edit(x);
      assert.throws(() => validateBodyIndex(x), re);
    };
    bad((x) => { x['format'] = 'x'; }, /format/);
    bad((x) => { x['elements'] = 4; }, /3 part rows for 4/);
    bad((x) => { (x['parts'] as string[][])[2]![0] = 'FJ1'; }, /FJ1 twice/);
    bad((x) => { (x['parts'] as string[][])[2]![3] = 'muscular'; }, /no file/);
    bad((x) => { (x['parts'] as string[][])[2]![3] = 'nervous'; }, /skeletal: 1 rows/);
    bad((x) => { (x['systems'] as Record<string, unknown>)['bogus'] = { file: 'bogus.cbdy', parts: 0, tris: 1 }; }, /unknown system/);
    bad((x) => { x['max'] = [1, 0, 1]; }, /bounds/);
  });
});
