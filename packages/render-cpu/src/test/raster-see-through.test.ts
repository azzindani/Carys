import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickSurface } from '../pick.js';
import { renderMesh, type RasterOpts } from '../raster.js';
import type { TriMesh } from '../surface.js';
import { uvSphere } from './phantoms.js';

// See-through layers, weighted blended OIT.

const DIMS: [number, number, number] = [40, 40, 40];
const VIEW: RasterOpts = { width: 72, height: 72, angleY: 0.4, tiltX: 0.2, color: [0, 0, 0] };

/** Meshes as one, each with its grey (a triColor) and its opacity. */
function scene(parts: { mesh: TriMesh; grey: number; alpha: number }[]): { mesh: TriMesh; triColor: Uint8Array; triAlpha: Float32Array } {
  const P: number[] = [], N: number[] = [], I: number[] = [], C: number[] = [], A: number[] = [];
  for (const { mesh, grey, alpha } of parts) {
    const base = P.length / 3;
    P.push(...mesh.positions); N.push(...mesh.normals);
    for (const i of mesh.indices) { I.push(base + i); C.push(grey); }
    for (let t = 0; t < mesh.indices.length / 3; t++) A.push(alpha);
  }
  return {
    mesh: { positions: Float32Array.from(P), normals: Float32Array.from(N), indices: Uint32Array.from(I) },
    triColor: Uint8Array.from(C), triAlpha: Float32Array.from(A),
  };
}

const inner = uvSphere([20, 20, 20], 8, 24, 32), shell = uvSphere([20, 20, 20], 15, 24, 32);

