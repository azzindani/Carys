// Transfer functions: piecewise color+opacity stops over data values.
// Stops are absolute (data units); presets are built from the volume's
// [min, max] so the same preset works on CT and MR.

export interface TFStop {
  value: number;
  color: [number, number, number];
  opacity: number; // 0..1
}

export type TF = TFStop[];

export function sortTF(tf: TF): TF {
  return tf.slice().sort((a, b) => a.value - b.value);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Sample color+opacity at a data value (clamped ends, linear segments). */
export function sampleTF(tf: TF, v: number): { r: number; g: number; b: number; a: number } {
  return sampleSortedTF(sortTF(tf), v);
}

/** `sampleTF` over stops already sorted by value (`sortTF`): the per-sample
 *  path of a renderer, which sorts once per frame. */
export function sampleSortedTF(stops: TF, v: number): { r: number; g: number; b: number; a: number } {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 };
  if (v <= stops[0]!.value) {
    const s = stops[0]!;
    return { r: s.color[0], g: s.color[1], b: s.color[2], a: clamp01(s.opacity) };
  }
  const last = stops[stops.length - 1]!;
  if (v >= last.value) return { r: last.color[0], g: last.color[1], b: last.color[2], a: clamp01(last.opacity) };
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    if (v >= a.value && v <= b.value) {
      const t = (v - a.value) / (b.value - a.value || 1);
      return {
        r: a.color[0] + (b.color[0] - a.color[0]) * t,
        g: a.color[1] + (b.color[1] - a.color[1]) * t,
        b: a.color[2] + (b.color[2] - a.color[2]) * t,
        a: clamp01(a.opacity + (b.opacity - a.opacity) * t),
      };
    }
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

/** Largest opacity sorted stops take anywhere in [lo, hi]: the function is
 *  piecewise linear, so the ends and the stops between them. NaN bounds
 *  answer 1 (nothing can be ruled out). */
export function maxOpacity(stops: TF, lo: number, hi: number): number {
  if (!(lo <= hi)) return 1;
  let m = Math.max(sampleSortedTF(stops, lo).a, sampleSortedTF(stops, hi).a);
  for (const s of stops) if (s.value >= lo && s.value <= hi) m = Math.max(m, clamp01(s.opacity));
  return m;
}

export type TFPresetName = 'bone' | 'soft' | 'lung' | 'brain' | 'xray';

export const TF_PRESETS: TFPresetName[] = ['bone', 'soft', 'lung', 'brain', 'xray'];

const C = {
  bone: [235, 225, 205] as [number, number, number],
  soft: [200, 130, 110] as [number, number, number],
  lung: [150, 180, 200] as [number, number, number],
  brain: [190, 170, 160] as [number, number, number],
  blood: [220, 60, 50] as [number, number, number],
  air: [120, 160, 190] as [number, number, number],
  fat: [215, 190, 140] as [number, number, number],
};

/** Build preset stops for a volume with data range [min, max]. */
export function presetTF(name: TFPresetName, min: number, max: number): TF {
  const span = max - min || 1;
  const at = (f: number): number => min + span * f;
  switch (name) {
    case 'bone':
      return [
        { value: at(0.0), color: C.bone, opacity: 0 },
        { value: at(0.45), color: C.bone, opacity: 0 },
        { value: at(0.62), color: C.bone, opacity: 0.55 },
        { value: at(0.8), color: [255, 250, 235], opacity: 0.95 },
        { value: at(1.0), color: [255, 255, 255], opacity: 1 },
      ];
    case 'soft':
      return [
        { value: at(0.0), color: C.soft, opacity: 0 },
        { value: at(0.3), color: C.soft, opacity: 0 },
        { value: at(0.45), color: C.soft, opacity: 0.35 },
        { value: at(0.6), color: C.blood, opacity: 0.6 },
        { value: at(1.0), color: C.bone, opacity: 0.9 },
      ];
    case 'lung':
      return [
        { value: at(0.0), color: C.air, opacity: 0.85 },
        { value: at(0.25), color: C.air, opacity: 0.25 },
        { value: at(0.5), color: C.lung, opacity: 0 },
        { value: at(1.0), color: C.bone, opacity: 0.9 },
      ];
    case 'brain':
      return [
        { value: at(0.0), color: C.brain, opacity: 0 },
        { value: at(0.35), color: C.brain, opacity: 0.12 },
        { value: at(0.55), color: [220, 200, 185], opacity: 0.5 },
        { value: at(0.75), color: [240, 225, 210], opacity: 0.85 },
        { value: at(1.0), color: [255, 250, 240], opacity: 1 },
      ];
    case 'xray':
      return [
        { value: at(0.0), color: [255, 255, 255], opacity: 0 },
        { value: at(0.5), color: [230, 230, 235], opacity: 0.25 },
        { value: at(0.8), color: [255, 255, 255], opacity: 0.7 },
        { value: at(1.0), color: [255, 255, 255], opacity: 1 },
      ];
  }
}

// Calibration against real data (the sample set's CTs and MRs). `presetTF`
// alone stretched every preset over the volume's [min, max], and on CT that
// range belongs to the scanner, not the patient: padding at -2048, a metal
// streak at 3000. The same "bone" started at -387 HU on one chest CT (lung
// parenchyma), at -103 HU on an abdomen (fat: the whole body drawn as a grey
// shell) and at 616 HU on a spine (most of the vertebra gone). "lung" drew
// the air round the body at 0.85, a solid box. On MR one bright voxel set
// the range: a cardiac cine with 95% of its voxels under 270 and a few at
// 4000 put every preset's ramp above all of the anatomy.
//
// So a Hounsfield volume takes fixed stops in HU, and anything else takes the
// relative presets over a robust range: its floor, and the 99th percentile
// of the voxels that are not background. (The 99.5th still sat in the cine's
// bright tail: 1% of it lies above 350, up to 4025.)

/** Below this a volume carries air, so its scale is Hounsfield; above BONE it
 *  reaches bone. The rule volume-core's autoThreshold uses for the surface. */
const AIR_HU = -500;
const BONE_HU = 300;
/** Samples read to measure a domain: a strided subset, sorted. */
const DOMAIN_SAMPLES = 1 << 18;

/** What a preset is built against. */
export interface TFDomain {
  /** The range the relative presets stretch over. */
  lo: number;
  hi: number;
  /** The values are Hounsfield units: presets take fixed HU stops. */
  hounsfield: boolean;
}

/**
 * Measure a field for the presets. `modality` is the series' own (catalog or
 * DICOM tag): only CT, or a volume with none, can be Hounsfield, so an MR
 * padded with -1000 is not drawn on CT stops.
 */
export function tfDomain(field: ArrayLike<number>, modality?: string | null): TFDomain {
  const n = field.length;
  const step = Math.max(1, Math.floor(n / DOMAIN_SAMPLES));
  const s = new Float64Array(Math.ceil(n / step));
  let m = 0;
  for (let i = 0; i < n; i += step) {
    const v = field[i]!;
    if (Number.isFinite(v)) s[m++] = v;
  }
  if (m === 0) return { lo: 0, hi: 1, hounsfield: false };
  const v = s.subarray(0, m).sort();
  const min = v[0]!, max = v[m - 1]!;
  const mod = (modality ?? '').toUpperCase();
  const hounsfield = (mod === '' || mod === 'CT') && min <= AIR_HU && max >= BONE_HU;
  // Background: the floor (padding, the zeros round a skull-stripped brain)
  // sits out of the percentile when it covers a fifth of the volume, the rule
  // the app's auto window uses. Its width is one 256th of the range, so
  // near-zero noise counts as floor too.
  const floorTop = min + (max - min) / 256;
  let bg = 0;
  while (bg < m && v[bg]! <= floorTop) bg++;
  const from = bg > m * 0.2 && bg < m ? bg : 0;
  let hi = v[from + Math.floor((m - 1 - from) * 0.99)]!;
  if (!(hi > min)) hi = max > min ? max : min + 1;
  return { lo: min, hi, hounsfield };
}

/** Preset stops in Hounsfield units, for a CT whatever its stored range. */
export function presetTFHounsfield(name: TFPresetName): TF {
  switch (name) {
    // cancellous bone from ~150 HU (contrast-filled vessels with it, as on
    // any bone render), cortical bone opaque by 700
    case 'bone':
      return [
        { value: -1024, color: C.bone, opacity: 0 },
        { value: 150, color: C.bone, opacity: 0 },
        { value: 300, color: C.bone, opacity: 0.35 },
        { value: 700, color: [250, 245, 230], opacity: 0.85 },
        { value: 1500, color: [255, 255, 255], opacity: 1 },
      ];
    // fat barely there, muscle and organs translucent, enhanced blood and
    // bone over them
    case 'soft':
      return [
        { value: -1024, color: C.fat, opacity: 0 },
        { value: -150, color: C.fat, opacity: 0 },
        { value: -60, color: C.fat, opacity: 0.03 },
        { value: 20, color: C.soft, opacity: 0.1 },
        { value: 80, color: C.soft, opacity: 0.3 },
        { value: 250, color: C.blood, opacity: 0.5 },
        { value: 700, color: C.bone, opacity: 0.9 },
      ];
    // lung parenchyma (-900..-500), not the air: the air round the body and
    // in the airways is clear, soft tissue too, bone faint for orientation
    case 'lung':
      return [
        { value: -1024, color: C.air, opacity: 0 },
        { value: -950, color: C.air, opacity: 0 },
        { value: -850, color: C.air, opacity: 0.08 },
        { value: -650, color: C.lung, opacity: 0.04 },
        { value: -450, color: C.lung, opacity: 0 },
        { value: 150, color: C.bone, opacity: 0 },
        { value: 400, color: C.bone, opacity: 0.4 },
        { value: 1200, color: C.bone, opacity: 0.85 },
      ];
    // brain parenchyma (20..45 HU) and fresh blood (50..80): CSF and bone clear
    case 'brain':
      return [
        { value: -1024, color: C.brain, opacity: 0 },
        { value: 10, color: C.brain, opacity: 0 },
        { value: 30, color: C.brain, opacity: 0.08 },
        { value: 60, color: [230, 205, 190], opacity: 0.25 },
        { value: 90, color: [230, 205, 190], opacity: 0 },
      ];
    // opacity rising with attenuation, so bone outshines the soft tissue it
    // sits in, as on a radiograph
    case 'xray':
      return [
        { value: -1024, color: [255, 255, 255], opacity: 0 },
        { value: -400, color: [255, 255, 255], opacity: 0 },
        { value: 0, color: [230, 230, 235], opacity: 0.015 },
        { value: 400, color: [240, 240, 245], opacity: 0.15 },
        { value: 1200, color: [255, 255, 255], opacity: 0.6 },
        { value: 2000, color: [255, 255, 255], opacity: 0.9 },
      ];
  }
}

/** A preset for a measured field: HU stops on Hounsfield data, else the
 *  relative preset over the robust range. */
export function presetTFFor(name: TFPresetName, d: TFDomain): TF {
  return d.hounsfield ? presetTFHounsfield(name) : presetTF(name, d.lo, d.hi);
}

/** The preset a field opens on: bone for CT, the soft ramp of "brain" for
 *  anything else (an MR has no bone to show). */
export function defaultTFPreset(d: TFDomain): TFPresetName {
  return d.hounsfield ? 'bone' : 'brain';
}

/** Validate stops for the editor: sorted, finite, opacity in range. */
export function validateTF(tf: TF): string[] {
  const errs: string[] = [];
  if (tf.length < 2) errs.push('need at least 2 stops');
  tf.forEach((s, i) => {
    if (!Number.isFinite(s.value)) errs.push(`stop ${i}: non-finite value`);
    if (s.opacity < 0 || s.opacity > 1) errs.push(`stop ${i}: opacity outside 0..1`);
    if (i > 0 && s.value < tf[i - 1]!.value) errs.push(`stop ${i}: out of order`);
    for (const c of s.color) {
      if (!Number.isFinite(c) || c < 0 || c > 255) { errs.push(`stop ${i}: color outside 0..255`); break; }
    }
  });
  return errs;
}
