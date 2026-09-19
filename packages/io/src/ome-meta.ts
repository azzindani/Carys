// Ported from Viv zarr/ome-zarr.ts RootAttrs + Vizarr ome.ts parseOmeroMeta.
// OMERO windows -> contrast/domain/colors/names; defaultMeta falls back to
// low-res channel stats. CPU-only, no deck.gl.

export interface OmeroChannelWindow {
  min?: number; max?: number; start: number; end: number;
}

export interface OmeroChannel {
  color: string;
  label: string;
  window: OmeroChannelWindow;
  visible?: boolean;
}

export interface OmeroMeta {
  channels: OmeroChannel[];
  name?: string;
  defaultT?: number;
  defaultZ?: number;
}

export interface ChannelDisplay {
  color: [number, number, number];
  label: string;
  contrastLimits: [number, number];
  domain: [number, number];
  visible: boolean;
}

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** OMERO-first display defaults (Vizarr parseOmeroMeta). */
export function parseOmeroMeta(omero: OmeroMeta): ChannelDisplay[] {
  return omero.channels.map((c) => ({
    color: hexToRGB(c.color),
    label: c.label,
    contrastLimits: [c.window.start, c.window.end],
    domain: [c.window.min ?? c.window.start, c.window.max ?? c.window.end],
    visible: c.visible ?? true,
  }));
}
