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
