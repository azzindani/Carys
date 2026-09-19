// Hanging protocols, minimal (Domain 9). A protocol maps what the study IS
// (modality + free-text body part) to how the viewer opens it: viewport
// layout, window/level preset, projection. Pure table + matcher, no DOM.
// Unknown studies fall back to the default 3-up; matching never throws.
export type HangLayout = 'tri' | 'axial' | 'coronal' | 'sagittal';

export interface HangingChoice {
  /** protocol id that matched (for the status line) */
  protocol: string;
  layout: HangLayout;
  /** key of volume-core PRESETS, or 'auto' */
  preset: string;
  proj: 'slice' | 'mip' | 'minip' | 'mean';
}

export interface HangingRule {
  id: string;
  modality: string; // upper-cased match, 'ANY' matches all
  body: RegExp | null; // matched against description/key, null = any
  choice: Omit<HangingChoice, 'protocol'>;
}

export const HANGING_RULES: HangingRule[] = [
  { id: 'ct-lung', modality: 'CT', body: /lung|chest|thorax|covid/i, choice: { layout: 'axial', preset: 'CT_Lung', proj: 'slice' } },
  { id: 'ct-bone', modality: 'CT', body: /bone|skull|spine|pelvis|fracture/i, choice: { layout: 'tri', preset: 'CT_Bone', proj: 'slice' } },
  { id: 'ct-angio', modality: 'CT', body: /angio|aaa|vessel|cardiac/i, choice: { layout: 'coronal', preset: 'CT_AAA', proj: 'mip' } },
  { id: 'ct-default', modality: 'CT', body: null, choice: { layout: 'tri', preset: 'CT_SoftTissue', proj: 'slice' } },
  { id: 'mr-brain', modality: 'MR', body: /brain|brats|tumor|flair|t1|t2/i, choice: { layout: 'tri', preset: 'MR_T2Brain', proj: 'slice' } },
  { id: 'mr-default', modality: 'MR', body: null, choice: { layout: 'tri', preset: 'MR_Default', proj: 'slice' } },
  // Mammo/tomo opens coronal (the stack plane) on auto window — MG has no
  // dedicated preset; BI-RADS assessment stays a reporting call, not a LUT.
  { id: 'mg-tomo', modality: 'MG', body: null, choice: { layout: 'coronal', preset: 'auto', proj: 'slice' } },
];

export const DEFAULT_HANGING: HangingChoice = { protocol: 'default', layout: 'tri', preset: 'auto', proj: 'slice' };

/** First matching rule wins; unknown modality/description -> default. */
export function hangingProtocol(modality: string, description = ''): HangingChoice {
  const mod = (modality || '').toUpperCase();
  for (const r of HANGING_RULES) {
    if (r.modality !== mod) continue;
    if (r.body && !r.body.test(description)) continue;
    return { protocol: r.id, ...r.choice };
  }
  return { ...DEFAULT_HANGING };
}

/** Protocol ids in priority order (for the dock selector). */
export function hangingIds(): string[] {
  return [...HANGING_RULES.map((r) => r.id), 'default'];
}
