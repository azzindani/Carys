// The microbiology library's digest (H8): the bacterial entries' index and
// one entry's mmCIF text for the Protein route's Model mode.
import { MICROBE_DIGEST_ID } from '@carys/volume-core';
import { gzipText } from './gzipText';

const BASE = `/digests/${MICROBE_DIGEST_ID}`;

export interface MicrobeStructure {
  pdbId: string;
  file: string;
  card: string;
  title: string;
  organism: string;
  atoms: number;
}

export interface MicrobeLibrary {
  pin: string;
  attribution: string;
  structures: MicrobeStructure[];
}

let index: Promise<MicrobeLibrary> | null = null;

export function loadMicrobeLibrary(): Promise<MicrobeLibrary> {
  index ??= fetch(`${BASE}/library.json`).then(async (r) => {
    if (!r.ok) throw new Error(`microbe library: ${r.status}`);
    const j = await r.json() as MicrobeLibrary & { format: string };
    if (j.format !== 'carys-microbes/1') throw new Error(`microbe library: format ${j.format}`);
    return { pin: j.pin, attribution: j.attribution, structures: j.structures };
  });
  index.catch(() => { index = null; });
  return index;
}

/** One bacterial entry: its record and its mmCIF text. */
export async function loadMicrobeStructure(pdbId: string): Promise<{ lib: MicrobeLibrary; s: MicrobeStructure; text: string }> {
  const lib = await loadMicrobeLibrary();
  const s = lib.structures.find((x) => x.pdbId === pdbId);
  if (!s) throw new Error(`${pdbId} is not in the microbe library`);
  const r = await fetch(`${BASE}/${s.file}`);
  if (!r.ok) throw new Error(`${s.file}: ${r.status}`);
  return { lib, s, text: await gzipText(await r.arrayBuffer()) };
}
