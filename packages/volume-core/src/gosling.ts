// Ported from Gosling grammar subset (gosling.schema.ts).
// SingleTrack core + Channel shorthand + Json/Csv data + minimal transforms.
// Skips: HiGlass, tiles, circular, linking, overlays, themes, editor.

export type GoslingMark = 'point' | 'line' | 'bar' | 'area' | 'rect' | 'text' | 'rule';

export type FieldType = 'genomic' | 'nominal' | 'quantitative';

export type GoslingChannel =
  | {
      field?: string;
      type?: FieldType;
      domain?: number[] | string[] | { chromosome: string; interval: [number, number] };
      range?: number[] | string[];
      axis?: 'top' | 'bottom' | 'left' | 'right' | 'none';
      aggregate?: 'max' | 'min' | 'mean' | 'count';
    }
  | { value: number | string };

export type GoslingData =
  | { type: 'json'; values: Record<string, unknown>[]; chromosomeField?: string }
  | { type: 'csv'; url: string; separator?: string; chromosomeField?: string };

export type DataTransform =
  | { type: 'filter'; field: string; oneOf?: (string | number)[]; inRange?: [number, number]; not?: boolean }
  | { type: 'log'; field: string; base?: number; newField?: string }
  | { type: 'concat'; fields: string[]; newField: string; separator?: string };

export interface GoslingTrack {
  id?: string;
  title?: string;
  width?: number;
  height?: number;
  data: GoslingData;
  mark: GoslingMark;
  x?: GoslingChannel;
  xe?: GoslingChannel;
  y?: GoslingChannel;
  color?: GoslingChannel;
  size?: GoslingChannel;
  row?: GoslingChannel;
  opacity?: GoslingChannel;
  text?: GoslingChannel;
  dataTransform?: DataTransform[];
}

export interface GoslingSpec {
  title?: string;
  views: { tracks: GoslingTrack[] }[];
}

/** CPU data transforms (Gosling data-transform.ts subset). */
export function applyTransforms(
  rows: Record<string, unknown>[],
  transforms: DataTransform[] = [],
): Record<string, unknown>[] {
  let out = rows;
  for (const t of transforms) {
    if (t.type === 'filter') {
      out = out.filter((r) => {
        const v = r[t.field];
        let hit = false;
        if (t.oneOf !== undefined) hit = t.oneOf.includes(v as string | number);
        else if (t.inRange !== undefined && typeof v === 'number') {
          hit = v >= t.inRange[0] && v <= t.inRange[1];
        }
        return t.not ? !hit : hit;
      });
    } else if (t.type === 'log') {
      const base = t.base ?? 10;
      const nf = t.newField ?? t.field;
      out = out.map((r) => ({
        ...r,
        [nf]: typeof r[t.field] === 'number' ? Math.log(r[t.field] as number) / Math.log(base) : r[t.field],
      }));
    } else if (t.type === 'concat') {
      const sep = t.separator ?? ' ';
      out = out.map((r) => ({
        ...r,
        [t.newField]: t.fields.map((f) => String(r[f] ?? '')).join(sep),
      }));
    }
  }
  return out;
}
