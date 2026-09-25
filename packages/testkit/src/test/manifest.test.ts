import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeMissing, missingSamples, sampleManifest } from '../index.js';

const entries = sampleManifest();

/** Literal fixture names the suites ask for: sample('x') and needs('x', 'y'). */
function requestedFixtures(): Set<string> {
  const out = new Set<string>();
  const pkgs = join(process.cwd(), 'packages');
  for (const pkg of readdirSync(pkgs)) {
    const dir = join(pkgs, pkg, 'src', 'test');
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.ts')); } catch { continue; }
    for (const f of files) {
      // comments name calls without making them
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const call of src.matchAll(/\b(?:sample|needs)\(([^)]*)\)/g)) {
        for (const lit of call[1]!.matchAll(/'([^'$]+)'/g)) out.add(lit[1]!);
      }
    }
  }
  return out;
}

describe('samples manifest', () => {
  it('is well formed: unique sorted paths, hashes, sizes, known generators', () => {
    assert.ok(entries.length > 0);
    const paths = entries.map((f) => f.path);
    assert.equal(new Set(paths).size, paths.length, 'duplicate path');
    assert.deepEqual(paths, [...paths].sort(), 'paths must stay sorted (one-line diffs)');
    const scripts = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    for (const f of entries) {
      assert.ok(!f.path.startsWith('/') && !f.path.includes('\\'), f.path);
      if (f.gen) assert.ok(scripts[f.gen], `${f.path}: generator ${f.gen} is not an npm script`);
    }
  });

  it('holds every fixture a suite asks for by name', () => {
    const known = new Set(entries.map((f) => f.path));
    const dirs = new Set(entries.map((f) => f.path.split('/')[0]!));
    const requested = requestedFixtures();
    assert.ok(requested.size >= 10, `the scan found only ${requested.size} fixture names: is it still reading the suites?`);
    const absent = [...requested].filter((r) => !known.has(r) && !dirs.has(r.replace(/\/.*$/, '')));
    assert.deepEqual(absent, [], 'suites ask for fixtures the manifest does not list');
  });

  it('lists the whole missing set, grouped, with what fills each entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'samples-'));
    const fake = [
      { path: 'a.nii', bytes: 1, sha256: '0'.repeat(64) },
      { path: 'series/s-000.dcm', bytes: 1, sha256: '1'.repeat(64), gen: 'gen:ct' },
      { path: 'series/s-001.dcm', bytes: 1, sha256: '2'.repeat(64), gen: 'gen:ct' },
      { path: 'b.pdb', bytes: 1, sha256: '3'.repeat(64) },
    ];
    writeFileSync(join(root, 'b.pdb'), 'x');
    mkdirSync(join(root, 'series'));
    const missing = missingSamples(root, fake);
    assert.deepEqual(missing.map((f) => f.path), ['a.nii', 'series/s-000.dcm', 'series/s-001.dcm']);
    assert.equal(describeMissing(missing),
      'samples/a.nii: real data, see samples/.gitkeep\n  samples/series/ (2 files): npm run gen:ct');
  });
});
