import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationText, cancelAnnotationUid, commitStats, createAnnotation,
  isPointNearAnnotation, moveHandle, segmentDist, selectAnnotation,
} from '../annotations.js';

// V1 cornerstone-studied lifecycle: create → select → move (invalidates) →
// commit (clears) + proximity picking via segment distance. Parity goldens
// against the documented cornerstone behaviour (LengthTool + math/line):
// stats invalidation on every handle move, locked/invisible never pick,
// NaN stats render no text line.
describe('annotation lifecycle', () => {
  it('create needs the kind minimum, starts invalidated + statless', () => {
    const a = createAnnotation('length', [[0, 0, 0], [0, 0, 0]]);
    assert.equal(a.kind, 'length');
    assert.equal(a.points.length, 2);
    assert.equal(a.invalidated, true);
    assert.equal(a.stats, null);
    assert.equal(a.locked, false);
    assert.throws(() => createAnnotation('length', [[0, 0, 0]]), /annotation-handles/);
    assert.throws(() => createAnnotation('angle', [[0, 0, 0], [1, 1, 1]]), /annotation-handles/);
  });
  it('select highlights; locked refuses; move invalidates + keeps history-safe copy', () => {
    const a = createAnnotation('length', [[0, 0, 0], [3, 4, 0]]);
    const sel = selectAnnotation(a);
    assert.equal(sel.highlighted, true);
    assert.equal(a.highlighted, false);
    assert.throws(() => selectAnnotation({ ...a, locked: true }), /annotation-locked/);
    const moved = moveHandle(sel, 1, [6, 8, 0]);
    assert.deepEqual(moved.points[1], [6, 8, 0]);
    assert.equal(moved.invalidated, true);
    assert.deepEqual(sel.points[1], [3, 4, 0]);
    assert.throws(() => moveHandle(sel, 2, [0, 0, 0]), /annotation-handle/);
    assert.throws(() => moveHandle({ ...sel, locked: true }, 0, [0, 0, 0]), /annotation-locked/);
  });
  it('commit clears invalidation; text reads value+unit; NaN renders nothing', () => {
    const a = createAnnotation('length', [[0, 0, 0], [3, 4, 0]]);
    const done = commitStats(a, { value: 5, unit: 'mm' });
    assert.equal(done.invalidated, false);
    assert.deepEqual(annotationText(done), ['5 mm']);
    assert.deepEqual(annotationText(a), []);
    assert.deepEqual(annotationText(commitStats(a, { value: NaN, unit: 'mm' })), []);
    assert.equal(cancelAnnotationUid(a), a.uid);
  });
});

describe('annotation proximity pick', () => {
  const id = (w: [number, number, number]): [number, number] => [w[0], w[1]];
  it('segmentDist matches the textbook projection (cornerstone math/line)', () => {
    assert.equal(segmentDist([0, 0], [10, 0], [5, 3]), 3);
    assert.equal(segmentDist([0, 0], [10, 0], [15, 0]), 5);
    assert.equal(segmentDist([0, 0], [10, 0], [-4, 0]), 4);
    assert.equal(segmentDist([2, 2], [2, 2], [5, 6]), 5);
  });
  it('on-segment picks, far misses, locked/invisible never pick', () => {
    const a = commitStats(createAnnotation('length', [[0, 0, 0], [10, 0, 0]]), { value: 10, unit: 'mm' });
    assert.equal(isPointNearAnnotation(a, [5, 2], 3, id), true);
    assert.equal(isPointNearAnnotation(a, [5, 4], 3, id), false);
    assert.equal(isPointNearAnnotation({ ...a, locked: true }, [5, 0], 3, id), false);
    assert.equal(isPointNearAnnotation({ ...a, visible: false }, [5, 0], 3, id), false);
    assert.throws(() => isPointNearAnnotation(a, [5, 0], 0, id), /annotation-proximity/);
  });
  it('probe picks by handle radius (single world point)', () => {
    const p = createAnnotation('probe', [[4, 4, 0]]);
    assert.equal(isPointNearAnnotation(p, [5, 4], 2, id), true);
    assert.equal(isPointNearAnnotation(p, [9, 4], 2, id), false);
  });
});
