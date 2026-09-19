// N2 atlas-guided tract presets: named waypoint/exclusion bundles for
// teaching tractography over the existing tract-ROI filter. Coordinates
// are FRACTIONAL viewBox units (0..1 per axis), never voxels — presets
// resolve against whatever volume is open via presetRois(), so one
// bundle teaches on every series without claiming patient-specific
// validity. The viewer stays loud about that contract in the status.
//
// Ledger: no new digest bytes (preset geometry authored here, CC0);
// M1-style pins don't apply. Prototype scope: teaching waypoints for
// synthetic/demo tractograms, never bundle segmentation (AFQ/RecoBundles
// stay out) and never a patient-specific claim.
//
// Dependency-free by design (mirrors cohorts.ts): plain objects; the
// render-cpu filter does the math, app renders the picker. The ROI shape
// mirrors render-cpu's TractRoi (voxel center + radius); the app converts
// via presetRois() before calling filterTracts, so no import cycles.

/** One waypoint/exclusion in fractional viewBox coords. */
export interface PresetRoi {
  /** Fractional center (0..1 per axis). */
  center: [number, number, number];
  /** Fractional radius (fraction of the smallest viewBox side). */
  radius: number;
}

/** One named tract preset: waypoints + exclusions + teaching note. */
export interface TractPreset {
  /** Short key used by the UI + wire leg (e.g. 'midline-cross'). */
  id: string;
  /** Display title. */
  title: string;
  /** What the preset selects, in one teaching sentence. */
  lesson: string;
  /** Waypoints (ALL must pass). */
  waypoints: PresetRoi[];
  /** Exclusions (ANY hit vetoes). */
  exclusions: PresetRoi[];
  /** Provenance card line. */
  provenance: string;
}

export const TRACT_PRESETS: TractPreset[] = [
  {
    id: 'midline-cross',
    title: 'Midline crossing selector',
    lesson: 'Keep only streamlines crossing the mid-sagittal slab; veto strays at the box walls.',
    waypoints: [{ center: [0.5, 0.5, 0.5], radius: 0.12 }],
    exclusions: [
      { center: [0.02, 0.5, 0.5], radius: 0.03 },
      { center: [0.98, 0.5, 0.5], radius: 0.03 },
    ],
    provenance: 'N2 teaching preset (fractional viewBox, CC0, authored here)',
  },
  {
    id: 'left-hemisphere',
    title: 'Left-hemisphere keeper',
    lesson: 'Keep streamlines passing the left-half waypoint; veto anything reaching the right wall.',
    waypoints: [{ center: [0.25, 0.5, 0.5], radius: 0.2 }],
    exclusions: [{ center: [0.98, 0.5, 0.5], radius: 0.05 }],
    provenance: 'N2 teaching preset (fractional viewBox, CC0, authored here)',
  },
  {
    id: 'two-hop',
    title: 'Two-waypoint corridor',
    lesson: 'Keep streamlines threading BOTH waypoints (AND logic); nothing passing one alone survives.',
    waypoints: [
      { center: [0.3, 0.3, 0.5], radius: 0.12 },
      { center: [0.7, 0.7, 0.5], radius: 0.12 },
    ],
    exclusions: [],
    provenance: 'N2 teaching preset (fractional viewBox, CC0, authored here)',
  },
  {
    // A3 brain-named waypoints: the preset geometry is still fractional
    // (never patient anatomy); only the NAMES come from the SPL label
    // table (labels 10/49 left/right thalamus, 3004 corpus callosum).
    // Teaching contract: "where the thalamus would be", not "the
    // thalamus" — the status keeps saying so.
    id: 'thalamo-midline',
    title: 'Thalami + callosal midline (SPL-named)',
    lesson: 'Keep streamlines visiting the left-thalamus box then the midline callosal box (SPL labels 10 + 3004); right-thalamus strays pass too — names teach, geometry stays fractional.',
    waypoints: [
      { center: [0.38, 0.55, 0.5], radius: 0.1 },
      { center: [0.5, 0.5, 0.55], radius: 0.08 },
    ],
    exclusions: [{ center: [0.98, 0.5, 0.5], radius: 0.05 }],
    provenance: 'A3 SPL-named waypoint (labels 10/3004, CC-BY-equivalent UNVERIFIED — see openanatomy-brain SOURCES)',
  },
  {
    // A3 second brain-named bundle: putamen pair (labels 12/51) as two
    // AND waypoints — the corridor lesson retold with basal-ganglia names.
    id: 'putamen-pair',
    title: 'Putamen pair corridor (SPL-named)',
    lesson: 'Keep streamlines threading BOTH putamen boxes (SPL labels 12 + 51); the AND logic is the two-hop lesson with brain names.',
    waypoints: [
      { center: [0.35, 0.5, 0.5], radius: 0.1 },
      { center: [0.65, 0.5, 0.5], radius: 0.1 },
    ],
    exclusions: [],
    provenance: 'A3 SPL-named waypoint (labels 12/51, CC-BY-equivalent UNVERIFIED — see openanatomy-brain SOURCES)',
  },
];

