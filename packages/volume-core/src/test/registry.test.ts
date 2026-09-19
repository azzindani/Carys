import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addTool, defaultToolGroup, hasTool, setToolMode } from '../tools.js';
import { defaultPoolSize, WorkerManager, WorkerPool } from '../worker.js';
import { ImageCache, type ProgressiveVolume } from '../progressive.js';
import { AnnotationStore, rulerLength, type RulerAnnotation } from '../annotations.js';
import { mergeCollections, sourceIdentity, type DataSource } from '../datasource.js';
import { DEFAULT_VIEWER_PROPS, resolveViewerProps } from '../embed.js';
import { normalizeTarget } from '../target.js';
import { colorByChain, colorByElement, colorByResidue, colorBySequenceId, type RGB } from '../theme.js';
import { ImageType, parseImageType } from '../nvimage.js';
import { DEFAULT_OPTS, DEFAULT_SCENE } from '../document.js';
import { isFiber, type Mesh } from '../mesh.js';
import type { AtomRow } from '../structure.js';

function ruler(o: Partial<RulerAnnotation> = {}): RulerAnnotation {
  return {
    id: 'r1', imageID: 'img', slice: 0,
    frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
    label: 'L', color: '#fff',
    firstPoint: [0, 0, 0], secondPoint: [3, 4, 0], ...o,
  };
}

function pv(id: string): ProgressiveVolume {
  let disposed = 0;
  return {
    id, status: 'loaded', volume: null,
    startLoad: async () => {}, stopLoad: () => {}, dispose: () => { disposed++; },
    get disposedCount() { return disposed; },
  } as ProgressiveVolume & { disposedCount: number };
}

function atom(o: Partial<AtomRow> = {}): AtomRow {
  return {
    type_symbol: 'C', label_atom_id: 'CA', label_comp_id: 'ALA',
    label_asym_id: 'A', auth_asym_id: 'A', label_seq_id: 1, auth_seq_id: 1,
    x: 0, y: 0, z: 0, occupancy: 1, b_iso: 20, ...o,
  };
}

describe('tool registry', () => {
  it('register + lookup, mode switch activates, default group shape', () => {
    assert.equal(hasTool('brush'), false);
    addTool('brush');
    assert.equal(hasTool('brush'), true);
    const g = defaultToolGroup('main');
    assert.equal(g.active, 'stack');
    assert.equal(g.modes['stack'], 'active');
    assert.equal(g.bindings.length, 5);
    setToolMode(g, 'ruler', 'active');
    assert.equal(g.active, 'ruler');
    assert.equal(g.modes['ruler'], 'active');
    setToolMode(g, 'ruler', 'disabled');
    assert.equal(g.active, 'ruler'); // non-active modes leave the active tool alone
  });
});

describe('worker contracts', () => {
  it('manager executes, tracks load, rejects unknown workers', async () => {
    const m = new WorkerManager();
    await assert.rejects(() => m.executeTask('nope', []), /Unknown worker: nope/);
    m.registerWorker('double', async (x: unknown) => (x as number) * 2);
    assert.equal(await m.executeTask<number>('double', [21]), 42);
    assert.equal(m.getLoad('double'), 0);
    assert.equal(m.getLoad('missing'), 0);
  });
  it('pool preserves input order across slots', async () => {
    const seen: number[] = [];
    const pool = new WorkerPool(2, async (args, { slot }) => {
      seen.push(slot);
      await new Promise((r) => setTimeout(r, args[0] === 0 ? 20 : 0));
      return (args[0] as number) * 10;
    });
    const { promise, runId } = pool.runTasks([[0], [1], [2]]);
    assert.equal(runId, 1);
    assert.deepEqual(await promise, [0, 10, 20]);
    assert.ok(seen.includes(0) && seen.includes(1));
  });
  it('cancel stops the queue without hanging', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const pool = new WorkerPool(1, async (args) => {
      if (args[0] === 0) await gate;
      return args[0];
    });
    const { promise, runId } = pool.runTasks([[0], [1]]);
    pool.cancel(runId);
    release();
    const out = await promise;
    assert.equal(out[0], 0);
    assert.equal(out.length, 2);
  });
  it('defaultPoolSize halves concurrency, floors at 1', () => {
    assert.deepEqual([defaultPoolSize(), defaultPoolSize(8), defaultPoolSize(1), defaultPoolSize(0)], [2, 4, 1, 1]);
  });
});

describe('image cache + annotation store', () => {
  it('cache add/get/ids/remove fires hooks and disposes async', async () => {
    const c = new ImageCache();
    const seen: string[] = [];
    c.onDelete((id) => seen.push(id));
    const v = pv('a');
    c.add(v);
    assert.equal(c.get('a'), v);
    assert.deepEqual(c.ids, ['a']);
    c.remove('a');
    assert.equal(c.get('a'), undefined);
    assert.deepEqual(seen, ['a']);
    assert.equal((v as unknown as { disposedCount: number }).disposedCount, 0);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal((v as unknown as { disposedCount: number }).disposedCount, 1);
    c.remove('missing'); // no hook, no throw
    assert.deepEqual(seen, ['a']);
  });
  it('rulerLength is euclidean; store CRUD + per-image purge', () => {
    assert.equal(rulerLength(ruler()), 5);
    const s = new AnnotationStore<RulerAnnotation>();
    s.add(ruler({ id: 'a' }));
    s.add(ruler({ id: 'b', imageID: 'other' }));
    assert.equal(s.get('a')!.id, 'a');
    assert.equal(s.all.length, 2);
    s.removeForImage('img');
    assert.deepEqual(s.all.map((a) => a.id), ['b']);
    s.remove('b');
    assert.deepEqual(s.all, []);
  });
});

