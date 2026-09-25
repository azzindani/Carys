// Biological assemblies (H7): an mmCIF entry deposits one asymmetric unit
// and says how to build the assembly from it — pdbx_struct_assembly_gen
// lists, per assembly, which chains (label_asym_id) each operator
// expression applies to, and pdbx_struct_oper_list holds the operators.
// A virus capsid is 60 (or 12, or 5) copies of its asymmetric unit, so the
// whole shell is only ever this expansion. Pure, columnar, no DOM.
//
// Coarse levels: a residue bead and a chain bead each stand for their
// atoms at the same volume, so a million-atom shell can be drawn as ~125 k
// residues or a few hundred chains. Beads are made on the asymmetric unit
// and expanded with the same operators (a rigid motion moves a centroid to
// the centroid of the moved atoms, and keeps the volume).

/** 3×4 row-major affine operator: x' = R·x + t. */
export type Mat34 = [number, number, number, number, number, number, number, number, number, number, number, number];

export const MAT34_IDENTITY: Mat34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export class AssemblyError extends Error {
  constructor(detail: string) {
    super(`assembly: ${detail}`);
  }
}

/** a·b (apply b first, then a). */
export function mulMat34(a: Mat34, b: Mat34): Mat34 {
  const o = new Array<number>(12) as Mat34;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}

/** Apply an operator to one point. */
export function applyMat34(m: Mat34, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

/** One parenthesised group: "1-60", "1,6,11", "X0", "P". Ranges only
 *  between integers. */
function operGroup(group: string, expr: string): string[] {
  const ids: string[] = [];
  for (const part of group.split(',')) {
    const p = part.trim();
    if (!p) throw new AssemblyError(`empty operator in "${expr}"`);
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (b < a) throw new AssemblyError(`descending range ${p} in "${expr}"`);
      for (let k = a; k <= b; k++) ids.push(String(k));
    } else if (/^[A-Za-z0-9_]+$/.test(p)) ids.push(p);
    else throw new AssemblyError(`bad operator "${p}" in "${expr}"`);
  }
  return ids;
}

/** An oper_expression → the operator sequences it denotes. "(1-60)" is
 *  sixty one-operator sequences; "(X0)(1-60)" is the product: X0 after
 *  each of 1–60, written ['X0', k] and composed left to right as matrices
 *  (so the rightmost operator applies first, as mmCIF defines). */
export function parseOperExpression(expr: string): string[][] {
  const e = expr.trim();
  if (!e) throw new AssemblyError('empty oper_expression');
  const groups: string[][] = [];
  if (e.startsWith('(')) {
    const re = /\(([^()]*)\)/gy;
    let m: RegExpExecArray | null;
    let at = 0;
    while ((m = re.exec(e)) !== null) {
      groups.push(operGroup(m[1]!, expr));
      at = re.lastIndex;
    }
    if (at !== e.length) throw new AssemblyError(`unbalanced "${expr}"`);
  } else groups.push(operGroup(e, expr));
  let out: string[][] = [[]];
  for (const g of groups) {
    const next: string[][] = [];
    for (const seq of out) for (const id of g) next.push([...seq, id]);
    out = next;
  }
  return out;
}

/** Compose an operator sequence (left to right as matrix products). */
export function composeOps(ids: string[], ops: Map<string, Mat34>): Mat34 {
  let m = MAT34_IDENTITY;
  for (const id of ids) {
    const o = ops.get(id);
    if (!o) throw new AssemblyError(`operator ${id} is not in pdbx_struct_oper_list`);
    m = mulMat34(m, o);
  }
  return m;
}

export interface AssemblyGen {
  /** pdbx_struct_assembly_gen.oper_expression */
  opers: string;
  /** label_asym_id list the expression applies to */
  asyms: string[];
}

export interface AssemblyDef {
  id: string;
  details: string;
  /** pdbx_struct_assembly.oligomeric_count ('?' → NaN) */
  oligomericCount: number;
  gens: AssemblyGen[];
}

/** One copy of one asymmetric-unit chain in the assembly. */
export interface AssemblyCopy {
  /** index into the unit's asymIds */
  asym: number;
  ops: string[];
  /** Chain name as RCSB's assembly files write it: "A" under operator 1,
   *  else "A-6"; a product joins its operators with x ("A-X0x6"). */
  label: string;
  m: Mat34;
}

/** Every chain copy of an assembly, gen by gen, operator by operator,
 *  chain by chain. A chain the unit lacks fails loud. */
