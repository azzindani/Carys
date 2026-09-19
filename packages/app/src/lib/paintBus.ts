// Views own their canvases and register repaint callbacks here so chrome
// (docks, palette, keyboard) can trigger paints without prop drilling.
import type { Plane } from './types';

export interface MprViewSnapshot {
  slices: Record<Plane, number>;
  view: Record<Plane, { zoom: number; x: number; y: number }>;
}

export const paintBus: {
  mpr: () => void;
  surface: () => void;
  mprPlane: (plane: 'axial' | 'coronal' | 'sagittal') => void;
  /** Current slices + per-pane zoom/pan (null when the panes unmount). */
  getMprView: () => MprViewSnapshot | null;
  /** Restore slices + zoom/pan, then repaint (presentation load path). */
  setMprView: (slices: Record<Plane, number>, view: Record<Plane, { zoom: number; x: number; y: number }>) => void;
} = {
  mpr: () => {},
  surface: () => {},
  mprPlane: () => {},
  getMprView: () => null,
  setMprView: () => {},
};