describe('provenance + embed + targets', () => {
  it('sourceIdentity nests parents and appends extras', () => {
    const file: DataSource = { kind: 'file', ref: '/a.dcm', label: 'a' };
    assert.equal(sourceIdentity(file), 'file:/a.dcm');
    assert.equal(sourceIdentity(file, 'v2'), 'file:/a.dcmv2');
    const child: DataSource = { kind: 'chunk', ref: 'c0', label: 'c', parent: file };
    assert.equal(sourceIdentity(child), 'chunk:c0<file:/a.dcm');
  });
  it('mergeCollections dedups across lists, keeps first, preserves order', () => {
    const a: DataSource = { kind: 'file', ref: '/a', label: 'a' };
    const b: DataSource = { kind: 'file', ref: '/b', label: 'b' };
    const out = mergeCollections([[a, b], [b, { kind: 'file', ref: '/c', label: 'c' }]]);
    assert.deepEqual(out.map((s) => s.ref), ['/a', '/b', '/c']);
  });
  it('viewer props resolve over documented defaults', () => {
    assert.equal(DEFAULT_VIEWER_PROPS.format, 'mmcif');
    assert.deepEqual(resolveViewerProps({}), DEFAULT_VIEWER_PROPS);
    const over = resolveViewerProps({ moleculeId: '1crn', format: 'pdb' });
    assert.equal(over.moleculeId, '1crn');
    assert.equal(over.format, 'pdb');
    assert.equal(over.bgColor, '#faf5ec');
  });
  it('normalizeTarget derives ASM operator names, keeps explicit ones', () => {
    assert.equal(normalizeTarget({ structOperId: '1' }).operatorName, 'ASM_1');
    assert.equal(normalizeTarget({ structOperId: '1', operatorName: 'X' }).operatorName, 'X');
    const t = normalizeTarget({ labelAsymId: 'A', labelSeqId: 12 });
    assert.equal(t.operatorName, undefined);
    assert.equal(t.labelSeqId, 12);
  });
});

describe('mol themes + image types + defaults', () => {
  it('chain/element/residue/sequence providers with fallbacks', () => {
    assert.deepEqual(colorByChain(atom({ label_asym_id: 'A' }), ['A', 'B']), [31, 119, 180]);
    assert.deepEqual(colorByChain(atom({ label_asym_id: 'B' }), ['A', 'B']), [255, 127, 14]);
    assert.deepEqual(colorByChain(atom({ label_asym_id: 'ZZ' }), ['A']), [31, 119, 180]); // unknown -> first
    assert.deepEqual(colorByElement(atom({ type_symbol: 'N' })), [48, 80, 248]);
    assert.deepEqual(colorByElement(atom({ type_symbol: 'Xx' })), [255, 0, 255]);
    assert.deepEqual(colorByResidue(atom({ label_comp_id: 'ALA' })), [200, 200, 200]);
    assert.deepEqual(colorByResidue(atom({ label_comp_id: 'UNK' })), [200, 200, 200]);
    const mid: RGB = [128, 50, 128];
    assert.deepEqual(colorBySequenceId(atom({ label_seq_id: 5 }), 0, 10), mid);
    assert.deepEqual(colorBySequenceId(atom({ label_seq_id: 9 }), 9, 9), [0, 100, 255]); // degenerate -> t=0
  });
  it('parseImageType maps extensions longest-first, unknowns stay unknown', () => {
    const cases: Array<[string, ImageType]> = [
      ['a.nii', ImageType.NII], ['a.nii.gz', ImageType.NII], ['A.NRRD', ImageType.NRRD],
      ['x.zarr', ImageType.ZARR], ['y.dcm', ImageType.DCM], ['z.hdr', ImageType.HDR],
      ['q.img', ImageType.HDR], ['w.mhd', ImageType.MHD], ['v.mgh', ImageType.MGH],
      ['e.xyz', ImageType.UNKNOWN], ['noext', ImageType.UNKNOWN],
    ];
    for (const [name, want] of cases) assert.equal(parseImageType(name), want, name);
  });
  it('document defaults + fiber fence-post flag', () => {
    assert.equal(DEFAULT_SCENE.gamma, 1.0);
    assert.deepEqual(DEFAULT_SCENE.crosshairPos, [0.5, 0.5, 0.5]);
    assert.equal(DEFAULT_OPTS.sliceType, 'multiplanar');
    assert.equal(DEFAULT_OPTS.maxDrawUndoBitmaps, 8);
    assert.equal(isFiber({ offsetPt0: null } as Mesh), false);
    assert.equal(isFiber({ offsetPt0: new Uint32Array([0, 4]) } as Mesh), true);
  });
});
