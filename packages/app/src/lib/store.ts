import { useSyncExternalStore } from 'react';
import type { CompareMode, Density, TextSize, UiState } from './types';

// Tiny typed external store. State owns the DOM: components subscribe and
// render; canvas effects paint imperatively from the same state.

const APPEAR_KEY = 'carys.appearance';
/** Prefs written before the Carys rename — read once, then saved under the new key. */
const APPEAR_KEY_LEGACY = 'omniviewer.appearance';

function loadAppearance(): { textSize: TextSize; density: Density } {
  const fallback = { textSize: 'm' as TextSize, density: 'm' as Density };
  try {
    const raw = localStorage.getItem(APPEAR_KEY) ?? localStorage.getItem(APPEAR_KEY_LEGACY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Record<'textSize' | 'density', unknown>>;
    const sizes: TextSize[] = ['xs', 's', 'm', 'l', 'xl'];
    // Legacy prefs predate the 5-level scale: cozy->m, compact->s.
    const legacy: Record<string, Density> = { cozy: 'm', compact: 's' };
    const textSize: TextSize = typeof p.textSize === 'string' && (sizes as string[]).includes(p.textSize) ? p.textSize as TextSize : 'm';
    const density: Density = typeof p.density === 'string' && (sizes as string[]).includes(p.density)
      ? p.density as Density : (typeof p.density === 'string' && legacy[p.density]) || 'm';
    return { textSize, density };
  } catch {
    return fallback;
  }
}

export function saveAppearance(textSize: TextSize, density: Density): void {
  try {
    localStorage.setItem(APPEAR_KEY, JSON.stringify({ textSize, density }));
  } catch { /* private mode: prefs just don't survive */ }
}

/**
 * The details panel earns its column only when there is width to spare.
 * Below 1100px it folds under the stage and costs ~20% of the screen, so it
 * starts collapsed there and the toggle brings it back.
 */
function wideEnoughForInspector(): boolean {
  return typeof window === 'undefined' || window.innerWidth > 1100;
}

const initial: UiState = {
  view: 'mpr', render3d: 'surface', tool: 'view', src: 'mask', method: 'blocky',
  preset: 'auto', overlay: true, brush: 3, threshold: 0, series: '',
  proj: 'slice', slab: 9, oblA: 0, oblB: 0, oblPlane: 'axial' as const, growLo: 100, growHi: 3000, measureKind: 'length',
  layout: 'tri', sync: true, hang: 'default',
  compareSeries: '', compareMode: 'off' as CompareMode, compareAlpha: 0.5,
  // The control deck starts collapsed to its switcher strip so the image
  // owns ~75% of a phone; tapping Tools/Display/Files expands it over the
  // bottom half, which is where those controls belong once you want them.
  tabs: [], fullVp: null, mView: 'v3d', mSheet: null, docksOpen: true, insOpen: wideEnoughForInspector(), cineFps: 4, invert: false, lut: 'Grayscale',
  ...loadAppearance(),
};

let state: UiState = { ...initial };
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getUi(): UiState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useUi(): UiState {
  return useSyncExternalStore(subscribe, getUi, getUi);
}

export function useUiPick<K extends keyof UiState>(key: K): UiState[K] {
  return useSyncExternalStore(subscribe, () => getUi()[key], () => getUi()[key]);
}
