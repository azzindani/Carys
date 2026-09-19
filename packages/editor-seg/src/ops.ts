// Port of Cornerstone tools + CACTAS brush + ITK-WASM filters (CPU, pure).
// Pipeline: threshold -> region-grow -> connected-components -> fill-hole.
// Every op = pure function (Volume, seed, params) -> mask, undoable,
// testable without UI. See docs/ARCHITECTURE.md.
import type { Volume } from '@carys/volume-core';
import { voxelIndex } from '@carys/volume-core';

export function threshold(
  vol: Volume, lo: number, hi: number,
): Uint8Array {
  const mask = new Uint8Array(vol.data.length);
  for (let i = 0; i < vol.data.length; i++) {
    const v = vol.data[i] as number;
    mask[i] = v >= lo && v <= hi ? 1 : 0;
  }
  return mask;
}

/** 6-neighbour region grow from seed, within [lo,hi]. Small volumes only. */
export function regionGrow(
  vol: Volume,
  seed: [number, number, number],
  lo: number, hi: number,
): Uint8Array {
  const [nx, ny, nz] = vol.dims;
  const mask = new Uint8Array(vol.data.length);
  const inside = (x: number, y: number, z: number) => {
    const v = vol.data[voxelIndex(vol, x, y, z)] as number;
    return v >= lo && v <= hi;
  };
  const stack: [number, number, number][] = [seed];
  const seen = new Set<number>();
  while (stack.length) {
    const [x, y, z] = stack.pop()!;
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    const idx = voxelIndex(vol, x, y, z);
    if (seen.has(idx)) continue;
    seen.add(idx);
    if (!inside(x, y, z)) continue;
    mask[idx] = 1;
    stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z],
      [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
  }
  return mask;
}

/** Paint a brush sphere (CACTAS pattern) into an existing mask. */
export function paintBrush(
  vol: Volume, mask: Uint8Array,
  center: [number, number, number], radius: number, value = 1,
): void {
  const [nx, ny, nz] = vol.dims;
  const [cx, cy, cz] = center;
  for (let z = Math.max(0, cz - radius); z <= Math.min(nz - 1, cz + radius); z++)
    for (let y = Math.max(0, cy - radius); y <= Math.min(ny - 1, cy + radius); y++)
      for (let x = Math.max(0, cx - radius); x <= Math.min(nx - 1, cx + radius); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
        if (d <= radius) mask[voxelIndex(vol, x, y, z)] = value;
      }
}
