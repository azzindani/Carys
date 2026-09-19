// Ported from VolView store/tools factory (useAnnotationTool.ts,
// defineAnnotationToolStore.ts, rulers.ts, rectangles.ts, polygons.ts).
// Generic annotation store: tools hold {imageID, slice, frameOfReference,
// points, label}. SVG overlays + VTK widgets skipped (UI phase).

export interface FrameOfReference {
  planeOrigin: [number, number, number];
  planeNormal: [number, number, number];
}

export interface AnnotationBase {
  id: string;
  imageID: string;
  slice: number;
  frameOfReference: FrameOfReference;
  label: string;
  color: string;
}

export interface RulerAnnotation extends AnnotationBase {
  firstPoint: [number, number, number];
  secondPoint: [number, number, number];
}

export interface RectAnnotation extends AnnotationBase {
  firstPoint: [number, number, number];
  secondPoint: [number, number, number];
  fillColor: string;
}

export interface PolygonAnnotation extends AnnotationBase {
  points: [number, number, number][];
}

export function rulerLength(a: RulerAnnotation): number {
  const dx = a.firstPoint[0] - a.secondPoint[0];
  const dy = a.firstPoint[1] - a.secondPoint[1];
  const dz = a.firstPoint[2] - a.secondPoint[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class AnnotationStore<T extends AnnotationBase> {
  private map = new Map<string, T>();
  add(a: T): void {
    this.map.set(a.id, a);
  }
  remove(id: string): void {
    this.map.delete(id);
  }
  get(id: string): T | undefined {
    return this.map.get(id);
  }
  removeForImage(imageID: string): void {
    for (const [k, v] of this.map) if (v.imageID === imageID) this.map.delete(k);
  }
  get all(): T[] {
    return [...this.map.values()];
  }
}
