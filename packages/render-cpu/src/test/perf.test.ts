// Perf budgets: single-user interaction ceilings on large synthetic volumes.
// Budgets are deliberately generous (order(s) above observed) so loaded CI
// never flakes; a real regression (algorithmic blowup) still trips them.
// Each case prints its observed ms next to the budget for recalibration.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Volume } from '@carys/volume-core';
import { mipRotate } from '../mip-rotate.js';
import { reslice } from '../mpr.js';
import { slabProject } from '../slab.js';
import { fuseSlices } from '../fusion.js';

function blob(dims: [number, number, number]): Volume {
  const [nx, ny, nz] = dims;
  const data = new Float64Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const dx = x - nx / 2, dy = y - ny / 2, dz = z - nz / 2;
        data[z * nx * ny + y * nx + x] = Math.max(0, 1000 - (dx * dx + dy * dy + dz * dz));
      }
    }
  }
  return { dims, spacing: [1, 1, 1], origin: [0, 0, 0], dtype: 'float64', data };
}

const WL = { center: 500, width: 1000 };

async function budgeted(label: string, budgetMs: number, fn: () => void): Promise<void> {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`    perf ${label}: ${ms.toFixed(0)}ms (budget ${budgetMs}ms)`);
  assert.ok(ms < budgetMs, `${label} blew budget: ${ms.toFixed(0)}ms >= ${budgetMs}ms`);
}

describe('perf budgets', () => {
  it('oblique MIP on 128^3 finishes inside budget', async () => {
    const v = blob([128, 128, 128]);
    await budgeted('mipRotate 128^3', 5000, () => { // ~24x observed 210ms
      mipRotate(v, { angleY: 0.6, tiltX: 0.2, mode: 'mean', w: 128, h: 128, wl: WL, step: 2 });
    });
  });
  it('thick-slab MIP on 256^3 finishes inside budget', async () => {
    const v = blob([256, 256, 64]);
    await budgeted('slabProject 256^2x64', 2000, () => { // ~35x observed 57ms
      slabProject(v, 'axial', 32, 64, 'mip', WL);
    });
  });
  it('axial reslice on 256^3 finishes inside budget', async () => {
    const v = blob([256, 256, 256]);
    await budgeted('reslice 256^3', 2000, () => { // ~90x observed 22ms
      reslice(v, 'axial', 128, WL);
    });
  });
  it('fusion checker on 128^3 finishes inside budget', async () => {
    const a = blob([128, 128, 128]);
    const b = blob([128, 128, 128]);
    await budgeted('fuseSlices 128^3', 2000, () => {
      fuseSlices(a, b, 'axial', 64, WL, WL, 'checker');
    });
  });
  it('oblique reslice on 128^3 finishes inside budget', async () => {
    const { obliqueBasis, resliceOblique } = await import('../oblique.js');
    const v = blob([128, 128, 128]);
    const { row, col } = obliqueBasis('axial', 0.2, -0.3);
    await budgeted('resliceOblique 128^3', 2000, () => {
      resliceOblique(v, [64, 64, 64], row, col, 128, 128, WL);
    });
  });
});
