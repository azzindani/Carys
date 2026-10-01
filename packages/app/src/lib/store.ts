import { useSyncExternalStore } from 'react';
import { CLIP_OFF } from './clip3d';
import { loadAppearance } from './appearance';
import type { CompareMode, UiState } from './types';

// Tiny typed external store. State owns the DOM: components subscribe and
// render; canvas effects paint imperatively from the same state.

const initial: UiState = {
  view: 'mpr', render3d: 'surface', tool: 'view', src: 'mask', method: 'smooth', smooth3d: 0,
  clip3d: CLIP_OFF,
  preset: 'auto', overlay: true, maskLook: 'outline', cprWidth: 30, cprAngle: 0, brush: 3, threshold: 0, series: '',
  proj: 'slice', slab: 9, oblA: 0, oblB: 0, oblPlane: 'axial' as const, growLo: 100, growHi: 3000, measureKind: 'length',
  layout: 'tri', sync: true, hang: 'default',
  compareSeries: '', compareMode: 'off' as CompareMode, compareAlpha: 0.5,
  // Chrome starts out of the way: the details drawer closed, the mobile
  // control deck collapsed to its switcher strip. Tools reveal on demand,
  // the way a site's nav does — the image is the product.
  tabs: [], fullVp: null, mView: 'v3d', mSheet: null, insOpen: false, cineFps: 4, invert: false, lut: 'Grayscale',
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
