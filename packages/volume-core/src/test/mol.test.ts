import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atomRadius, elementColor, plddtColor, projectAtoms, rotateAtoms, sstrucColor } from '../protein.js';
import { bundleRange, residuesToSelection } from '../sequence.js';
import { bundleFromLoci, bundleToLoci, lociAll, lociNone, lociSize } from '../loci.js';
import { runMolQuery } from '../molql.js';
import { minimizeRmsd } from '../superpose.js';
import { ChunkQueueManager } from '../chunks.js';
import { LruChunkCache, compositeChannels } from '../cache.js';
import { compositeChannelsViv, defaultVisibilities, fitImage, getChannelStats, guessTileSize, hexToRGB, padContrastLimit, resolveScale } from '../viv.js';
import { PluginRegistry, preprocessTrackConfig, registerTrackClass, knownTrackTypes } from '../tracks.js';
import type { StructureModel } from '../structure.js';

describe('mol engine', () => {
  it('element + sstruc colors exact, unknown falls back', () => {
    assert.deepEqual(elementColor('C'), [144, 144, 144]);
    assert.deepEqual(elementColor('n'), [48, 80, 248]);
    assert.deepEqual(elementColor('Xx'), [255, 0, 255]);
    assert.deepEqual(sstrucColor('h'), [255, 0, 128]);
    assert.deepEqual(sstrucColor('???'), [255, 255, 255]);
  });
  it('plddt bands break at 50/70/90', () => {
    assert.deepEqual(plddtColor(95), [0, 83, 214]);
    assert.deepEqual(plddtColor(90), [0, 83, 214]);
    assert.deepEqual(plddtColor(89.9), [101, 183, 255]);
    assert.deepEqual(plddtColor(70), [101, 183, 255]);
    assert.deepEqual(plddtColor(69.9), [255, 219, 19]);
    assert.deepEqual(plddtColor(50), [255, 219, 19]);
    assert.deepEqual(plddtColor(49.9), [255, 125, 69]);
  });
  it('atom radii: vdw table, covalent factor, bfactor scale, clamp', () => {
    const C = { x: 0, y: 0, z: 0, element: 'C', chain: 'A', resSeq: 1, resName: 'ALA' };
    assert.equal(atomRadius(C), 1.7);
    assert.equal(atomRadius({ ...C, element: 'H' }), 1.2);
    assert.ok(Math.abs(atomRadius(C, 'covalent') - 1.7 * 0.75) < 1e-12);
    assert.equal(atomRadius({ ...C, bfactor: 50 }, 'bfactor'), 0.5);
    assert.equal(atomRadius({ ...C, bfactor: 99999 }, 'bfactor'), 10);
  });
  it('rotateAtoms: identity at 0, quarter-turns permute axes about centroid', () => {
    const A = (x: number, y: number, z: number) => ({ x, y, z, element: 'C', chain: 'A', resSeq: 1, resName: 'A' });
    const atoms = [A(0, 0, 0), A(2, 0, 0)];
    const id = rotateAtoms(atoms, 0, 0);
    assert.ok(Math.abs(id[0]!.x) < 1e-9 && Math.abs(id[1]!.x - 2) < 1e-9);
    // centroid (1,0,0); orbit +90°: x-axis maps onto z (x' = z, z' = -x, rel)
    const q = rotateAtoms(atoms, Math.PI / 2, 0);
    assert.ok(Math.abs(q[0]!.x - 1) < 1e-9 && Math.abs(q[0]!.z - 1) < 1e-9, `q0=${q[0]!.x},${q[0]!.z}`);
    assert.ok(Math.abs(q[1]!.x - 1) < 1e-9 && Math.abs(q[1]!.z + 1) < 1e-9, `q1=${q[1]!.x},${q[1]!.z}`);
    // full turn returns home; empty stays empty; fields preserved
    const full = rotateAtoms(atoms, Math.PI * 2, Math.PI * 2);
    assert.ok(Math.abs(full[0]!.x) < 1e-9 && Math.abs(full[1]!.y) < 1e-9);
    assert.deepEqual(rotateAtoms([], 1, 1), []);
    assert.equal(q[0]!.element, 'C');
    assert.equal(q[0]!.resSeq, 1);
  });
  it('projectAtoms scales about center with y flip', () => {
    const atoms = [
      { x: 0, y: 0, z: 0, element: 'C', chain: 'A', resSeq: 1, resName: 'A' },
      { x: 2, y: -4, z: 9, element: 'N', chain: 'A', resSeq: 1, resName: 'A' },
    ];
    const out = projectAtoms(atoms, { scale: 10, cx: 100, cy: 50 });
    assert.deepEqual([out[0]!.x, out[0]!.y], [100, 50]);
    assert.deepEqual([out[1]!.x, out[1]!.y], [120, 90]);
    assert.equal(out[1]!.atom, atoms[1]);
  });
  it('sequence bundle range inclusive both directions, selection shape', () => {
    assert.deepEqual(bundleRange(2, 5), { residues: [2, 3, 4, 5] });
    assert.deepEqual(bundleRange(5, 2), { residues: [2, 3, 4, 5] });
    assert.deepEqual(bundleRange(3, 3), { residues: [3] });
    assert.deepEqual(residuesToSelection(bundleRange(1, 2)), { kind: 'residue', ids: [1, 2] });
  });
  it('loci all/none/size, bundle compresses runs, round-trips', () => {
    assert.equal(lociSize(lociAll([{ unit: 0, size: 3 }, { unit: 1, size: 2 }])), 5);
    assert.equal(lociSize(lociNone()), 0);
    const loci = { kind: 'element-loci' as const, elements: [{ unit: 0, indices: [0, 1, 2, 5, 7, 8] }] };
    const b = bundleFromLoci(loci);
    assert.deepEqual(b.elements[0]!.ranges, [[0, 2], [5, 5], [7, 8]]);
    assert.ok(b.hash.length > 0);
    assert.deepEqual(bundleToLoci(b), loci);
  });
  it('mol query filters chain, seq range, atom name, element', () => {
    const atom = (o: Partial<StructureModel['hierarchy']['atoms'][number]>) => ({
      type_symbol: 'C', label_atom_id: 'CA', label_comp_id: 'ALA',
      label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 1, auth_seq_id: 1,
      x: 0, y: 0, z: 0, occupancy: 1, b_iso: 20, ...o,
    });
    const model: StructureModel = {
      hierarchy: {
        atoms: [
          atom({ label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 12, auth_seq_id: 12 }),
          atom({ label_asym_id: 'B', auth_asym_id: 'B', label_seq_id: 12, auth_seq_id: 12, type_symbol: 'N', label_atom_id: 'N' }),
          atom({ label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 30, auth_seq_id: 30 }),
        ],
        residues: [], chains: [], residueOffsets: [], chainOffsets: [],
      },
      units: [], entities: [],
    };
    assert.deepEqual(runMolQuery(model, { generator: 'all' }), [0, 1, 2]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { chainLabel: 'B' } }), [1]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { residueSeqId: [10, 20] } }), [0, 1]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { residueSeqId: 30 } }), [2]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { atomName: 'N' } }), [1]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { element: 'N' } }), [1]);
    assert.deepEqual(runMolQuery(model, { generator: 'atoms', filter: { chainLabel: 'Z' } }), []);
  });
  it('superpose: identical and translated sets align to rmsd 0', () => {
    const P = (xs: number[], ys: number[], zs: number[]) => ({ x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs) });
    const a = P([0, 1, 3], [0, 2, 1], [0, 0, 5]);
    const r0 = minimizeRmsd(a, a, 3);
    assert.equal(r0.rmsd, 0);
    assert.equal(r0.n, 3);
    const b = P([10, 11, 13], [-5, -3, -4], [7, 7, 12]);
    const r1 = minimizeRmsd(a, b, 3);
    assert.ok(r1.rmsd < 1e-9, `rmsd ${r1.rmsd}`);
    const t = [r1.bTransform[0]![3], r1.bTransform[1]![3], r1.bTransform[2]![3]];
    assert.ok(Math.abs(t[0]! + 10) < 1e-9 && Math.abs(t[1]! - 5) < 1e-9 && Math.abs(t[2]! + 7) < 1e-9, `t=${t}`);
    const c = P([0, 2, 3], [0, 2, 1], [0, 0, 5]);
    assert.ok(minimizeRmsd(a, c, 3).rmsd > 0, 'moved point must cost');
  });
  it('chunk queue drains visible-first, dedups, tolerates failure', async () => {
    const seen: string[] = [];
    const q = new ChunkQueueManager<string>(async (k) => {
      seen.push(k);
      if (k === 'bad') throw new Error('net down');
      return `v:${k}`;
    });
    q.request({ key: 'p1', tier: 1 });
    q.request({ key: 'v1', tier: 0 });
    q.request({ key: 'v1', tier: 0 });
    q.request({ key: 'bad', tier: 0 });
    assert.equal(q.depth, 3);
    const got: [string, string][] = [];
    await q.drain((k, v) => { got.push([k, v]); });
    assert.deepEqual(got.map(([k]) => k), ['v1', 'bad', 'p1'].filter((k) => k !== 'bad'));
    assert.deepEqual(seen.filter((k) => k === 'v1').length, 1);
    assert.equal(q.depth, 0);
  });
  it('lru cache evicts oldest, get refreshes; channel mix exact', () => {
    const c = new LruChunkCache<number>(2);
    c.set('a', 1); c.set('b', 2);
    assert.equal(c.get('a'), 1);
    c.set('c', 3);
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a'), 1);
    assert.equal(c.size, 2);
    const out = new Uint8ClampedArray(8);
    compositeChannels(
      [Uint8Array.from([100, 0]), Uint8Array.from([0, 200])],
      [[1, 0, 0], [0, 1, 0]],
      out,
    );
    assert.deepEqual([...out], [100, 0, 0, 255, 0, 200, 0, 255]);
  });
  it('channel stats exact, hidden channel pads to max', () => {
    const s = getChannelStats([0, 10, 20, 30]);
    assert.equal(s.min, 0);
    assert.equal(s.max, 30);
    assert.equal(s.mean, 15);
    assert.equal(s.median, 20);
    assert.deepEqual(s.contrastLimits, [10, 30]);
    assert.deepEqual(padContrastLimit(null, [0, 30]), [30, 30]);
    assert.deepEqual(padContrastLimit([5, 25], [0, 30]), [5, 25]);
  });
  it('viv composite normalizes by limits, clamps, alphas opaque', () => {
    const out = new Uint8ClampedArray(8);
    compositeChannelsViv(
      [[0, 255, 150, 300]],
      [[0, 255]],
      [[255, 0, 0]],
      out,
    );
    assert.deepEqual([...out], [0, 0, 0, 255, 255, 0, 0, 255]);
    const out2 = new Uint8ClampedArray(4);
    compositeChannelsViv([[150]], [[100, 200]], [[0, 0, 255]], out2);
    assert.deepEqual([...out2], [0, 0, 128, 255]);
    const out3 = new Uint8ClampedArray(4);
    compositeChannelsViv([[10, 20], [30, 40]], [[0, 100], [0, 100]], [[255, 0, 0], [0, 255, 0]], out3);
    assert.deepEqual([...out3], [Math.round(0.1 * 255), Math.round(0.3 * 255), 0, 255]);
  });
  it('viv helpers: hex, visibility, tile size, scale pick, fit', () => {
    assert.deepEqual(hexToRGB('#ff0000'), [255, 0, 0]);
    assert.deepEqual(hexToRGB('0f0'), [0, 255, 0]);
    assert.deepEqual(defaultVisibilities(2), [true, true]);
    assert.deepEqual(defaultVisibilities(5), [true, true, true, false, false]);
    assert.equal(guessTileSize(256, 128), 128);
    assert.equal(guessTileSize(100, 100), 64);
    assert.equal(resolveScale(0, 3), 0);
    assert.equal(resolveScale(-1.6, 3), 2);
    assert.equal(resolveScale(-9, 3), 2);
    assert.deepEqual(fitImage(100, 50, 200, 200), { scaleX: 2, scaleY: 2, tx: 0, ty: 50 });
  });
  it('track config defaults, registry get-throws, classes known', () => {
    assert.deepEqual(
      preprocessTrackConfig({ type: 'variant', url: 'x.vcf' }),
      { type: 'variant', url: 'x.vcf', height: 50, id: 'variant', name: 'variant' },
    );
    const kept = preprocessTrackConfig({ type: 'wig', height: 80, id: 'w1', name: 'cov' });
    assert.equal(kept.height, 80);
    assert.equal(kept.id, 'w1');
    const reg = new PluginRegistry<number>();
    reg.register('a', 1);
    assert.equal(reg.get('a'), 1);
    assert.equal(reg.has('b'), false);
    assert.deepEqual(reg.all(), ['a']);
    assert.throws(() => reg.get('b'), /Not registered: b/);
    registerTrackClass('annotation');
    assert.ok(knownTrackTypes().includes('annotation'));
  });
});
