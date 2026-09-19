// Ported from Vizarr io.ts classifySource + utils.ts resolveAttrs/getNgffAxes.
// Routes an opened Zarr node to array/plate/well/multiscales. v0.5 {ome:}
// wrapper unwrap included. Store open + rendering skipped (UI phase).

export type OmeKind =
  | 'array' | 'plate' | 'well' | 'multiscales'
  | 'bioformats2raw' | 'empty-group' | 'unknown';

export function resolveAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  if (attrs && typeof attrs === 'object' && 'ome' in attrs) {
    return (attrs as { ome: Record<string, unknown> }).ome;
  }
  return attrs;
}

export function classifySource(
  isGroup: boolean,
  attrs: Record<string, unknown>,
  hasPath: boolean,
): OmeKind {
  const a = resolveAttrs(attrs);
  if (!isGroup) return 'array';
  if ('plate' in a) return 'plate';
  if ('well' in a) return 'well';
  if ('multiscales' in a) return 'multiscales';
  if ('bioformats2raw.layout' in a) return 'bioformats2raw';
  if (hasPath) return 'empty-group';
  return 'unknown';
}

const DEFAULT_AXES = ['t', 'c', 'z', 'y', 'x'];

/** NGFF axes across versions (v0.1 default, v0.3 strings, v0.4 objects). */
export function getNgffAxes(multiscales: { axes?: unknown } | undefined): string[] {
  const axes = multiscales?.axes;
  if (!axes) return [...DEFAULT_AXES];
  if (Array.isArray(axes)) {
    if (axes.length > 0 && typeof axes[0] === 'string') return [...(axes as string[])];
    return (axes as { name: string }[]).map((a) => a.name);
  }
  return [...DEFAULT_AXES];
}
