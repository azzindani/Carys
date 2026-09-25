// Read what an assembly needs from an mmCIF entry (H7): the first model's
// atoms (ATOM and HETATM: RCSB's assembly atom counts include ligands and
// waters), the chains, polymer residues and entities, the assemblies and
// their operators. Columnar; strings only per asymmetric-unit atom, which
// is small (16 k atoms for SV40) — the expansion is the big part.

import {
  AssemblyError, assemblyCopies, beadsOf, expandPoints,
  type AsymPoints, type AssemblyCopy, type AssemblyDef, type Expanded, type Mat34,
} from './assembly.js';
import { CifError, cifCategories, cifTokens } from './cif-tokens.js';

export interface AsymUnit extends AsymPoints {
  /** _entry.id */
  id: string;
  /** _struct.title */
  title: string;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** chain (label_asym_id) index per atom */
  asym: Uint16Array;
  asymIds: string[];
  /** entity id per chain */
  asymEntity: string[];
  /** polymer residue index per atom, −1 off the polymer (label_seq_id '.') */
  residue: Int32Array;
  residueCount: number;
  /** polymer chain index per atom (its chain), −1 off the polymer */
  polymerChain: Int32Array;
  /** type_symbol per atom, upper case */
  element: string[];
  /** label_comp_id per atom */
  comp: string[];
  /** auth_seq_id per atom (NaN when '.' or '?') */
  seq: Float64Array;
  /** entity id → pdbx_description */
  entities: Map<string, string>;
  assemblies: AssemblyDef[];
  operators: Map<string, Mat34>;
}

const num = (v: string | undefined): number => (v === undefined || v === '?' || v === '.' ? NaN : Number(v));

const MATRIX_KEYS = [
  'matrix[1][1]', 'matrix[1][2]', 'matrix[1][3]', 'vector[1]',
  'matrix[2][1]', 'matrix[2][2]', 'matrix[2][3]', 'vector[2]',
  'matrix[3][1]', 'matrix[3][2]', 'matrix[3][3]', 'vector[3]',
];

/** Parse an mmCIF entry for assembly expansion. Loud on anything missing
 *  that the expansion would otherwise quietly get wrong. */
export function parseAssemblyCif(text: string): AsymUnit {
  const cats = cifCategories(cifTokens(text), [
    'entry', 'struct', 'entity', 'atom_site',
    'pdbx_struct_assembly', 'pdbx_struct_assembly_gen', 'pdbx_struct_oper_list',
  ]);
  const rows = cats.get('atom_site')!;
  if (rows.length === 0) throw new CifError('no-atom-site', 'no _atom_site rows');
  for (const key of ['Cartn_x', 'Cartn_y', 'Cartn_z', 'label_asym_id', 'label_seq_id', 'type_symbol']) {
    if (rows[0]![key] === undefined) throw new CifError('missing-ids', `atom_site lacks ${key}`);
  }
  const model = rows[0]!.pdbx_PDB_model_num;
  const kept = model === undefined ? rows : rows.filter((r) => r.pdbx_PDB_model_num === model);
  const n = kept.length;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const asym = new Uint16Array(n);
  const residue = new Int32Array(n);
  const polymerChain = new Int32Array(n);
  const seq = new Float64Array(n);
  const element: string[] = [];
  const comp: string[] = [];
  const asymIds: string[] = [];
  const asymEntity: string[] = [];
  const asymIndex = new Map<string, number>();
  const residueIndex = new Map<string, number>();
  kept.forEach((r, i) => {
    x[i] = num(r.Cartn_x);
    y[i] = num(r.Cartn_y);
    z[i] = num(r.Cartn_z);
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!) || !Number.isFinite(z[i]!)) {
      throw new CifError('missing-coords', `atom ${r.id ?? i} has no coordinates`);
    }
    const a = r.label_asym_id!;
    let ai = asymIndex.get(a);
    if (ai === undefined) {
      ai = asymIds.length;
      asymIndex.set(a, ai);
      asymIds.push(a);
      asymEntity.push(r.label_entity_id ?? '?');
    }
    asym[i] = ai;
    const s = r.label_seq_id!;
    if (s === '.' || s === '?') {
      residue[i] = -1;
      polymerChain[i] = -1;
    } else {
      const key = `${a}:${s}`;
      let ri = residueIndex.get(key);
      if (ri === undefined) residueIndex.set(key, (ri = residueIndex.size));
      residue[i] = ri;
      polymerChain[i] = ai;
    }
    element.push((r.type_symbol ?? 'C').toUpperCase());
    comp.push(r.label_comp_id ?? '?');
    seq[i] = num(r.auth_seq_id ?? r.label_seq_id);
  });
  if (asymIds.length > 0xffff) throw new AssemblyError(`${asymIds.length} chains is more than a Uint16 index holds`);

  const operators = new Map<string, Mat34>();
  for (const r of cats.get('pdbx_struct_oper_list')!) {
    const m = MATRIX_KEYS.map((k) => num(r[k])) as Mat34;
    if (m.some((v) => !Number.isFinite(v))) throw new AssemblyError(`operator ${r.id} is not a full 3×4 matrix`);
    operators.set(r.id!, m);
  }
  const gens = cats.get('pdbx_struct_assembly_gen')!;
  const assemblies: AssemblyDef[] = cats.get('pdbx_struct_assembly')!.map((r) => ({
    id: r.id!,
    details: r.details ?? '',
    oligomericCount: num(r.oligomeric_count),
    gens: gens.filter((g) => g.assembly_id === r.id).map((g) => ({
      opers: g.oper_expression!,
      asyms: g.asym_id_list!.split(',').map((s) => s.trim()).filter(Boolean),
    })),
  }));
  const entities = new Map<string, string>();
  for (const r of cats.get('entity')!) entities.set(r.id!, r.pdbx_description ?? r.type ?? '');
  return {
    id: cats.get('entry')![0]?.id ?? '',
    title: cats.get('struct')![0]?.title ?? '',
    count: n, x, y, z, asym, asymIds, asymEntity,
    residue, residueCount: residueIndex.size, polymerChain,
    element, comp, seq, entities, assemblies, operators,
  };
}