/** Look up a preset by UI id. Null on unknown (caller stays loud). */
export function tractPresetById(id: string): TractPreset | null {
  return TRACT_PRESETS.find((p) => p.id === id) ?? null;
}

/** Fail-loud preset check: bad fractions throw, never filter silently. */
export function validateTractPreset(raw: unknown): TractPreset {
  const bad = (why: string): Error => new Error(`bad-tract-preset: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  for (const k of ['id', 'title', 'lesson', 'provenance'] as const) {
    if (!r[k] || typeof r[k] !== 'string') throw bad(`${k} must be a non-empty string`);
  }
  const checkRois = (v: unknown, what: string): PresetRoi[] => {
    if (!Array.isArray(v)) throw bad(`${what} must be an array`);
    return v.map((o, i) => {
      const q = o as Record<string, unknown>;
      const c = q.center as unknown;
      if (!Array.isArray(c) || c.length !== 3 || c.some((x) => typeof x !== 'number' || !Number.isFinite(x) || (x as number) < 0 || (x as number) > 1)) {
        throw bad(`${what}[${i}].center must be 3 fractions in 0..1`);
      }
      if (typeof q.radius !== 'number' || !Number.isFinite(q.radius) || q.radius <= 0 || q.radius > 1) {
        throw bad(`${what}[${i}].radius must be in (0,1]`);
      }
      return { center: (c as number[]).slice(0, 3) as [number, number, number], radius: q.radius as number };
    });
  };
  const waypoints = checkRois(r.waypoints, 'waypoints');
  const exclusions = checkRois(r.exclusions, 'exclusions');
  return { id: r.id as string, title: r.title as string, lesson: r.lesson as string, waypoints, exclusions, provenance: r.provenance as string };
}

/**
 * Resolve a preset against an open volume's dims: fractional centers
 * scale per axis, fractional radii scale by the smallest side (so the
 * sphere stays a sphere in anisotropic volumes). Empty dims throw.
 */
/** Voxel-space ROI (mirrors render-cpu TractRoi; kept local to avoid a cycle). */
export interface VoxelRoi {
  center: [number, number, number];
  radius: number;
}

export function presetRois(
  preset: TractPreset, dims: [number, number, number],
): { waypoints: VoxelRoi[]; exclusions: VoxelRoi[] } {
  if (dims.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new RangeError(`tract-preset-dims: [${dims}]`);
  }
  const side = Math.min(...dims);
  const conv = (p: PresetRoi): VoxelRoi => ({
    center: [p.center[0] * dims[0], p.center[1] * dims[1], p.center[2] * dims[2]],
    radius: Math.max(p.radius * side, 0.5),
  });
  return { waypoints: preset.waypoints.map(conv), exclusions: preset.exclusions.map(conv) };
}
