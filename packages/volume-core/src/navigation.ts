// Ported from Neuroglancer navigation_state.ts + data_panel_layout.ts +
// coordinate_transform.ts (spaces/scales/bounds only). Apache-2.
// Shared-center 4-pane: one position, per-pane relative orientation.
// Skips: quats/GL, PerspectivePanel, RenderedDataPanel, snap widgets.

export type PaneId = 'xy' | 'xz' | 'yz' | 'perspective';

export interface LinkedPosition {
  center: [number, number, number];
}

export type AxisOrientation = 'xy' | 'xz' | 'yz';

/** Relative orientation per named axis (Neuroglancer AXES_RELATIVE_ORIENTATION). */
export const AXES_RELATIVE_ORIENTATION: Record<AxisOrientation, [number, number, number]> = {
  xy: [0, 0, 0],
  xz: [Math.PI / 2, 0, 0],
  yz: [0, Math.PI / 2, 0],
};

export interface NavigationState {
  position: LinkedPosition;
  zoom: number;
}

export function makeNavigationState(
  center: [number, number, number] = [0, 0, 0],
  zoom = 1,
): NavigationState {
  return { position: { center }, zoom };
}

/** Four-pane layout spec (Neuroglancer FourPanelLayout, canvas targets). */
export interface FourPanelLayout {
  topLeft: PaneId;
  topRight: PaneId;
  bottomLeft: PaneId;
  bottomRight: PaneId;
}

export const FOUR_PANEL_DEFAULT: FourPanelLayout = {
  topLeft: 'xy',
  topRight: 'xz',
  bottomLeft: 'perspective',
  bottomRight: 'yz',
};

export function movePosition(
  nav: NavigationState,
  to: [number, number, number],
): NavigationState {
  return { ...nav, position: { center: to } };
}