describe('see-through layers (H4)', () => {
  it('shows an inner sphere through a 50% shell as the blend of the two, within 2 grey levels', () => {
    const s = scene([{ mesh: inner, grey: 70, alpha: 1 }, { mesh: shell, grey: 230, alpha: 0.5 }]);
    const both = renderMesh(s.mesh, DIMS, { ...VIEW, triColor: s.triColor, triAlpha: s.triAlpha });
    // each alone, opaque: the shell's front and what lies behind it
    const a = scene([{ mesh: inner, grey: 70, alpha: 1 }]), b = scene([{ mesh: shell, grey: 230, alpha: 1 }]);
    const back = renderMesh(a.mesh, DIMS, { ...VIEW, triColor: a.triColor });
    const front = renderMesh(b.mesh, DIMS, { ...VIEW, triColor: b.triColor });
    let worst = 0, seen = 0;
    for (let i = 0; i < both.length; i += 4) {
      if (back[i] !== 17) seen++;
      worst = Math.max(worst, Math.abs(both[i]! - (0.5 * front[i]! + 0.5 * back[i]!)));
    }
    assert.ok(seen > 400, `${seen} pixels of the inner sphere`);
    assert.ok(worst <= 2, `${worst} grey levels off the blend`);
  });

  it('draws as before at opacity 1, and not at all at 0', () => {
    const s = scene([{ mesh: inner, grey: 70, alpha: 1 }, { mesh: shell, grey: 230, alpha: 1 }]);
    const plain = renderMesh(s.mesh, DIMS, { ...VIEW, triColor: s.triColor });
    assert.deepEqual(renderMesh(s.mesh, DIMS, { ...VIEW, triColor: s.triColor, triAlpha: s.triAlpha }), plain);
    for (const o of [{ ao: true, outline: true }, { supersample: 1 as const }]) {
      assert.deepEqual(renderMesh(s.mesh, DIMS, { ...VIEW, ...o, triColor: s.triColor, triAlpha: s.triAlpha }), renderMesh(s.mesh, DIMS, { ...VIEW, ...o, triColor: s.triColor }));
    }
    const gone = scene([{ mesh: inner, grey: 70, alpha: 1 }, { mesh: shell, grey: 230, alpha: 0 }]), a = scene([{ mesh: inner, grey: 70, alpha: 1 }]);
    assert.deepEqual(renderMesh(gone.mesh, DIMS, { ...VIEW, triColor: gone.triColor, triAlpha: gone.triAlpha }), renderMesh(a.mesh, DIMS, { ...VIEW, triColor: a.triColor }));
  });

  it('needs no order: layers drawn in any order give the same picture, the nearer counting most', () => {
    const mid = uvSphere([20, 20, 20], 11, 24, 32);
    const layers = (order: number[]): ReturnType<typeof scene> => {
      const all = [{ mesh: inner, grey: 20, alpha: 1 }, { mesh: mid, grey: 90, alpha: 0.5 }, { mesh: shell, grey: 250, alpha: 0.5 }];
      return scene(order.map((k) => all[k]!));
    };
    const x = layers([0, 1, 2]), y = layers([2, 0, 1]);
    const px = renderMesh(x.mesh, DIMS, { ...VIEW, triColor: x.triColor, triAlpha: x.triAlpha });
    const py = renderMesh(y.mesh, DIMS, { ...VIEW, triColor: y.triColor, triAlpha: y.triAlpha });
    let worst = 0;
    for (let i = 0; i < px.length; i++) worst = Math.max(worst, Math.abs(px[i]! - py[i]!));
    assert.ok(worst <= 1, `${worst} grey levels between orders`);
    // at the middle: a quarter of the opaque sphere (both layers let half
    // through), and of the other three quarters more of the near shell than
    // of the one under it; each as it shades there, drawn alone
    const alone = (k: number): number => {
      const one = layers([k]);
      return renderMesh(one.mesh, DIMS, { ...VIEW, triColor: one.triColor })[(36 * 72 + 36) * 4]!;
    };
    const [opaque, under, near] = [alone(0), alone(1), alone(2)];
    const layersPart = (px[(36 * 72 + 36) * 4]! - 0.25 * opaque) / 0.75;
    assert.ok(layersPart > (under + near) / 2 && layersPart < near + 1, `layers ${layersPart}: under ${under}, near ${near}`);
  });

  it('taps through a see-through layer to what it shows, and on it where nothing is behind', () => {
    const s = scene([{ mesh: inner, grey: 70, alpha: 1 }, { mesh: shell, grey: 230, alpha: 0.5 }]);
    const innerTris = inner.indices.length / 3;
    const view = { ...VIEW, triAlpha: s.triAlpha };
    // the middle: the inner sphere, through the shell
    const mid = pickSurface(s.mesh, DIMS, view, 36, 36);
    assert.ok(mid && mid.tri! < innerTris, `middle tap hit triangle ${mid?.tri}`);
    // opaque, the shell takes it
    assert.ok(pickSurface(s.mesh, DIMS, VIEW, 36, 36)!.tri! >= innerTris);
    // between the two: only the shell, its front sheet (nearer than the centre)
    const ring = pickSurface(s.mesh, DIMS, view, 36, 36 - 19);
    assert.ok(ring && ring.tri! >= innerTris, `ring tap hit triangle ${ring?.tri}`);
    const { dir } = ring;
    assert.ok((ring.point[0] - 20) * dir[0] + (ring.point[1] - 20) * dir[1] + (ring.point[2] - 20) * dir[2] < 0, 'hit the back sheet');
    // at 0 the shell is not there
    const gone = Float32Array.from(s.triAlpha, (a) => (a < 1 ? 0 : a));
    assert.equal(pickSurface(s.mesh, DIMS, { ...VIEW, triAlpha: gone }, 36, 36 - 19), null);
    assert.throws(() => pickSurface(s.mesh, DIMS, { ...VIEW, triAlpha: [1] }, 36, 36), /pick-trialpha/);
  });

  it('fails loud on opacities it cannot use', () => {
    const s = scene([{ mesh: inner, grey: 70, alpha: 1 }]);
    assert.throws(() => renderMesh(s.mesh, DIMS, { ...VIEW, triAlpha: new Float32Array(3) }), /raster-trialpha/);
    const bad = Float32Array.from(s.triAlpha, (_, i) => (i ? 1 : 1.5));
    assert.throws(() => renderMesh(s.mesh, DIMS, { ...VIEW, triAlpha: bad }), /raster-trialpha: opacity 1.5/);
    assert.throws(() => renderMesh(s.mesh, DIMS, { ...VIEW, triAlpha: Float32Array.from(s.triAlpha, () => NaN) }), /raster-trialpha/);
  });
});
