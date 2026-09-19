// Port of Papaya overlay model (params["images"], params["overlay"]={min,max}).
// CPU-only: base volume + N overlays, each with own LUT range + opacity.
// Composite happens in Worker on Uint8 rows, never in GPU.
import type { Volume } from './types.js';
import { applyWindowLevel, type WindowLevel } from './lut.js';

export interface Overlay {
  volume: Volume;
  /** display range in source units (Papaya: params["file"]={min,max}) */
  min: number;
  max: number;
  opacity: number; // 0..1
  /** optional LUT name, e.g. 'grayscale' | 'hot' | 'jet' */
  lut?: string;
}

export function overlayToWindowLevel(o: Overlay): WindowLevel {
  return { center: (o.min + o.max) / 2, width: o.max - o.min || 1 };
}

/** Composite one row of base + overlays into RGBA. Pure, testable. */
export function compositeRow(
  baseVals: ArrayLike<number>,
  baseWL: WindowLevel,
  overlays: { vals: ArrayLike<number>; overlay: Overlay }[],
  outRgba: Uint8ClampedArray,
): void {
  for (let i = 0; i < baseVals.length; i++) {
    const g = applyWindowLevel(baseVals[i], baseWL);
    let r = g, gr = g, b = g;
    let a = 255;
    for (const { vals, overlay } of overlays) {
      const wl = overlayToWindowLevel(overlay);
      const v = applyWindowLevel(vals[i], wl);
      if (v > 0) {
        // simple hot-tint overlay, alpha blend
        const o = overlay.opacity;
        r = Math.round(r * (1 - o) + 255 * o);
        gr = Math.round(gr * (1 - o) + v * o * 0.4);
        b = Math.round(b * (1 - o) + 0);
      }
    }
    const o4 = i * 4;
    outRgba[o4] = r; outRgba[o4 + 1] = gr; outRgba[o4 + 2] = b; outRgba[o4 + 3] = a;
  }
}
