// Pyramid-aware viewport math: level pick + banded paint plan over an
// OME-NGFF multiscales pyramid. Pure: widths in, index out. The viewer
// (CellsView) fetches through OmeZarrStore.getTile; this module never
// touches fetch or the DOM, so the engine/DOM separation gate holds.
//
// Levels run finest→coarsest (L0 full res). The pick keeps full-res
// fidelity whenever the viewport covers it, and sheds bytes the moment
// a coarser level still covers every display pixel.
export function pickPyramidLevel(widths: number[], targetW: number): number {
  if (!Array.isArray(widths) || widths.length === 0) {
    throw new RangeError('ome-view-levels: need at least one level width');
  }
  if (!widths.every((w) => Number.isFinite(w) && w > 0)) {
    throw new RangeError(`ome-view-levels: widths must be positive, got [${widths}]`);
  }
  if (!Number.isFinite(targetW) || targetW <= 0) {
    throw new RangeError(`ome-view-target: ${targetW}`);
  }
  let best = 0;
  for (let i = 0; i < widths.length; i++) {
    if (widths[i]! >= targetW) best = i; // keep the coarsest cover
  }
  return best;
}

export interface ViewBand {
  y: number;
  h: number;
}

/** Row bands for progressive paint: exact tiling, tail band truncates.
 *  The viewer fetches one band per step so progress is smooth and a
 *  superseding paint (epoch guard) lands between bands, not mid-frame. */
export function bandPlan(h: number, bandRows = 64): ViewBand[] {
  if (!Number.isInteger(h) || h <= 0) throw new RangeError(`ome-view-height: ${h}`);
  if (!Number.isInteger(bandRows) || bandRows <= 0) throw new RangeError(`ome-view-band: ${bandRows}`);
  const out: ViewBand[] = [];
  for (let y = 0; y < h; y += bandRows) out.push({ y, h: Math.min(bandRows, h - y) });
  return out;
}
