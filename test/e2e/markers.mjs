// Marker sync: every selector shots.mjs clicks/locates/fills and every
// getElementById target must exist in the shell. Catches UI refactors that
// silently break visual e2e. File reads only — no server needed.
// Run: npm run test:markers (chained into test:e2e)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shell = readFileSync(join(ROOT, 'packages/ui/index.html'), 'utf8');
const shots = readFileSync(join(ROOT, 'test/e2e/shots.mjs'), 'utf8');

const selectors = new Set();
for (const m of shots.matchAll(/page\.(?:click|locator|fill)\('([^']+)'/g)) selectors.add(m[1]);
const ids = new Set([...shots.matchAll(/getElementById\('([^']+)'/g)].map((m) => m[1]));

describe('marker sync', () => {
  it('shots.mjs selectors resolve in the shell', () => {
    const missing = [];
    for (const sel of selectors) {
      for (const m of sel.matchAll(/#([\w-]+)/g)) {
        if (!shell.includes(`id="${m[1]}"`)) missing.push(`${sel} -> #${m[1]}`);
      }
      for (const m of sel.matchAll(/\.([\w-]+)/g)) {
        if (!new RegExp(`class="[^"]*\\b${m[1]}\\b`).test(shell)) missing.push(`${sel} -> .${m[1]}`);
      }
      for (const m of sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        const needle = m[2] === undefined ? m[1] : `${m[1]}="${m[2]}"`;
        if (!shell.includes(needle)) missing.push(`${sel} -> [${needle}]`);
      }
    }
    assert.deepEqual(missing, []);
  });
  it('shots.mjs getElementById targets exist in the shell', () => {
    const missing = [...ids].filter((id) => !shell.includes(`id="${id}"`));
    assert.deepEqual(missing, []);
  });
});
