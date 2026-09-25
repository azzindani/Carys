// The capsid digest (H7) held to RCSB: every entry expands to RCSB's
// assembly atom count, every copy lands within 0.01 Å of RCSB's own
// expanded file (its first and last atom, recorded at build time), and the
// largest capsid renders at each level of detail, timed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildAssembly, parseAssemblyCif, vdwRadius, type AssemblyLevel, type BuiltAssembly } from '@carys/volume-core';
import { renderSpheres, sphereScratch, type SphereView } from '../spheres.js';

const D = join(process.cwd(), 'digests', 'rcsb-capsids');

interface Entry {
  key: string; pdbId: string; file: string; sha256: string;
  rcsbAtomCount: number; atoms: number; residues: number; chains: number; copies: number; operators: number;
  maxDeviationA: number; refs: [string, number, number, number, number, number, number][];
}
const index = JSON.parse(readFileSync(join(D, 'capsids.json'), 'utf8')) as {
  format: string; pin: string; maxDeviationA: number; entries: Entry[];
};

/** RCSB data API rcsb_assembly_info.atom_count for assembly 1, 2026-09-25. */
const RCSB_ATOMS: Record<string, number> = {
  '1SVA': 958980, '1IHM': 677040, '2PLV': 429720, '4RHV': 392520, '1QGT': 273600, '2MS2': 183900, '1STM': 67596,
};

const built = new Map<string, BuiltAssembly>();
function assembly(e: Entry): BuiltAssembly {
  let b = built.get(e.pdbId);
  if (!b) {
    const gz = readFileSync(join(D, e.file));
    assert.equal(createHash('sha256').update(gz).digest('hex'), e.sha256, `${e.file} is the file RCSB served`);
    b = buildAssembly(parseAssemblyCif(gunzipSync(gz).toString('utf8')), '1', vdwRadius);
    built.set(e.pdbId, b);
  }
  return b;
}

describe('capsid digest (H7)', () => {
  it('lists the seven capsids, pinned', () => {
    assert.equal(index.format, 'carys-capsids/1');
    assert.deepEqual(index.entries.map((e) => e.pdbId), Object.keys(RCSB_ATOMS));
    assert.equal(index.pin, `PDB-${Object.keys(RCSB_ATOMS).join('-')}`);
    assert.equal(index.maxDeviationA, 0.01);
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8')) as { digests: { id: string; license_spdx: string; status: string }[] };
    const row = reg.digests.find((d) => d.id === 'rcsb-capsids');
    assert.equal(row?.license_spdx, 'CC0-1.0');
    assert.equal(row?.status, 'shipped');
    const src = JSON.parse(readFileSync(join(D, 'SOURCES.json'), 'utf8')) as { sources: { license_spdx: string; version_pin: string; citation: string }[] };
    assert.deepEqual(src.sources.map((x) => x.version_pin.split(' ')[0]), Object.keys(RCSB_ATOMS).map((id) => `PDB-${id}`));
    for (const x of src.sources) {
      assert.equal(x.license_spdx, 'CC0-1.0');
      assert.ok(x.citation.length > 40, x.citation);
    }
  });

  for (const e of index.entries) {
    it(`${e.pdbId} expands to RCSB's atom count, every copy on RCSB's`, () => {
      const b = assembly(e);
      assert.equal(b.atoms.points.count, RCSB_ATOMS[e.pdbId]);
      assert.equal(e.rcsbAtomCount, RCSB_ATOMS[e.pdbId]);
      assert.equal(b.residues.points.count, e.residues);
      assert.equal(b.chains.points.count, e.chains);
      assert.equal(b.copies.length, e.copies);
      assert.ok(e.maxDeviationA < index.maxDeviationA, `build measured ${e.maxDeviationA} Å`);
      // first and last atom of each copy against RCSB's assembly file
      const p = b.atoms.points;
      const starts = new Int32Array(b.copies.length + 1).fill(-1);
      for (let k = p.count - 1; k >= 0; k--) starts[p.copy[k]!] = k;
      starts[b.copies.length] = p.count;
      assert.equal(e.refs.length, b.copies.length);
      let worst = 0;
      b.copies.forEach((c, ci) => {
        const [label, x0, y0, z0, x1, y1, z1] = e.refs[ci]!;
        assert.equal(c.label, label);
        const a = starts[ci]!;
        let z = ci + 1;
        while (starts[z] === -1) z++;
        const last = starts[z]! - 1;
        worst = Math.max(worst,
          Math.hypot(p.x[a]! - x0, p.y[a]! - y0, p.z[a]! - z0),
          Math.hypot(p.x[last]! - x1, p.y[last]! - y1, p.z[last]! - z1));
      });
      assert.ok(worst < 0.01, `${e.pdbId}: ${worst} Å`);
      // every copy is a rigid motion of the unit: its matrix is a rotation,
      // to the precision the operators were deposited with (1IHM's are
      // orthonormal to 4.5e-4; RCSB applies them as they are)
      for (const c of b.copies) {
        const m = c.m;
        const rows = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const dot = rows[i]![0]! * rows[j]![0]! + rows[i]![1]! * rows[j]![1]! + rows[i]![2]! * rows[j]![2]!;
            assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-3, `${e.pdbId} ${c.label} R·Rᵀ[${i}][${j}] = ${dot}`);
          }
        }
      }
    });
  }

  it('renders the million-atom SV40 shell at every level, timed', () => {
    const b = assembly(index.entries[0]!);
    const W = 640, H = 560;
    const view: SphereView = {
      width: W, height: H, orbit: 0.7, tilt: 0.3, centre: b.centre,
      scale: (0.92 * Math.min(W, H)) / (2 * b.radius), bg: [10, 12, 16],
      depthSpan: b.radius, fog: 0.5, ao: false,
    };
    const scene = (l: AssemblyLevel) => ({
      count: l.points.count, x: l.points.x, y: l.points.y, z: l.points.z, r: l.r,
      rgb: new Uint8Array(l.points.count * 3).fill(180),
    });
    const scratch = sphereScratch(b.atoms.points.count);
    const levels: [string, AssemblyLevel][] = [['atoms', b.atoms], ['residues', b.residues], ['chains', b.chains]];
    for (const [name, l] of levels) {
      for (const ao of [false, true]) {
        const s = scene(l);
        renderSpheres(s, { ...view, ao }, scratch);
        const t0 = performance.now();
        const f = renderSpheres(s, { ...view, ao }, scratch);
        const ms = performance.now() - t0;
        const filled = f.id.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0) / (W * H);
        console.log(`    SV40 ${name} (${l.points.count} spheres${ao ? ', occlusion' : ''}): ${ms.toFixed(0)} ms, ${(100 * filled).toFixed(1)}% of the frame`);
        assert.equal(f.drawn, l.points.count, 'the whole shell is in the frame');
        assert.ok(filled > 0.4 && filled < 0.8, `${name} fills ${filled}`);
        assert.ok(ms < 20000, `${name}: ${ms.toFixed(0)} ms`);
      }
    }
  });
});