export function assemblyCopies(def: AssemblyDef, asymIds: string[], ops: Map<string, Mat34>): AssemblyCopy[] {
  const index = new Map(asymIds.map((id, i) => [id, i]));
  const out: AssemblyCopy[] = [];
  for (const g of def.gens) {
    const seqs = parseOperExpression(g.opers);
    const asyms = g.asyms.map((a) => {
      const i = index.get(a);
      if (i === undefined) throw new AssemblyError(`assembly ${def.id} names chain ${a}, which has no atoms`);
      return i;
    });
    for (const seq of seqs) {
      const m = composeOps(seq, ops);
      const suffix = seq.length === 1 && seq[0] === '1' ? '' : `-${seq.join('x')}`;
      for (const a of asyms) out.push({ asym: a, ops: seq, label: `${asymIds[a]}${suffix}`, m });
    }
  }
  return out;
}

/** Points tagged by the asymmetric-unit chain they belong to. */
export interface AsymPoints {
  count: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  /** index into asymIds */
  asym: ArrayLike<number>;
}

export interface Expanded {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** copy index (into the copies list) per point */
  copy: Uint32Array;
  /** source point index per point */
  source: Uint32Array;
}

/** Expand points by the copies: each copy places every point of its chain
 *  through its operator, in the chain's point order. */
export function expandPoints(p: AsymPoints, copies: AssemblyCopy[]): Expanded {
  const byAsym = new Map<number, number[]>();
  for (let i = 0; i < p.count; i++) {
    const a = p.asym[i]!;
    let list = byAsym.get(a);
    if (!list) byAsym.set(a, (list = []));
    list.push(i);
  }
  let count = 0;
  for (const c of copies) count += byAsym.get(c.asym)?.length ?? 0;
  const out: Expanded = {
    count,
    x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count),
    copy: new Uint32Array(count), source: new Uint32Array(count),
  };
  let k = 0;
  copies.forEach((c, ci) => {
    const m = c.m;
    for (const i of byAsym.get(c.asym) ?? []) {
      const x = p.x[i]!, y = p.y[i]!, z = p.z[i]!;
      out.x[k] = m[0] * x + m[1] * y + m[2] * z + m[3];
      out.y[k] = m[4] * x + m[5] * y + m[6] * z + m[7];
      out.z[k] = m[8] * x + m[9] * y + m[10] * z + m[11];
      out.copy[k] = ci;
      out.source[k] = i;
      k++;
    }
  });
  return out;
}

/** Radius of the sphere one protein heavy atom fills at protein density
 *  (1.21 Å³/Da × ~13.3 Da per heavy atom ≈ 16.1 Å³). A bead of n atoms
 *  gets BEAD_ATOM_RADIUS·∛n, so the coarse levels keep the shell's
 *  volume. */
export const BEAD_ATOM_RADIUS = 1.57;

export interface Beads extends AsymPoints {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  asym: Uint16Array;
  r: Float32Array;
  /** atoms per bead */
  atoms: Uint32Array;
  /** first source atom of each bead (for picking back to a residue) */
  first: Uint32Array;
}

/** One bead per group id ≥ 0 (atoms with group −1 are left out): the
 *  centroid of its atoms, radius BEAD_ATOM_RADIUS·∛n. Groups must not
 *  span chains. */
export function beadsOf(p: AsymPoints, group: ArrayLike<number>): Beads {
  let n = 0;
  for (let i = 0; i < p.count; i++) if (group[i]! + 1 > n) n = group[i]! + 1;
  const b: Beads = {
    count: n,
    x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n),
    asym: new Uint16Array(n), r: new Float32Array(n), atoms: new Uint32Array(n),
    first: new Uint32Array(n),
  };
  for (let i = 0; i < p.count; i++) {
    const g = group[i]!;
    if (g < 0) continue;
    if (b.atoms[g] === 0) {
      b.asym[g] = p.asym[i]!;
      b.first[g] = i;
    } else if (b.asym[g] !== p.asym[i]) {
      throw new AssemblyError(`group ${g} spans chains ${b.asym[g]} and ${p.asym[i]}`);
    }
    b.x[g] += p.x[i]!;
    b.y[g] += p.y[i]!;
    b.z[g] += p.z[i]!;
    b.atoms[g]++;
  }
  for (let g = 0; g < n; g++) {
    const a = b.atoms[g]!;
    if (a === 0) throw new AssemblyError(`group ${g} has no atoms`);
    b.x[g] /= a;
    b.y[g] /= a;
    b.z[g] /= a;
    b.r[g] = BEAD_ATOM_RADIUS * Math.cbrt(a);
  }
  return b;
}
