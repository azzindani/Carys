// Window/level LUT — runs in Worker, pure function, no DOM.

export interface WindowLevel {
  center: number;
  width: number;
}

export const PRESETS: Record<string, WindowLevel> = {
  CT_Brain: { center: 40, width: 80 },
  CT_Bone: { center: 400, width: 1800 },
  CT_SoftTissue: { center: 50, width: 400 },
  CT_Lung: { center: -600, width: 1500 },
  CT_Chest: { center: -600, width: 1500 },
  CT_AAA: { center: 100, width: 700 },
  MR_Default: { center: 128, width: 256 },
  MR_T2Brain: { center: 100, width: 200 },
};

/**
 * VOI range (Cornerstone windowLevel.ts toLowHighRange, LINEAR):
 * names only from VIEWPORT_PRESETS; VTK opacity strings NOT ported.
 */
export function voiRange(wl: WindowLevel): { lo: number; hi: number } {
  return { lo: wl.center - wl.width / 2, hi: wl.center + wl.width / 2 };
}

export function windowLevelFromRange(lo: number, hi: number): WindowLevel {
  return { center: (lo + hi) / 2, width: hi - lo };
}

export function applyWindowLevel(
  value: number,
  wl: WindowLevel,
): number {
  const lo = wl.center - wl.width / 2;
  const hi = wl.center + wl.width / 2;
  if (value <= lo) return 0;
  if (value >= hi) return 255;
  return Math.round(((value - lo) / wl.width) * 255);
}

export function lutRow(
  data: ArrayLike<number>,
  wl: WindowLevel,
  out: Uint8ClampedArray,
): void {
  for (let i = 0; i < data.length; i++) {
    out[i] = applyWindowLevel(data[i], wl);
  }
}
