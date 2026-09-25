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
  it('third-party notices name every project a source header ports from', () => {
    // A header that says where its code came from ("Ported from X", "Port of
    // X", "Digest: X", "Studied: X") must find X in the notices the
    // production image ships with its licence (docs/THIRD-PARTY.md), so a
    // new port cannot land without its attribution.
    const path = join(ROOT, 'docs/THIRD-PARTY.md');
    assert.ok(existsSync(path), 'missing docs/THIRD-PARTY.md');
    const notices = readFileSync(path, 'utf8').toLowerCase();
    const missing = new Set<string>();
    let named = 0;
    for (const f of walk(join(ROOT, 'packages'))) {
      if (!/\.tsx?$/.test(f) || f.includes('/test/') || f.includes('/dist/')) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/\/\/.*?\b(?:[Pp]orted from|Port of|Digest:|Studied:)[ \t]+([A-Za-z][\w.*-]*)/g)) {
        const name = m[1]!.replace(/[.,:;]+$/, '').replace(/'s$/, '');
        named++;
        if (!notices.includes(name.toLowerCase())) missing.add(`${name} (${f.split('packages/')[1]})`);
      }
    }
    assert.ok(named >= 40, `only ${named} provenance headers found: is the pattern still matching?`);
    assert.deepEqual([...missing], []);
  });
  it('700-line cap holds for every source file (packages/*/src)', () => {
    const over: string[] = [];
    for (const f of walk(join(ROOT, 'packages'))) {
      // .tsx too: the views are where files grow, and MprPanes reached 833
      // lines while this looked only at .ts
      if (!/\.tsx?$/.test(f) || f.includes('/test/') || f.includes('/dist/')) continue;
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
        if (/(?<![.\w])(document|window|localStorage)\s*[.(]/.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
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
