// Multi-label SEG roundtrip: labelmap (0 = background, 1..N = segments)
// <-> per-segment binary masks + segments table. The binary mask path
// (session.editMask) stays untouched — this is the interchange layer for
// DICOM-SEG import/export with segment names preserved instead of the
// current largest-wins collapse.
export interface LabelSegment {
  value: number;
  label: string;
}

/** Split a labelmap into one binary mask per non-zero label value. */
export function labelmapToMasks(labelmap: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (let i = 0; i < labelmap.length; i++) {
    const v = labelmap[i]!;
    if (v === 0) continue;
    let m = out.get(v);
    if (!m) {
      m = new Uint8Array(labelmap.length);
      out.set(v, m);
    }
    m[i] = 1;
  }
  return out;
}

/** Merge per-segment binary masks into one labelmap (first writer wins). */
export function masksToLabelmap(
  masks: Map<number, Uint8Array>, length: number,
): Uint8Array {
  const out = new Uint8Array(length);
  const keys = [...masks.keys()].sort((a, b) => a - b);
  for (const v of keys) {
    if (!Number.isInteger(v) || v <= 0 || v > 255) {
      throw new RangeError(`multilabel-bad-value: ${v}`);
    }
    const m = masks.get(v)!;
    if (m.length !== length) throw new RangeError(`multilabel-length: ${m.length} vs ${length}`);
    for (let i = 0; i < length; i++) if (m[i] && out[i] === 0) out[i] = v;
  }
  return out;
}

/**
 * Segments table for a labelmap: value + voxel count + volume, labels
 * resolved from the provided list (unknown values keep `Segment N`).
 * Sorted by value ascending.
 */
export function segmentsTable(
  labelmap: Uint8Array,
  spacing: [number, number, number],
  labels: LabelSegment[] = [],
): { value: number; label: string; voxels: number; volumeMm3: number }[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < labelmap.length; i++) {
    const v = labelmap[i]!;
    if (v === 0) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const names = new Map(labels.map((l) => [l.value, l.label] as const));
  const cell = spacing[0] * spacing[1] * spacing[2];
  return [...counts.keys()].sort((a, b) => a - b).map((v) => ({
    value: v,
    label: names.get(v) ?? `Segment ${v}`,
    voxels: counts.get(v)!,
    volumeMm3: counts.get(v)! * cell,
  }));
}

/** One-row-per-segment CSV of the segments table. */
export function segmentsTableToCSV(
  rows: ReturnType<typeof segmentsTable>,
): string {
  const cell = (v: string | number): string => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [
    ['value', 'label', 'voxels', 'volume_mm3'].join(','),
    ...rows.map((r) =>
      [r.value, r.label, r.voxels, Math.round(r.volumeMm3 * 1000) / 1000].map(cell).join(',')),
  ].join('\n') + '\n';
}
