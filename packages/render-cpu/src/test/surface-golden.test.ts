import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needs } from '@carys/testkit';
import { createHash } from 'node:crypto';
import { loadMask, loadField } from './goldens.js';
import { extractBoundary, meshTriangleCount } from '../surface.js';
import { meshToStl, stlFacets } from '../stl.js';
import { surfaceNets } from '../surface-nets.js';
import { renderMesh } from '../raster.js';
import { encodePngRgba } from './png.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PNG_DIR = join(HERE, 'surface-goldens');
const ROOT = process.cwd();
const FROZEN = join(ROOT, 'packages/render-cpu/src/test/surface-goldens.json');

const SURF_SPECS = [
  { name: 'skull-orbit', file: 'skull_case_0001_seg.nii', color: [225, 215, 200] as [number, number, number], minTris: 1000 },
  { name: 'brats-tumor-orbit', file: 'brain_tumor_BraTS19_CBICA_AQN_1_seg.nii', color: [230, 80, 80] as [number, number, number], minTris: 1000 },
  { name: 'skull-ct-smooth', file: 'skull_case_0001_img.nii', color: [225, 215, 200] as [number, number, number], minTris: 10000, iso: 250 },
];

describe('surface goldens', () => {
  it('seg surfaces extract + render orbit frames; hashes frozen', needs(
    ...SURF_SPECS.map((s) => s.file),
  ), () => {
    mkdirSync(PNG_DIR, { recursive: true });
    const got: Record<string, string> = {};
    for (const s of SURF_SPECS) {
      const built = 'iso' in s && (s as { iso?: number }).iso !== undefined
        ? (() => {
            const { dims, data } = loadField(join(ROOT, 'samples', s.file));
            return { mesh: surfaceNets(data, dims[0], dims[1], dims[2], (s as { iso: number }).iso), dims };
          })()
        : (() => {
            const { dims, mask } = loadMask(join(ROOT, 'samples', s.file));
            return { mesh: extractBoundary(mask, dims[0], dims[1], dims[2]), dims };
          })();
      const { mesh, dims } = built;
      const tris = meshTriangleCount(mesh);
      assert.ok(tris > s.minTris, `suspiciously small ${s.name} mesh (${tris} tris)`);
      assert.equal(stlFacets(meshToStl(mesh)).count, tris, `${s.name} STL facet mismatch`);
      const rgba = renderMesh(mesh, dims, {
        width: 320, height: 320, angleY: 0.7, tiltX: 0.3, color: s.color,
      });
      const png = encodePngRgba(rgba, 320, 320);
      writeFileSync(join(PNG_DIR, `${s.name}.png`), png);
      got[s.name] = createHash('sha256').update(png).digest('hex');
    }
    if (process.env.FREEZE === '1') {
      writeFileSync(FROZEN, JSON.stringify(got, null, 2) + '\n');
      console.log('froze surface-goldens.json — PNGs eyeballed in dist/test/surface-goldens/');
      return;
    }
    assert.ok(existsSync(FROZEN), 'no frozen surface goldens; eyeball PNGs then FREEZE=1');
    const frozen = JSON.parse(readFileSync(FROZEN, 'utf8')) as Record<string, string>;
    assert.deepEqual(got, frozen);
  });
});
