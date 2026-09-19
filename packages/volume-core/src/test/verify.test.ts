import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Repo root when running `npm test` from data/carys.
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.tmp-digest' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js)$/.test(e)) out.push(p);
  }
  return out;
}

describe('verification', () => {
  it('DIGEST receipts 1-10 present', () => {
    for (let i = 1; i <= 10; i++) {
      assert.ok(
        existsSync(join(ROOT, `docs/DIGEST-GROUP${i}.md`)),
        `missing docs/DIGEST-GROUP${i}.md`,
      );
    }
  });
  it('700-line cap holds for every source file (packages/*/src)', () => {
    const over: string[] = [];
    for (const f of walk(join(ROOT, 'packages'))) {
      if (!f.endsWith('.ts') || f.includes('/test/') || f.includes('/dist/')) continue;
      const lines = readFileSync(f, 'utf8').split('\n').length;
      if (lines > 700) over.push(`${f}: ${lines}`);
    }
    assert.deepEqual(over, []);
  });
  it('engine/DOM separation holds (no DOM globals in engine packages)', () => {
    // Engine packages must stay pure: no document/window/localStorage/fetch.
    // Chrome packages (app, ui) are SUPPOSED to touch the DOM — excluded.
    // Strings + comments are stripped first so './document.js' can't trip it.
    const CHROME = new Set(['app', 'ui']);
    const hits: string[] = [];
    for (const f of walk(join(ROOT, 'packages'))) {
      if (!f.endsWith('.ts') || f.includes('/test/') || f.includes('/dist/')) continue;
      const pkg = f.split('packages/')[1]?.split('/')[0];
      if (pkg && CHROME.has(pkg)) continue;
      let src = readFileSync(f, 'utf8');
      src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const lines = src.split('\n').map((l) =>
        l.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``'),
      );
      lines.forEach((l, i) => {
        if (/(?<![.\w])(document|window|localStorage)\s*[\.(]/.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
        if (/(?<![.\w])fetch\s*\(/.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
        if (/(?<![.\w])navigator\s*\./.test(l) && !l.includes('typeof navigator')) {
          hits.push(`${f}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    assert.deepEqual(hits, []);
  });
  it('ARCHITECTURE WebGL/Three ban holds (no banned imports in packages/*/src)', () => {
    const banned = [/from\s+['"]three['"]/, /require\s*\(\s*['"]three['"]/, /\.getContext\s*\(\s*['"]webgl/i];
    const hits: string[] = [];
    for (const f of walk(join(ROOT, 'packages'))) {
      const src = readFileSync(f, 'utf8');
      for (const re of banned) if (re.test(src)) hits.push(`${f}: ${re}`);
    }
    assert.deepEqual(hits, []);
  });
});
