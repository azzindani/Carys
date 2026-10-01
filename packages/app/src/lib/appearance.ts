// Appearance prefs: five settings, five levels each, persisted on this
// device and applied as data attributes on <html>, where tokens.css turns
// them into the scales every size, space, control height and corner in the
// UI is built from. One list describes them, so the panel, the store, the
// <html> writer and the audit cannot drift apart (§4).

export type Level = 'xs' | 's' | 'm' | 'l' | 'xl';
export const LEVELS: readonly Level[] = ['xs', 's', 'm', 'l', 'xl'];

export interface Appearance {
  /** every font size in the UI */
  textSize: Level;
  /** the space between and inside things */
  density: Level;
  /** the height of buttons, selects, inputs and segmented controls */
  controlSize: Level;
  /** how round panels and controls are, from square to soft */
  corners: Level;
  /** the text drawn over images: patient overlay, edge letters, measures */
  imageText: Level;
}

export interface AppearanceSetting {
  key: keyof Appearance;
  /** the <html> data attribute tokens.css reads */
  attr: 'text' | 'density' | 'controls' | 'corners' | 'imgtext';
  /** `data-<option>` on each level button, the e2e handle */
  dataKey: string;
  id: string;
  label: string;
  title: string;
  /** what each level means, xs..xl, for the buttons' tooltips */
  names: readonly [string, string, string, string, string];
}

export const APPEARANCE: readonly AppearanceSetting[] = [
  { key: 'textSize', attr: 'text', dataKey: 'tsize', id: 'appear-text', label: 'Text', title: 'Size of all interface text',
    names: ['Extra small text', 'Small text', 'Default text', 'Large text', 'Extra large text'] },
  { key: 'density', attr: 'density', dataKey: 'density', id: 'appear-density', label: 'Layout', title: 'Spacing between and inside panels and controls',
    names: ['Extra tight spacing', 'Tight spacing', 'Default spacing', 'Roomy spacing', 'Extra roomy spacing'] },
  { key: 'controlSize', attr: 'controls', dataKey: 'csize', id: 'appear-controls', label: 'Controls', title: 'Height of buttons, dropdowns and fields',
    names: ['Extra small controls (24 px)', 'Small controls (26 px)', 'Default controls (28 px)', 'Large controls (32 px)', 'Extra large controls (36 px)'] },
  { key: 'corners', attr: 'corners', dataKey: 'corners', id: 'appear-corners', label: 'Corners', title: 'Roundness of panels and controls',
    names: ['Square corners', 'Slightly rounded', 'Default corners', 'Rounder', 'Very round'] },
  { key: 'imageText', attr: 'imgtext', dataKey: 'itext', id: 'appear-imgtext', label: 'Image text', title: 'Size of the text drawn over images',
    names: ['Extra small image text', 'Small image text', 'Default image text', 'Large image text', 'Extra large image text'] },
];

export const DEFAULT_APPEARANCE: Appearance = { textSize: 'm', density: 'm', controlSize: 'm', corners: 'm', imageText: 'm' };

/** Canvas text can't read CSS variables, so the image-text level maps to a
 *  multiplier here; tokens.css carries the same five numbers for the DOM. */
export const IMAGE_TEXT_SCALE: Record<Level, number> = { xs: 0.85, s: 0.92, m: 1, l: 1.15, xl: 1.3 };

const KEY = 'carys.appearance';
/** Prefs written before the Carys rename — read once, then saved under the new key. */
const KEY_LEGACY = 'omniviewer.appearance';
/** Prefs that predate the 5-level scale: cozy->m, compact->s. */
const LEGACY_DENSITY: Record<string, Level> = { cozy: 'm', compact: 's' };

const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

export function loadAppearance(): Appearance {
  const out = { ...DEFAULT_APPEARANCE };
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(KEY_LEGACY);
    if (!raw) return out;
    const p = JSON.parse(raw) as Partial<Record<keyof Appearance, unknown>>;
    for (const { key } of APPEARANCE) {
      const v = p[key];
      if (isLevel(v)) out[key] = v;
      else if (key === 'density' && typeof v === 'string' && LEGACY_DENSITY[v]) out[key] = LEGACY_DENSITY[v]!;
    }
  } catch { /* unreadable prefs: defaults */ }
  return out;
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch { /* private mode: prefs just don't survive */ }
}

/** Write the levels onto <html>, where tokens.css reads them. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  for (const { key, attr } of APPEARANCE) root.dataset[attr] = a[key];
}
