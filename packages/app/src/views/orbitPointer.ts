// Pointer input on the 3D view: drag orbits, two fingers pinch to zoom, a
// tap picks (F12: the panes jump to the point). Split out of SurfaceView
// (rule 1: one module, one job) when picking needed the tap.
import { useRef, type MutableRefObject } from 'react';
import type React from 'react';
import { session } from '../lib/session';

/** A press that moves less than this (px) is a tap, not a drag. */
const TAP_SLOP = 3;

export interface OrbitPointerHost {
  angles: MutableRefObject<{ orbit: number; tilt: number }>;
  setOrbit: (v: number) => void;
  setTilt: (v: number) => void;
  /** repaint for the new orbit/zoom (debounced by the caller) */
  queueOrbit: () => void;
  onTap: (clientX: number, clientY: number) => void;
}

export function useOrbitPointer(host: OrbitPointerHost): {
  onOrbitDown: (e: React.PointerEvent) => void;
  onOrbitMove: (e: React.PointerEvent) => void;
  onOrbitUp: (e?: React.PointerEvent) => void;
} {
  /** Drag-to-orbit: the demo's slow orbit drag now really rotates the volume. */
  const orbDrag = useRef<{ x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  // Touch: one finger orbits, two fingers pinch to zoom — the same contract
  // a 3D viewport gives a trackpad, so zoom is a gesture and not a button.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  const onOrbitDown = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        orbDrag.current = null;                       // a pinch is not an orbit
        pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: session.zoom3d };
        return;
      }
      if (touches.current.size > 2) return;
    }
    orbDrag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onOrbitMove = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (p.d > 0) {
          session.zoom3d = Math.min(8, Math.max(0.4, p.z * (d / p.d)));
          host.queueOrbit();
        }
        return;
      }
    }
    const d = orbDrag.current;
    // Touch reports buttons === 0 while dragging, so only gate a mouse on it.
    if (!d || (e.pointerType !== 'touch' && !(e.buttons & 1))) return;
    // still inside the tap slop: not an orbit yet
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TAP_SLOP) return;
    d.moved = true;
    const TAU = Math.PI * 2;
    const o = (((host.angles.current.orbit + (e.clientX - d.x) * 0.006) % TAU) + TAU) % TAU;
    const t = Math.min(1.2, Math.max(-1.2, host.angles.current.tilt + (e.clientY - d.y) * 0.004));
    d.x = e.clientX; d.y = e.clientY;
    host.setOrbit(o);
    host.setTilt(t);
    host.queueOrbit();
  };

  const onOrbitUp = (e?: React.PointerEvent): void => {
    if (e?.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    }
    const d = orbDrag.current;
    orbDrag.current = null;
    if (d && e && e.type === 'pointerup' && !d.moved) host.onTap(e.clientX, e.clientY);
  };

  return { onOrbitDown, onOrbitMove, onOrbitUp };
}
