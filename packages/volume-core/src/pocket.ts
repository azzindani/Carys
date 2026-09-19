// Ligand pocket query: cavity detection over a residue-level neighbor
// graph. A pocket = a connected run of surface-exposed residues (fewer
// neighbors than `buriedCutoff`) of at least `minSize` residues. Surface
// exposure comes from CA–CA contacts within `contactA`, no solvent model —
// the honest CPU cut: finds clefts and grooves, not buried cavities with
// no surface mouth. Pure, no DOM.
import type { ResidueRef } from './sequence.js';

export interface PocketResidue {
  index: number;
  chain: string;
  seqId: number;
  label: string;
}

export interface Pocket {
  residues: PocketResidue[];
  /** mean neighbor count (lower = more exposed) */
  meanNeighbors: number;
}

/**
 * Find pockets over residues with 3D CA positions. `pos` maps residue
 * index → [x, y, z]; residues missing from the map are skipped (ligands
 * and hetero residues carry no CA). Throws on empty input or bad params.
 */
export function findPockets(
  residues: ResidueRef[],
  pos: Map<number, [number, number, number]>,
  opts: { contactA?: number; buriedCutoff?: number; minSize?: number } = {},
): Pocket[] {
  const { contactA = 8, buriedCutoff = 6, minSize = 3 } = opts;
  if (!(contactA > 0)) throw new RangeError(`pocket-contact: ${contactA}`);
  if (!(buriedCutoff >= 0)) throw new RangeError(`pocket-cutoff: ${buriedCutoff}`);
  if (!Number.isInteger(minSize) || minSize < 1) throw new RangeError(`pocket-minsize: ${minSize}`);
  const have = residues.filter((r) => pos.has(r.index));
  if (have.length === 0) throw new RangeError('pocket-empty: no residues with positions');
  // neighbor counts via CA contacts
  const nbr = new Map<number, number>();
  for (const r of have) nbr.set(r.index, 0);
  for (let a = 0; a < have.length; a++) {
    for (let b = a + 1; b < have.length; b++) {
      const pa = pos.get(have[a]!.index)!, pb = pos.get(have[b]!.index)!;
      const d2 = (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2;
      if (d2 <= contactA * contactA) {
        nbr.set(have[a]!.index, nbr.get(have[a]!.index)! + 1);
        nbr.set(have[b]!.index, nbr.get(have[b]!.index)! + 1);
      }
    }
  }
  // exposed residues link into pockets when adjacent (chain neighbors or
  // spatial contacts) — union-find over the exposed set
  const exposed = have.filter((r) => nbr.get(r.index)! < buriedCutoff);
  const parent = new Map(exposed.map((r) => [r.index, r.index]));
  const find = (x: number): number => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const link = (a: number, b: number): void => { parent.set(find(a), find(b)); };
  // spatial contacts only: chain adjacency would weld every exposed run
  // to its buried neighbors (learned the hard way — residue 7 bridged the
  // helix to the loop). Sequence runs still group via spatial contacts at
  // normal CA spacing (3.8Å < contactA).
  const expIdx = new Set(exposed.map((r) => r.index));
  for (let a = 0; a < exposed.length; a++) {
    for (let b = a + 1; b < have.length; b++) {
      const rb = have[b]!;
      if (!expIdx.has(rb.index)) continue;
      const ra = exposed[a]!;
      const pa = pos.get(ra.index)!, pb = pos.get(rb.index)!;
      const d2 = (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2;
      if (d2 <= contactA * contactA) link(ra.index, rb.index);
    }
  }
  const groups = new Map<number, PocketResidue[]>();
  for (const r of exposed) {
    const root = find(r.index);
    const g = groups.get(root);
    const pr: PocketResidue = { index: r.index, chain: r.chain, seqId: r.seqId, label: r.label };
    if (g) g.push(pr);
    else groups.set(root, [pr]);
  }
  const out: Pocket[] = [];
  for (const rs of groups.values()) {
    if (rs.length < minSize) continue;
    const mean = rs.reduce((s, r) => s + nbr.get(r.index)!, 0) / rs.length;
    out.push({ residues: rs.sort((a, b) => a.index - b.index), meanNeighbors: mean });
  }
  // largest pocket first (the likely active site)
  out.sort((a, b) => b.residues.length - a.residues.length);
  return out;
}
