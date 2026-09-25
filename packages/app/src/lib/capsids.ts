// The capsid digest (H7): its index, and one entry's assembly expanded at
// three levels of detail. Each entry is RCSB's own .cif.gz, unchanged; the
// expansion must come to RCSB's atom count or the load fails.
import { buildAssembly, parseAssemblyCif, vdwRadius, type AsymUnit, type BuiltAssembly } from '@carys/volume-core';

export const CAPSID_DIGEST_ID = 'rcsb-capsids';
const BASE = `/digests/${CAPSID_DIGEST_ID}`;

export interface CapsidEntry {
  key: string;
  pdbId: string;
  file: string;
  name: string;
  organism: string;
  /** triangulation number, e.g. T=7d */
  lattice: string;
  title: string;
  revision: string;
  resolutionA: number | null;
  citation: string;
  assemblyId: string;
  assemblyDetails: string;
  rcsbAtomCount: number;
  atoms: number;
  residues: number;
  chains: number;
  copies: number;
  operators: number;
  /** largest distance of any expanded atom from RCSB's own expansion */
  maxDeviationA: number;
}

export interface CapsidIndex {
  pin: string;
  attribution: string;
  entries: CapsidEntry[];
}

export async function loadCapsidIndex(): Promise<CapsidIndex> {
  const r = await fetch(`${BASE}/capsids.json`);
  if (!r.ok) throw new Error(`capsid index: ${r.status}`);
  const j = await r.json() as CapsidIndex & { format: string };
  if (j.format !== 'carys-capsids/1') throw new Error(`capsid index: format ${j.format}`);
  return { pin: j.pin, attribution: j.attribution, entries: j.entries };
}

export interface LoadedCapsid {
  entry: CapsidEntry;
  unit: AsymUnit;
  asm: BuiltAssembly;
  /** nearest and farthest atom centre from the assembly's centre */
  radial: [number, number];
}

/** Bytes to text, un-gzipping unless the server already did. */
async function gunzipText(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function loadCapsid(e: CapsidEntry): Promise<LoadedCapsid> {
  const r = await fetch(`${BASE}/${e.file}`);
  if (!r.ok) throw new Error(`${e.file}: ${r.status}`);
  const unit = parseAssemblyCif(await gunzipText(await r.arrayBuffer()));
  if (unit.id !== e.pdbId) throw new Error(`${e.file} holds entry ${unit.id}, not ${e.pdbId}`);
  const asm = buildAssembly(unit, e.assemblyId, vdwRadius);
  const p = asm.atoms.points;
  if (p.count !== e.rcsbAtomCount) throw new Error(`${e.pdbId} expanded to ${p.count} atoms, RCSB counts ${e.rcsbAtomCount}`);
  const [cx, cy, cz] = asm.centre;
  let r0 = Infinity, r1 = 0;
  for (let k = 0; k < p.count; k++) {
    const d = Math.hypot(p.x[k]! - cx, p.y[k]! - cy, p.z[k]! - cz);
    if (d < r0) r0 = d;
    if (d > r1) r1 = d;
  }
  return { entry: e, unit, asm, radial: [r0, r1] };
}
