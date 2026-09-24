import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackBody, validateBodyIndex, type BodyPart } from '../body-pack.js';
import { insideMesh, surfaceSamples } from '../organ-fit.js';

// H3 (docs/PHASES.md): the HRA organs digest, as built by
// scripts/build-body-hra.mjs. The build fits and measures against the HRA
// sources (not committed); this checks what it recorded and what shipped.

const DIR = join(process.cwd(), 'digests', 'hra-organs');
const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const index = validateBodyIndex(read('index.json'));
const body = validateBodyIndex(JSON.parse(readFileSync(join(process.cwd(), 'digests', 'bodyparts3d-body', 'index.json'), 'utf8')));
interface Source { version_pin: string; license_spdx: string; role?: string; citation?: string; doi?: string; entry_count: number }
const sources = (read('SOURCES.json') as { sources: Source[] }).sources;
interface Anchor { id: string; hra: string; both: boolean; ownMm: number; globalMm: number; leaveOneOutMm: number; scale: number }
interface Canal { vertebrae: { name: string; at: number[]; clearanceMm: number }[]; cordShiftMaxMm: number }
const fit = read('fit.json') as { format: string; global: { scale: number }; anchors: Anchor[]; canal: Canal };

describe('the HRA organs digest (H3)', () => {
  it('sits on the body digest\'s grid, its parts listed as shipped', () => {
    assert.deepEqual([index.min, index.max], [body.min, body.max]);
    for (const [system, f] of Object.entries(index.systems)) {
      const pack = unpackBody(readFileSync(join(DIR, f!.file)));
      assert.deepEqual([pack.min, pack.max], [index.min, index.max]);
      assert.deepEqual(pack.parts.map((p) => [p.element, p.fma, p.name, p.system]), index.parts.filter((r) => r[3] === system));
      for (const p of pack.parts) {
        assert.ok(p.errorMm <= 0.5, `${p.element} ${p.errorMm} mm`);
        // wound outward (half the source segments were not): a culling renderer
        // shows them. Signed volume about the part's centre: the cord's
        // segments are tubes open at both ends
        const P = Float64Array.from(p.positions), I = p.indices, n = P.length / 3;
        for (let k = 0; k < 3; k++) { let s = 0; for (let i = k; i < P.length; i += 3) s += P[i]!; for (let i = k; i < P.length; i += 3) P[i] -= s / n; }
        let v = 0;
        for (let t = 0; t < I.length; t += 3) {
          const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
          v += P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
        }
        assert.ok(v > 0, `${p.element} winds inward`);
      }
    }
    // its elements name their organ, and never clash with BodyParts3D's
    const bp = new Set(body.parts.map((r) => r[0]));
    for (const [el] of index.parts) assert.ok(/^[a-z-]+\//.test(el) && !bp.has(el), el);
  });

  it('cites every organ it ships, CC BY 4.0, at a pinned version', () => {
    const cited = new Map(sources.filter((s) => s.citation).map((s) => [s.version_pin.split('@')[0], s]));
    for (const [el] of index.parts) {
      const s = cited.get(el.split('/')[0]!);
      assert.ok(s && s.role === 'added' && s.license_spdx === 'CC-BY-4.0' && /@v\d/.test(s.version_pin), el);
      assert.ok(s.citation!.includes(s.doi!) && s.doi!.startsWith('https://doi.org/'), s.version_pin);
    }
    assert.ok(sources.every((s) => s.license_spdx === 'CC-BY-4.0'));
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8')) as { digests: { id: string; license_spdx: string; status: string }[] };
    assert.ok(reg.digests.some((r) => r.id === 'hra-organs' && r.license_spdx === 'CC-BY-4.0' && r.status === 'shipped'));
  });

  it('records the fit: each anchor on its own, from the rest, and all at once', () => {
    assert.equal(fit.format, 'carys-body-fit/1');
    for (const a of fit.anchors) {
      assert.ok([a.ownMm, a.globalMm, a.leaveOneOutMm, a.scale].every(Number.isFinite), a.id);
      // its own fit is never worse than the one shared by all
      assert.ok(a.ownMm <= a.globalMm + 0.05, `${a.id}: own ${a.ownMm}, all ${a.globalMm}`);
    }
  });

  const bodyPack = (s: string): BodyPart[] => unpackBody(readFileSync(join(process.cwd(), 'digests', 'bodyparts3d-body', `${s}.cbdy`))).parts;
  const shippedParts = Object.values(index.systems).flatMap((f) => unpackBody(readFileSync(join(DIR, f!.file))).parts);

  it('keeps the spinal cord in the canal, out of the vertebrae', () => {
    const named = new Map(fit.canal.vertebrae.map((v) => [v.name, v]));
    const bones = bodyPack('skeletal').filter((p) => named.has(p.name) || p.name === 'sacrum').map((p) => ({ p, ...boxOf(p.positions) }));
    // all 24 vertebrae, a canal found in each (it is 12–18 mm across)
    assert.equal(bones.length, 25);
    for (const v of named.values()) assert.ok(v.clearanceMm > 5 && v.at.every(Number.isFinite), `${v.name} ${v.clearanceMm} mm`);
    assert.ok(Number.isFinite(fit.canal.cordShiftMaxMm));
    const cord = shippedParts.filter((p) => p.element.startsWith('spinal-cord-male/'));
    assert.ok(cord.length >= 25, `${cord.length} cord segments`);
    let n = 0;
    for (const seg of cord) {
      const P = seg.positions;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
        const hit = bones.find((b) => x >= b.lo[0] && x <= b.hi[0] && y >= b.lo[1] && y <= b.hi[1] && z >= b.lo[2] && z <= b.hi[2] && insideMesh(b.p, x, y, z));
        assert.equal(hit, undefined, `${seg.element} vertex ${i / 3} inside the ${hit?.p.name}`);
        n++;
      }
    }
    assert.ok(n > 1000, `${n} cord vertices`);
  });

  it('keeps every added organ inside the skin', () => {
    // the skin's reach from the body's axis: per 5 mm of height, in 5° sectors
    // around the slab's centre, the farthest skin sample (3 mm apart)
    const skin = bodyPack('integumentary').find((p) => p.name === 'skin')!;
    const S = surfaceSamples(skin, 3), SLAB = 5, SECTORS = 72;
    const centre = new Map<number, [number, number, number]>(), reach = new Map<string, number>();
    for (let i = 0; i < S.length; i += 3) {
      const k = Math.floor(S[i + 2]! / SLAB), c = centre.get(k) ?? [0, 0, 0];
      c[0] += S[i]!; c[1] += S[i + 1]!; c[2]++;
      centre.set(k, c);
    }
    const polar = (x: number, y: number, z: number): [string, number] | null => {
      const k = Math.floor(z / SLAB), c = centre.get(k);
      if (!c) return null;
      const dx = x - c[0] / c[2], dy = y - c[1] / c[2];
      return [`${k},${Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS}`, Math.hypot(dx, dy)];
    };
    for (let i = 0; i < S.length; i += 3) {
      const [key, r] = polar(S[i]!, S[i + 1]!, S[i + 2]!)!;
      reach.set(key, Math.max(reach.get(key) ?? 0, r));
    }
    for (const p of shippedParts) {
      const P = p.positions;
      for (let i = 0; i < P.length; i += 3) {
        const q = polar(P[i]!, P[i + 1]!, P[i + 2]!), r = q ? reach.get(q[0]) : undefined;
        assert.ok(q && r !== undefined && q[1] <= r + 0.5, `${p.element} vertex ${i / 3} outside the skin by ${q && r !== undefined ? (q[1] - r).toFixed(1) : '∞'} mm`);
      }
    }
  });
});

function boxOf(P: ArrayLike<number>): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, P[i + k]!); hi[k] = Math.max(hi[k]!, P[i + k]!); }
  return { lo, hi };
}
