// Ported from Mol* mol-data/int (ordered-set, sorted-array, interval,
// segmentation) + db/table lite. Zero WebGL. Index primitives behind all
// hierarchy + selection.

export type OrderedSet = number[];

export function orderedUnion(a: OrderedSet, b: OrderedSet): OrderedSet {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

export function orderedIntersect(a: OrderedSet, b: OrderedSet): OrderedSet {
  const sb = new Set(b);
  return a.filter((x) => sb.has(x));
}

export interface Interval {
  start: number;
  end: number;
}

export function intervalToSet(iv: Interval): OrderedSet {
  const out: number[] = [];
  for (let i = iv.start; i <= iv.end; i++) out.push(i);
  return out;
}

/** Contiguous segmentation: offsets[k]..offsets[k+1] = segment k. */
export function segmentOf(offsets: number[], index: number): number {
  let lo = 0, hi = offsets.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index < offsets[mid]) hi = mid - 1;
    else if (index >= offsets[mid + 1]) lo = mid + 1;
    else return mid;
  }
  return -1;
}
