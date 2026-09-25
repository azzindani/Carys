// The atlas' term tables, fetched and installed once (module scope): the
// BodyParts3D terms and their IS-A / PART-OF tree. Shared by the bone atlas,
// the whole-body atlas and Learn. Fetch failures throw; the callers put them
// on the status.
import {
  installTermTable, installTreeTable, validateTermTable, validateTreeTable,
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
  termsReady = true;
}
