// The atlas' term tables, fetched and installed once (module scope): labels
// resolve through K1, the tree through A2, brain labels through A3. Shared
// by the bone atlas and the whole-body atlas (H2). Fetch failures throw —
// the callers put them on the status.
import {
  installBrainTable, installTermTable, installTreeTable,
  validateBrainTable, validateTermTable, validateTreeTable,
} from '@carys/volume-core';

let termsReady = false;
export async function ensureTerms(): Promise<void> {
  if (termsReady) return;
  const r = await fetch('/digests/bodyparts3d-terms/terms.json');
  if (!r.ok) throw new Error(`terms fetch failed (${r.status})`);
  installTermTable(validateTermTable(await r.json()));
  const tr = await fetch('/digests/bodyparts3d-terms/tree.json');
  if (!tr.ok) throw new Error(`tree fetch failed (${tr.status})`);
  installTreeTable(validateTreeTable(await tr.json()));
  const br = await fetch('/digests/openanatomy-brain/labels.json');
  if (!br.ok) throw new Error(`brain labels fetch failed (${br.status})`);
  installBrainTable(validateBrainTable(await br.json()));
  termsReady = true;
}
