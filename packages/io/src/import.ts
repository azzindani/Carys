// Ported from VolView io/import skeleton (importDataSources.ts +
// common.ts + evaluateChain.ts). Chain-of-responsibility with Skip sentinel;
// archive/remote/state-file handlers deferred. CPU-only.

import type { DataSource } from '@carys/volume-core';

export const SKIP = Symbol('skip');

export type ImportOutcome =
  | { status: 'data'; source: DataSource }
  | { status: 'ok' }
  | { status: 'error'; message: string };

export type ImportHandler = (
  sources: DataSource[],
) => Promise<ImportOutcome | typeof SKIP>;

export async function runImportChain(
  sources: DataSource[],
  handlers: ImportHandler[],
): Promise<ImportOutcome[]> {
  const results: ImportOutcome[] = [];
  for (const s of sources) {
    let handled = false;
    for (const h of handlers) {
      const r = await h([s]);
      if (r === SKIP) continue;
      results.push(r);
      handled = true;
      break;
    }
    if (!handled) results.push({ status: 'error', message: `Unhandled: ${s.ref}` });
  }
  return results;
}
