import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATLAS_ATTRIBUTION, ATLAS_BOUNDS, ATLAS_DIGEST_ID, ATLAS_DIGEST_PIN,
  ATLAS_STRUCTURES,
} from '@carys/volume-core';
import { validateDigestRecord, validateKnowledgeEntry, validateSourcesFile } from '../sources.js';
import { fitMeshToBox, parseMz3, renderMesh } from '@carys/render-cpu';

const ROOT = process.cwd();
const DIGEST_DIR = join(ROOT, 'digests', 'bodyparts3d-longbones');

describe('atlas digest registry', () => {
  it('every knowledge entry validates through study, none pre-reviewed', () => {
    assert.equal(ATLAS_STRUCTURES.length, 47);
    for (const s of ATLAS_STRUCTURES) {
      const back = validateKnowledgeEntry({ ...s.entry });
      assert.equal(back.term, s.entry.term);
      assert.equal(back.reviewed_by, null);
    }
  });
  it('vendored digest: 96 meshes + SOURCES sidecar validate', () => {
    const sidecar = JSON.parse(readFileSync(join(DIGEST_DIR, 'SOURCES.json'), 'utf8'));
    const ok = validateSourcesFile(sidecar);
    assert.equal(ok.digest, 'bodyparts3d-longbones');
    assert.equal(ok.sources[0]!.license_spdx, 'CC-BY-4.0');
    assert.match(ATLAS_ATTRIBUTION, /BodyParts3D/);
    const files = new Set(ATLAS_STRUCTURES.map((s) => s.file));
    for (const s of ATLAS_STRUCTURES) for (const m of s.members ?? []) files.add(m);
    assert.equal(files.size, 96); // FJ3289 shared mandible/skull
    for (const f of files) assert.ok(existsSync(join(DIGEST_DIR, f)), `missing ${f}`);
  });
  it('registry row for the digest validates + passes the license gate', () => {
    const row = validateDigestRecord({
      id: 'bodyparts3d-longbones', kind: 'digest', license_spdx: 'CC-BY-4.0',
      mode: 'digest', lane: 'A1', status: 'shipped',
      source_url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
    });
    assert.equal(row.lane, 'A1');
    assert.equal(ATLAS_DIGEST_ID, 'bodyparts3d-longbones');
    assert.equal(ATLAS_DIGEST_PIN, 'BP3D-4.0-partof-obj99');
  });
  it('A2 goldens: rib pair + pelvis + sacrum + skull hash-match frozen', () => {
    // Same AtlasView-mirror harness as the A1 goldens: member concat +
    // parseMz3 normals + fitMeshToBox over boundsDims + renderMesh.
    const FROZEN2: Record<string, string> = {
      'rib-r6': 'c9bf3ce81745704b',
      'rib-l6': '8ac74f605e870ade',
      pelvis: '804a781b04e93397',
      sacrum: 'e71790fc27a80ee5',
      skull: '2d8eac9f39da7279',
    };
    const SPECS2: Record<string, string[]> = {
      'rib-r6': ['FJ3344.mz3'],
      'rib-l6': ['FJ3233.mz3'],
      pelvis: ['FJ1426.mz3', 'FJ1426M.mz3', 'FJ1428.mz3', 'FJ1428M.mz3', 'FJ2815.mz3', 'FJ3152.mz3', 'FJ3288.mz3', 'FJ3393.mz3'],
      sacrum: ['FJ3393.mz3'],
      skull: ['FJ1282.mz3', 'FJ1285.mz3', 'FJ1286.mz3', 'FJ1289.mz3', 'FJ1297.mz3', 'FJ1299.mz3', 'FJ1305.mz3', 'FJ1317.mz3', 'FJ1320.mz3', 'FJ1331.mz3', 'FJ1336.mz3', 'FJ1337.mz3', 'FJ1340.mz3', 'FJ1348.mz3', 'FJ1350.mz3', 'FJ1356.mz3', 'FJ1368.mz3', 'FJ1371.mz3', 'FJ1382.mz3', 'FJ2772.mz3', 'FJ3199.mz3', 'FJ3200.mz3', 'FJ3201.mz3', 'FJ3263.mz3', 'FJ3265.mz3', 'FJ3269.mz3', 'FJ3272.mz3', 'FJ3273.mz3', 'FJ3274.mz3', 'FJ3281.mz3', 'FJ3287.mz3', 'FJ3289.mz3', 'FJ3309.mz3', 'FJ3369.mz3', 'FJ3371.mz3', 'FJ3375.mz3', 'FJ3378.mz3', 'FJ3379.mz3', 'FJ3380.mz3', 'FJ3386.mz3', 'FJ3392.mz3', 'FJ3394.mz3', 'FJ3395.mz3'],
    };
    for (const [id, files] of Object.entries(SPECS2)) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const idx: number[] = [];
      for (const f of files) {
        const buf = readFileSync(join(DIGEST_DIR, f)).buffer.slice(0) as ArrayBuffer;
        const { mesh } = parseMz3(buf);
        const base = pos.length / 3;
        for (let i = 0; i < mesh.positions.length; i++) pos.push(mesh.positions[i]!);
        for (let i = 0; i < mesh.normals.length; i++) nrm.push(mesh.normals[i]!);
        for (let i = 0; i < mesh.indices.length; i++) idx.push(base + mesh.indices[i]!);
      }
      const b = ATLAS_BOUNDS[id]!;
      const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9);
      const n = Math.max(8, Math.ceil(span));
      const fitted = fitMeshToBox(
        { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx) },
        [n, n, n],
      );
      const out = renderMesh(fitted, [n, n, n], {
        width: 160, height: 160, angleY: 0.7, tiltX: 0.3,
        color: [224, 213, 184], bg: [16, 16, 17], zoom: 1,
      });
      const hash = createHash('sha256').update(Buffer.from(out)).digest('hex').slice(0, 16);
      assert.equal(hash, FROZEN2[id], `${id} render drifted`);
    }
  });
  it('atlas goldens: 3 renders hash-match frozen (femur, scapula, sternum)', () => {
    // Mirrors AtlasView pixel-for-pixel: member concat + parseMz3 normals +
    // fitMeshToBox over boundsDims + renderMesh at orbit 0.7 / tilt 0.3.
    const FROZEN: Record<string, string> = {
      'femur-r': 'dc728b5d7cc33adf',
      'scapula-l': '078df7e7b8ad3148',
      sternum: 'cf75eed4ec1a4fb3',
    };
    const SPECS: Record<string, string[]> = {
      'femur-r': ['FJ3365.mz3'],
      'scapula-l': ['FJ3279.mz3'],
      sternum: ['FJ3153.mz3', 'FJ3178.mz3', 'FJ3290.mz3'],
    };
    for (const [id, files] of Object.entries(SPECS)) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const idx: number[] = [];
      for (const f of files) {
        const buf = readFileSync(join(DIGEST_DIR, f)).buffer.slice(0) as ArrayBuffer;
        const { mesh } = parseMz3(buf);
        const base = pos.length / 3;
        for (let i = 0; i < mesh.positions.length; i++) pos.push(mesh.positions[i]!);
        for (let i = 0; i < mesh.normals.length; i++) nrm.push(mesh.normals[i]!);
        for (let i = 0; i < mesh.indices.length; i++) idx.push(base + mesh.indices[i]!);
      }
      const b = ATLAS_BOUNDS[id]!;
      const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9);
      const n = Math.max(8, Math.ceil(span));
      const fitted = fitMeshToBox(
        { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx) },
        [n, n, n],
      );
      const out = renderMesh(fitted, [n, n, n], {
        width: 160, height: 160, angleY: 0.7, tiltX: 0.3,
        color: [224, 213, 184], bg: [16, 16, 17], zoom: 1,
      });
      const hash = createHash('sha256').update(Buffer.from(out)).digest('hex').slice(0, 16);
      assert.equal(hash, FROZEN[id], `${id} render drifted`);
    }
  });
});
