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
  const stops = sortTF(tf);
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

export type TFPresetName = 'bone' | 'soft' | 'lung' | 'brain' | 'xray';

export const TF_PRESETS: TFPresetName[] = ['bone', 'soft', 'lung', 'brain', 'xray'];

/** Build preset stops for a volume with data range [min, max]. */
export function presetTF(name: TFPresetName, min: number, max: number): TF {
  const span = max - min || 1;
  const at = (f: number): number => min + span * f;
  const C = {
    bone: [235, 225, 205] as [number, number, number],
    soft: [200, 130, 110] as [number, number, number],
    lung: [150, 180, 200] as [number, number, number],
    brain: [190, 170, 160] as [number, number, number],
    blood: [220, 60, 50] as [number, number, number],
    air: [120, 160, 190] as [number, number, number],
  };
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
