import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_ATTRIBUTION, ATLAS_BOUNDS, ATLAS_DIGEST_ID, ATLAS_DIGEST_PIN,
  ATLAS_STRUCTURES, atlasById,
} from '../atlas.js';

describe('atlas index', () => {
  it('47 structures, unique ids, bounds for all (20 A1 + 27 A2)', () => {
    assert.equal(ATLAS_STRUCTURES.length, 47);
    assert.equal(new Set(ATLAS_STRUCTURES.map((s) => s.id)).size, 47);
    for (const s of ATLAS_STRUCTURES) {
      assert.ok(ATLAS_BOUNDS[s.id], `no bounds for ${s.id}`);
      assert.ok(s.entry.term.length > 0 && s.entry.source === 'FMA');
    }
  });
  it('atlasById resolves + stays loud on unknown', () => {
    assert.equal(atlasById('femur-r')?.bpId, 'BP10053');
    assert.equal(atlasById('sternum')?.members?.length, 3);
    assert.equal(atlasById('nope'), null);
  });
  it('pins + attribution are exact strings', () => {
    assert.equal(ATLAS_DIGEST_ID, 'bodyparts3d-longbones');
    assert.equal(ATLAS_DIGEST_PIN, 'BP3D-4.0-partof-obj99');
    assert.match(ATLAS_ATTRIBUTION, /BodyParts3D/);
    assert.match(ATLAS_ATTRIBUTION, /CC Attribution 4.0/);
  });
});
