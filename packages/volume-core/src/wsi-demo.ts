// C2 demo annotations: hand-authored teaching overlays for the VL
// representative tile (64×48, see wsi.test.ts vlFile). Regions + notes
// are teaching labels for the synthetic tile pattern — they describe
// what a student should practice seeing, never a diagnosis of real
// tissue. Coordinates verified against the tile generator (i*7 pattern).
//
// Ledger: no new digest bytes (annotation JSON rides the repo, CC0 —
// authored here); M1-style pins don't apply (no source archive).
// Prototype scope: display only, never detection/grading.
/** Demo annotation shape (mirrors io's WsiAnnotation; validated there). */
export interface WsiDemoAnnotation {
  id: string;
  region: string;
  stain: string;
  rect: [number, number, number, number];
  note: string;
}

/** Demo set id (session key + wire leg). */
export const WSI_DEMO_SET = 'vl-demo-tile-64x48';

/** Three teaching regions on the 64×48 demo tile. */
export const WSI_DEMO_ANNOTATIONS: WsiDemoAnnotation[] = [
  {
    id: 'gradient-field',
    region: 'Gradient field',
    stain: 'H&E',
    rect: [0, 0, 31, 23],
    note: 'Practice field: smooth intensity ramp — set window/level here first.',
  },
  {
    id: 'banding-band',
    region: 'Banding band',
    stain: 'H&E',
    rect: [32, 24, 63, 47],
    note: 'Practice field: repeating bands — compare against the gradient field.',
  },
  {
    id: 'full-frame',
    region: 'Whole-tile context',
    stain: '',
    rect: [0, 0, 63, 47],
    note: 'Whole-tile frame: unknown stain — orientation reference only.',
  },
];
