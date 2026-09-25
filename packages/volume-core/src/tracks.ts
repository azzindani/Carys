// Ported from igv.js track model + jbrowse plugin registry.
// igv: TrackBase config + trackFactory map + registerTrackClass +
// inferFileFormat. jbrowse: TypeRecord registry + Plugin install +
// TrackType/DisplayType + preprocessTrackConfigSnapshot. No rendering/MST.

export type GenomeTrackType =
  | 'sequence' | 'variant' | 'alignment' | 'annotation'
  | 'wig' | 'seg' | 'interaction';

export interface TrackConfig {
  type: GenomeTrackType;
  url?: string;
  indexURL?: string;
  format?: string;
  name?: string;
  id?: string;
  order?: number;
  height?: number;
  color?: string;
  visibilityWindow?: number;
  min?: number;
  max?: number;
}

const trackClasses = new Map<string, GenomeTrackType[]>();

export function registerTrackClass(type: GenomeTrackType, alias?: string): void {
  const key = alias ?? type;
  if (!trackClasses.has(key)) trackClasses.set(key, []);
  trackClasses.get(key)!.push(type);
}

export function knownTrackTypes(): string[] {
  return [...trackClasses.keys()];
}

/** Fill defaults + auto display id (jbrowse preprocessTrackConfigSnapshot). */
export function preprocessTrackConfig(c: TrackConfig): Required<Pick<TrackConfig, 'height' | 'id' | 'name'>> & TrackConfig {
  return {
    ...c,
    height: c.height ?? 50,
    id: c.id ?? c.name ?? c.type,
    name: c.name ?? c.type,
  };
}

/** Minimal plugin registry (jbrowse TypeRecord shape, no MST/React). */
export class PluginRegistry<T> {
  private map = new Map<string, T>();
  register(name: string, value: T): void {
    this.map.set(name, value);
  }
  get(name: string): T {
    const v = this.map.get(name);
    if (!v) throw new Error(`Not registered: ${name}. Registered: ${[...this.map.keys()].join(', ')}`);
    return v;
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
  all(): string[] {
    return [...this.map.keys()];
  }
}
