import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ATLAS_ATTRIBUTION } from '@carys/volume-core';
import { BODY_SYSTEMS, unpackBody, validateBodyIndex } from '../body-pack.js';

// The committed whole-body digest, as built by
// scripts/build-body-atlas.mjs from BodyParts3D. The build measures each
// part against its source (which is not committed); this checks what it
// recorded and what shipped.

const DIR = join(process.cwd(), 'digests', 'bodyparts3d-body');
interface Index {
  format: string; pin: string; attribution: string; elements: number; tris: number; bytes: number;
  systems: Record<string, { file: string; parts: number; tris: number; bytes: number }>;
}
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as Index;

describe('the whole-body digest (H1)', () => {
  const packs = Object.entries(index.systems).map(([system, s]) => ({ system, s, pack: unpackBody(readFileSync(join(DIR, s.file))) }));

  it('is the BodyParts3D IS-A set, attributed', () => {
    assert.equal(index.format, 'carys-body-index/1');
    assert.equal(index.pin, 'BP3D-4.0-isa-obj99');
    assert.equal(index.attribution, ATLAS_ATTRIBUTION);
    const src = JSON.parse(readFileSync(join(DIR, 'SOURCES.json'), 'utf8')) as { sources: { entry_count: number; license_spdx: string; version_pin: string }[] };
    assert.deepEqual([src.sources[0]!.entry_count, src.sources[0]!.license_spdx, src.sources[0]!.version_pin], [index.elements, 'CC-BY-4.0', index.pin]);
    const reg = JSON.parse(readFileSync(join(process.cwd(), 'DIGESTS.json'), 'utf8')) as { digests: { id: string; license_spdx: string; status: string }[] };
    assert.ok(reg.digests.some((r) => r.id === 'bodyparts3d-body' && r.license_spdx === 'CC-BY-4.0' && r.status === 'shipped'));
  });

  it('holds every source element once, each in its system', () => {
    const seen = new Set<string>();
    for (const { system, s, pack } of packs) {
      assert.ok((BODY_SYSTEMS as readonly string[]).includes(system));
      assert.equal(pack.parts.length, s.parts, system);
      for (const p of pack.parts) {
        assert.equal(p.system, system);
        assert.ok(!seen.has(p.element), `${p.element} twice`);
        seen.add(p.element);
        assert.match(p.fma, /^FMA\d+$/);
      }
    }
    assert.equal(seen.size, index.elements);
  });

  it('lists every part in its index, in each file\'s order (H2 finds before it fetches)', () => {
    const rows = validateBodyIndex(index).parts;
    for (const { system, pack } of packs) {
      assert.deepEqual(pack.parts.map((p) => [p.element, p.fma, p.name, p.system]), rows.filter((r) => r[3] === system), system);
      assert.deepEqual([pack.min, pack.max], [validateBodyIndex(index).min, validateBodyIndex(index).max]);
    }
    // the liver is an organ, whatever "hepatovenous" says (H2 found it under the vessels)
    for (const r of rows.filter((x) => /liver|hepatovenous segment/.test(x[2]))) assert.equal(r[3], 'digestive', r[2]);
  });

  it('fits the budget: 2 M triangles, 25 MB', () => {
    const tris = packs.reduce((n, { pack }) => n + pack.parts.reduce((m, p) => m + p.indices.length / 3, 0), 0);
    const bytes = packs.reduce((n, { s }) => n + statSync(join(DIR, s.file)).size, 0);
    assert.equal(tris, index.tris);
    assert.ok(tris <= 2_000_000, `${tris} triangles`);
    assert.ok(bytes <= 25_000_000, `${bytes} bytes`);
  });

  it('keeps every part within 0.5 mm of its source, both ways (as the build measured)', () => {
    let worst = 0;
    for (const { pack } of packs) for (const p of pack.parts) worst = Math.max(worst, p.errorMm);
    assert.ok(worst <= 0.5, `worst ${worst} mm`);
  });
});
