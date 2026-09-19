// Ported from Mol* element/location.ts + loci.ts + bundle.ts.
// Location (1 atom) -> Loci (runtime) -> Bundle (serializable for IPC).
// Skips: StructureSelection algebra impl, MolQL parser (see molql.ts).

export interface Location {
  kind: 'element-location';
  unit: number;
  element: number;
}

export interface Loci {
  kind: 'element-loci';
  elements: { unit: number; indices: number[] }[];
}

export function lociAll(units: { unit: number; size: number }[]): Loci {
  return {
    kind: 'element-loci',
    elements: units.map((u) => ({
      unit: u.unit,
      indices: Array.from({ length: u.size }, (_, i) => i),
    })),
  };
}

export function lociNone(): Loci {
  return { kind: 'element-loci', elements: [] };
}

export function lociSize(l: Loci): number {
  return l.elements.reduce((n, e) => n + e.indices.length, 0);
}

/** Serializable bundle (Mol* Bundle: groupedUnits + set + ranges). */
export interface BundleElement {
  unit: number;
  set: number[];
  ranges: [number, number][];
}

export interface Bundle {
  hash: string;
  elements: BundleElement[];
}

export function bundleFromLoci(l: Loci): Bundle {
  const elements = l.elements.map((e) => {
    const set = [...e.indices].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let s = -1, p = -2;
    for (const i of set) {
      if (i === p + 1) {
        p = i;
      } else {
        if (s >= 0) ranges.push([s, p]);
        s = i;
        p = i;
      }
    }
    if (s >= 0) ranges.push([s, p]);
    return { unit: e.unit, set, ranges };
  });
  return { hash: elements.map((e) => `${e.unit}:${e.ranges.map((r) => r.join('-')).join(',')}`).join('|'), elements };
}

export function bundleToLoci(b: Bundle): Loci {
  return {
    kind: 'element-loci',
    elements: b.elements.map((e) => ({ unit: e.unit, indices: e.set })),
  };
}
