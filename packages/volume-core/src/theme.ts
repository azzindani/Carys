// Ported from Mol* mol-theme/color palettes as pure (atom -> RGB) fns.
// Providers: chain-id, element-symbol, residue-name, sequence-id. Skips:
// registries/ParamDefinition, stateful overpaint/transparency overlays.

import type { AtomRow } from './structure.js';

export type RGB = [number, number, number];

const CHAIN_PALETTE: RGB[] = [
  [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40],
  [148, 103, 189], [140, 86, 75], [227, 119, 194], [127, 127, 127],
];

const ELEMENT_COLORS: Record<string, RGB> = {
  C: [144, 144, 144], N: [48, 80, 248], O: [255, 13, 13],
  S: [255, 255, 48], H: [255, 255, 255], P: [255, 128, 0],
  FE: [224, 102, 51],
};

const RESIDUE_COLORS: Record<string, RGB> = {
  ALA: [200, 200, 200], GLY: [235, 235, 235], LEU: [172, 235, 172],
  ILE: [172, 235, 172], VAL: [172, 235, 172], PHE: [200, 200, 100],
  TYR: [200, 200, 100], TRP: [200, 200, 100], SER: [255, 200, 200],
  THR: [255, 200, 200], LYS: [100, 100, 255], ARG: [100, 100, 255],
  ASP: [255, 100, 100], GLU: [255, 100, 100],
};

export function colorByChain(atom: AtomRow, chainOrder: string[]): RGB {
  const i = Math.max(0, chainOrder.indexOf(atom.label_asym_id));
  return CHAIN_PALETTE[i % CHAIN_PALETTE.length];
}

export function colorByElement(atom: AtomRow): RGB {
  return ELEMENT_COLORS[atom.type_symbol] ?? [255, 0, 255];
}

export function colorByResidue(atom: AtomRow): RGB {
  return RESIDUE_COLORS[atom.label_comp_id] ?? [200, 200, 200];
}

export function colorBySequenceId(atom: AtomRow, min: number, max: number): RGB {
  const t = max > min ? (atom.label_seq_id - min) / (max - min) : 0;
  return [Math.round(255 * t), Math.round(100 * (1 - t)), Math.round(255 * (1 - t))];
}
