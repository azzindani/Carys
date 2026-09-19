// Ported from NGL src/ (v2.5.0, MIT): representation catalogue + params,
// RadiusFactory, element/sstruc color tables, stage/component/rep layering,
// selection subset, assembly expansion. CPU projection; all impostor/WebGL
// paths skipped.

export interface Atom {
  x: number; y: number; z: number;
  element: string;
  chain: string;
  resSeq: number;
  resName: string;
  atomName?: string;
  bfactor?: number;
  /** AlphaFold pLDDT 0..100, optional */
  plddt?: number;
}

export type ProteinRep =
  | 'spacefill' | 'ball+stick' | 'licorice' | 'line'
  | 'cartoon' | 'trace' | 'tube' | 'ribbon' | 'backbone' | 'point';

export interface RepParams {
  rep: ProteinRep;
  /** NGL sele subset: chain/resno/atomname */
  sele?: string;
  colorScheme?: ProteinColorBy;
  radiusType?: 'vdw' | 'covalent' | 'bfactor' | 'sstruc' | 'size';
  radiusScale?: number;
  aspectRatio?: number;
  assembly?: string;
}

export const REP_DEFAULTS: Record<ProteinRep, Partial<RepParams>> = {
  spacefill: { radiusType: 'vdw', radiusScale: 1 },
  'ball+stick': { radiusType: 'size', radiusScale: 0.15, aspectRatio: 2.0 },
  licorice: { radiusType: 'size', radiusScale: 0.15, aspectRatio: 1.0 },
  line: { radiusScale: 1 },
  cartoon: { radiusType: 'sstruc', radiusScale: 0.7, aspectRatio: 5.0 },
  trace: { radiusScale: 1 },
  tube: { radiusScale: 2.0 },
  ribbon: { radiusType: 'sstruc', radiusScale: 4.0 },
  backbone: { radiusScale: 0.25, aspectRatio: 1.0 },
  point: { radiusScale: 1 },
};

export type ProteinColorBy =
  | 'element' | 'chainname' | 'chainid' | 'chain' | 'resname' | 'residue'
  | 'sstruc' | 'bfactor' | 'occupancy' | 'hydrophobicity'
  | 'plddt' | 'uniform';

/** Jmol element table (NGL element-colormaker). */
const ELEMENT_JMOL: Record<string, [number, number, number]> = {
  C: [144, 144, 144], N: [48, 80, 248], O: [255, 13, 13],
  S: [255, 255, 48], H: [255, 255, 255], P: [255, 128, 0],
  FE: [224, 102, 51],
};

/** Secondary-structure colors (NGL sstruc-colormaker). */
const SSTRUC_COLORS: Record<string, [number, number, number]> = {
  h: [255, 0, 128], g: [160, 0, 128], i: [96, 0, 128],
  e: [255, 200, 0], b: [255, 200, 0], t: [96, 128, 255],
  coil: [255, 255, 255],
};

export function elementColor(element: string): [number, number, number] {
  return ELEMENT_JMOL[element.toUpperCase()] ?? [255, 0, 255];
}

export function sstrucColor(sstruc: string): [number, number, number] {
  return SSTRUC_COLORS[sstruc] ?? SSTRUC_COLORS.coil;
}

/** VDW radii subset (NGL RadiusFactory, CPU port). */
const VDW_RADII: Record<string, number> = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, FE: 1.56,
};

export function atomRadius(
  atom: Atom,
  radiusType: RepParams['radiusType'] = 'vdw',
  scale = 1,
): number {
  let r: number;
  switch (radiusType) {
    case 'covalent':
      r = (VDW_RADII[atom.element.toUpperCase()] ?? 1.7) * 0.75;
      break;
    case 'bfactor':
      r = 0.01 * (atom.bfactor ?? 20);
      break;
    case 'sstruc':
      r = 0.25;
      break;
    case 'size':
      r = 0.15;
      break;
    default:
      r = VDW_RADII[atom.element.toUpperCase()] ?? 1.7;
  }
  return Math.min(10, r * scale);
}

/** Stage -> component -> representation (NGL layering, CPU shapes). */
export interface ComponentSpec {
  name: string;
  format: 'pdb' | 'mmcif' | 'bcif';
  ref: string;
}

export interface RepresentationSpec extends RepParams {
  component: string;
}

/**
 * Rotate atoms about their centroid (orbit around Y, then tilt around X),
 * matching the rasterizer's convention. Pure; feeds projectAtoms.
 */
export function rotateAtoms(atoms: Atom[], orbit: number, tilt: number): Atom[] {
  if (atoms.length === 0) return [];
  let cx = 0, cy = 0, cz = 0;
  for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z; }
  cx /= atoms.length; cy /= atoms.length; cz /= atoms.length;
  const cy0 = Math.cos(orbit), sy0 = Math.sin(orbit);
  const cx0 = Math.cos(tilt), sx0 = Math.sin(tilt);
  return atoms.map((a) => {
    const x = a.x - cx, y = a.y - cy, z = a.z - cz;
    const x1 = x * cy0 + z * sy0;
    const z1 = -x * sy0 + z * cy0;
    const y1 = y * cx0 - z1 * sx0;
    const z2 = y * sx0 + z1 * cx0;
    return { ...a, x: x1 + cx, y: y1 + cy, z: z2 + cz };
  });
}

/** Orthographic CPU projection of atoms to 2D points. */
export function projectAtoms(
  atoms: Atom[],
  view: { scale: number; cx: number; cy: number },
): { x: number; y: number; atom: Atom }[] {
  return atoms.map((atom) => ({
    x: view.cx + atom.x * view.scale,
    y: view.cy - atom.y * view.scale,
    atom,
  }));
}

/** pLDDT -> blue/red ramp (AlphaFold style) for CPU paint. */
export function plddtColor(v: number): [number, number, number] {
  if (v >= 90) return [0, 83, 214]; // dark blue
  if (v >= 70) return [101, 183, 255]; // light blue
  if (v >= 50) return [255, 219, 19]; // yellow
  return [255, 125, 69]; // orange/red
}
