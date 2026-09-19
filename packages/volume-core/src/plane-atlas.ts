// A4 cross-section teaching atlas: "what plane am I looking at" cards
// driven by the existing MPR plane state (Ax/Cor/Sag + oblique tilt).
// Pure teaching text over the BrainAtlas structure list — no pixels, no
// segmentation, no claims about the open volume's own anatomy. Each card
// names the plane, what it cuts, the canonical teaching structures per
// third (thirds split the slider range, never the patient's anatomy),
// and the oblique caution when a tilt is active.
//
// Ledger: no new digest bytes (SPL label names + BodyParts3D region
// words, both already pinned); this lane ships the card index. Prototype
// scope: orientation teaching, never diagnosis.
//
// Dependency-free by design (mirrors cohorts.ts): plain objects; the app
// feeds its live {plane, tilted} state, the card answers.

/** MPR plane key (mirrors the app's Plane type; kept local, no import). */
export type AtlasPlane = 'axial' | 'coronal' | 'sagittal';

/** One plane-teaching card. */
export interface PlaneCard {
  /** Plane key. */
  plane: AtlasPlane;
  /** Display title. */
  title: string;
  /** What the plane cuts, in one teaching sentence. */
  cuts: string;
  /** Slider-third guides (low / mid / high): landmark structures to expect. */
  thirds: [string, string, string];
  /** Oblique caution appended when a tilt is active. */
  tiltNote: string;
}

export const PLANE_CARDS: PlaneCard[] = [
  {
    plane: 'axial',
    title: 'Axial — feet-to-head stack',
    cuts: 'Horizontal slices from the skull base (low) through the centrum semiovale (high).',
    thirds: [
      'Low: cerebellum, temporal lobes, orbits',
      'Mid: basal ganglia (putamen, caudate), thalami, lateral ventricles',
      'High: centrum semiovale, high convexities',
    ],
    tiltNote: 'Tilt active: the slice is double-oblique — left/right landmarks no longer mirror; read the tilt angles before naming sides.',
  },
  {
    plane: 'coronal',
    title: 'Coronal — face-to-back stack',
    cuts: 'Frontal slices from the frontal pole (low) through the occiput (high).',
    thirds: [
      'Front: frontal lobes, orbits, frontal sinuses',
      'Mid: amygdala/hippocampus heads, third ventricle, brainstem',
      'Back: occipital lobes, cerebellar hemispheres',
    ],
    tiltNote: 'Tilt active: the slice is double-oblique — up/down landmarks shift; read the tilt angles before naming levels.',
  },
  {
    plane: 'sagittal',
    title: 'Sagittal — side-to-side stack',
    cuts: 'Lateral slices from one hemisphere (low) through the midline (high).',
    thirds: [
      'Side: insula, lateral ventricle atrium, Sylvian vessels',
      'Para-midline: cingulate gyrus, corpus callosum body',
      'Midline: corpus callosum, third ventricle, cerebellar vermis, fourth ventricle',
    ],
    tiltNote: 'Tilt active: the slice is double-oblique — the midline structures leave the plane; read the tilt angles before calling "midline".',
  },
];

/** Look up a card by plane. Null on unknown (caller stays loud). */
export function planeCardByPlane(plane: string): PlaneCard | null {
  return PLANE_CARDS.find((c) => c.plane === plane) ?? null;
}

/**
 * Describe the open plane state in one teaching line: plane title + the
 * active third's landmarks, plus the tilt caution when tilted. Thirds
 * split the slider [0, max] range; out-of-range fractions clamp loudly
 * to the nearest third (never NaN).
 */
export function planeCardLine(card: PlaneCard, frac: number, tilted: boolean): string {
  if (!Number.isFinite(frac)) throw new RangeError(`plane-atlas-frac: ${frac}`);
  const f = Math.min(1, Math.max(0, frac));
  const third = card.thirds[f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2]!;
  return `${card.title} · ${third}${tilted ? ` · ${card.tiltNote}` : ''}`;
}
