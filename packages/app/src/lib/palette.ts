/** Canvas-2D palette: the same accents the CSS `:root` tokens define, for
 *  code that paints pixels instead of DOM. Keep VALUES in sync with
 *  `index.css` by hand — canvas contexts can't read CSS vars cheaply per
 *  frame, so this module is the single source on the JS side.
 *  NOTE: wire asserts the fiber-view background (FIBER_BG); change it only
 *  together with `test/e2e/wire.mjs`. */
export const ACCENT = '#2dd4bf';
export const ACCENT_HI = '#5eead4';
export const ACCENT_DIM = 'rgba(45,212,191,0.55)';
export const ACCENT_DIM_FILL = 'rgba(45,212,191,0.9)';
export const ON_ACCENT = '#06110f';
/** Editable-mask tint stamped over slice pixels (channels written raw). */
export const MASK_TINT: readonly [number, number, number] = [255, 60, 60];
/** Segmentation label colours in the 2D panes (F14), label 1 first: the
 *  mask tint, then primaries softened to read over grayscale (BraTS' 1, 2,
 *  4 come out red, green, yellow). None near the teal accent, which the
 *  crosshair lines use. Labels past the table take golden-angle hues.
 *  Wire leg 41g asserts labels 1, 2 and 4: change them together. */
export const LABEL_COLORS: readonly (readonly [number, number, number])[] = [
  MASK_TINT, [70, 200, 90], [80, 140, 255], [250, 220, 60],
  [255, 150, 60], [230, 90, 230], [170, 120, 255], [255, 140, 180],
];
/** The share of a label's colour in the fill under its outline. */
export const LABEL_FILL_ALPHA = 0.3;
/** Label outline width, CSS px. */
export const LABEL_OUTLINE_PX = 1.5;
/** The Curve tool's centreline on the panes and its clicks on the
 *  straightened view (F16): amber, apart from the teal crosshair and the
 *  label colours' reds. */
export const CURVE_COLOR = '#fbbf24';
export const CURVE_DIM = 'rgba(251,191,36,0.45)';

/** A label's colour: the table, then hues 137.5° apart (teal skipped). */
export function labelRgb(v: number): readonly [number, number, number] {
  const t = LABEL_COLORS[v - 1];
  if (t) return t;
  let h = (v * 137.508) % 360;
  if (h > 150 && h < 200) h += 60;
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (1 - 0.6 * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

/** r, g, b per label value 0…255, for tinting slices (0 unused). */
export const LABEL_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let v = 1; v < 256; v++) lut.set(labelRgb(v), v * 3);
  return lut;
})();

/** A label's colour as CSS. */
export function labelCss(v: number): string {
  const [r, g, b] = labelRgb(v);
  return `rgb(${r},${g},${b})`;
}
/** Per-view canvas clears (kept distinct deliberately — see NOTE above). */
export const PROTEIN_BG = '#101214';
export const FIBER_BG = '#111314';
export const TF_GRID = 'rgba(255,255,255,0.12)';
/** Canvas type: mirrors the `--mono` token (contexts can't use CSS vars). */
export const MONO_STACK = '"IBM Plex Mono", monospace';
/** Viewport chrome text (anatomy letters, scale bar): near-white, dimmed. */
export const CHROME_TEXT = 'rgba(238,242,247,0.8)';
/** Canvas type size in CSS px. Chrome is drawn in screen space now, so one
 *  size reads the same on every pane and every grid size. */
export const CHROME_FONT_PX = 12;
/** Dark halo behind canvas chrome text (the DOM readouts' text-shadow twin). */
export const CHROME_HALO = 'rgba(0,0,0,0.9)';