/** One level of detail: its points placed in the assembly, a radius each,
 *  and the asymmetric-unit atom each stands for (a bead: its first). */
export interface AssemblyLevel {
  points: Expanded;
  r: Float32Array;
  atomOf: Uint32Array;
}

export interface BuiltAssembly {
  def: AssemblyDef;
  copies: AssemblyCopy[];
  atoms: AssemblyLevel;
  /** a bead per polymer residue */
  residues: AssemblyLevel;
  /** a bead per polymer chain */
  chains: AssemblyLevel;
  /** centroid of the atoms, and the radius that holds every atom sphere */
  centre: [number, number, number];
  radius: number;
}

/** Expand an assembly at all three levels. `radiusOf` sizes an atom by its
 *  element (protein.ts' vdwRadius). */
export function buildAssembly(u: AsymUnit, assemblyId: string, radiusOf: (element: string) => number): BuiltAssembly {
  const def = u.assemblies.find((a) => a.id === assemblyId);
  if (!def) throw new AssemblyError(`${u.id} has no assembly ${assemblyId} (has ${u.assemblies.map((a) => a.id).join(', ') || 'none'})`);
  const copies = assemblyCopies(def, u.asymIds, u.operators);
  const atomR = Float32Array.from(u.element, radiusOf);
  const level = (points: Expanded, r: ArrayLike<number>, atomOf: (i: number) => number): AssemblyLevel => {
    const lr = new Float32Array(points.count), la = new Uint32Array(points.count);
    for (let k = 0; k < points.count; k++) {
      const s = points.source[k]!;
      lr[k] = r[s]!;
      la[k] = atomOf(s);
    }
    return { points, r: lr, atomOf: la };
  };
  const atoms = level(expandPoints(u, copies), atomR, (i) => i);
  const res = beadsOf(u, u.residue);
  const chn = beadsOf(u, u.polymerChain);
  const residues = level(expandPoints(res, copies), res.r, (i) => res.first[i]!);
  const chains = level(expandPoints(chn, copies), chn.r, (i) => chn.first[i]!);
  const p = atoms.points;
  if (p.count === 0) throw new AssemblyError(`${u.id} assembly ${assemblyId} has no atoms`);
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < p.count; k++) { cx += p.x[k]!; cy += p.y[k]!; cz += p.z[k]!; }
  cx /= p.count; cy /= p.count; cz /= p.count;
  let radius = 0;
  for (let k = 0; k < p.count; k++) {
    const d = Math.hypot(p.x[k]! - cx, p.y[k]! - cy, p.z[k]! - cz) + atoms.r[k]!;
    if (d > radius) radius = d;
  }
  return { def, copies, atoms, residues, chains, centre: [cx, cy, cz], radius };
}
