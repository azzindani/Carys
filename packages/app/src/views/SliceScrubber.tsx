import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { paintBus, sliceBus } from '../lib/paintBus';
import { session } from '../lib/session';
import { PLANE_TITLES as TITLES, type Plane } from '../lib/types';
import { useVersion } from '../lib/version';

/**
 * Stack scrolling for a phone. Scrolling through the slices is what a 2D
 * viewport is for, so its control belongs in the bar at the bottom of the
 * screen with the other controls, not in a rail up the image's far edge. It
 * mirrors the pane's own slider (the single source of the position, which the
 * wheel, the keys and a crosshair jump all move too) and drives it back.
 */
export function SliceScrubber({ plane }: { plane: Plane }): JSX.Element | null {
  useVersion();
  const idx = useSyncExternalStore(sliceBus.subscribe, () => session.slices[plane] ?? 0);
  const img = session.img;
  if (!img) return null;
  const [nx, ny, nz] = img.dims;
  const max = (plane === 'axial' ? nz : plane === 'coronal' ? ny : nx) - 1;
  // a single image has no stack to scroll
  if (max < 1) return null;
  const at = Math.min(max, Math.max(0, idx));
  const go = (n: number): void => {
    const slider = document.getElementById(`s-${plane}`) as HTMLInputElement | null;
    if (!slider) return;
    slider.value = String(Math.min(max, Math.max(0, Math.round(n))));
    paintBus.mprPlane(plane);
  };
  const chevron = (d: string): JSX.Element => (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  return (
    <div className="scrub" id="m-scrub" role="group" aria-label={`${TITLES[plane]} slice`}>
      <button type="button" className="iconbtn" aria-label="Previous slice" disabled={at <= 0} onClick={() => go(at - 1)}>
        {chevron('M10 3.5L5.5 8l4.5 4.5')}
      </button>
      <input
        type="range" className="styled" id="m-slice" aria-label={`${TITLES[plane]} slice`}
        min={0} max={max} step={1} value={at}
        aria-valuetext={`${at} of ${max}`}
        onChange={(e) => go(Number((e.target as HTMLInputElement).value))}
      />
      <button type="button" className="iconbtn" aria-label="Next slice" disabled={at >= max} onClick={() => go(at + 1)}>
        {chevron('M6 3.5L10.5 8 6 12.5')}
      </button>
    </div>
  );
}
