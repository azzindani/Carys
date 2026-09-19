// A1 atlas index: BodyParts3D PART-OF long-bone digest, hand-authored from
// the archive's own mapping files (not invented). Each entry names the
// BodyParts3D representation id (BP…), the element file (FJ….mz3), the FMA
// concept id + English name from partof_parts_list_e.txt, and — for
// compounds — the member element files from partof_element_parts.txt.
//
// Ledger row: bodyparts3d-longbones, CC-BY-4.0, mode digest, lane A1,
// status shipped. Attribution string mirrors the README requirement.
// Prototype scope: structure names + shapes for teaching; never diagnosis.
//
// Dependency-free by design: volume-core cannot import @carys/study
// (study references volume-core). Entries below are plain objects shaped
// like study's KnowledgeEntry; the digest-registry test in study validates
// every entry through validateKnowledgeEntry, so drift fails loudly.

/** Required attribution (BodyParts3D README §3, CC-BY-4.0). */
export const ATLAS_ATTRIBUTION =
  'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';

/** Digest pin recorded in digestPins + the sidecar when this digest renders. */
export const ATLAS_DIGEST_ID = 'bodyparts3d-longbones';
export const ATLAS_DIGEST_PIN = 'BP3D-4.0-partof-obj99';

/** Knowledge-entry shape (mirrors study's KnowledgeEntry; validated there). */
export interface AtlasKnowledge {
  term: string;
  source: string;
  source_version: string;
  reviewed_by: string | null;
}

/** One selectable structure: mesh file + versioned knowledge entry. */
export interface AtlasStructure {
  /** Short key used by the UI + wire leg (e.g. 'femur-r'). */
  id: string;
  /** BodyParts3D representation id (BP…), stable across releases. */
  bpId: string;
  /** Vendored mesh file under digests/bodyparts3d-longbones/. */
  file: string;
  /** FMA-backed knowledge entry (reviewed_by null until expert review). */
  entry: AtlasKnowledge;
  /** Compound members (sternum); absent for single-element bones. */
  members?: string[];
}

const E = (term: string, source_version: string): AtlasKnowledge =>
  ({ term, source: 'FMA', source_version, reviewed_by: null });

/**
 * K1 resolution: every A1 label resolves through the term service.
 * structureTerm() is the single choke point — the AtlasView term row,
 * toasts, and status all read through it, so a rename in terms.json
 * propagates everywhere without touching this file. Falls back to the
 * hand-authored entry when the table isn't installed (tests that pin
 * A1 in isolation), but prefers the service: service mismatches stay
 * loud via resolveAtlasTerms(), never silent.
 */
export function structureTerm(s: AtlasStructure, byFma: (fma: string) => AtlasKnowledge | null): AtlasKnowledge {
  return byFma(s.entry.source_version) ?? s.entry;
}

/**
 * Cross-check every A1 entry against the installed term table.
 * [] = agreement; anything else names the drifted field(s). The
 * atlas-digest lane pins zero drift, so a terms.json refresh that
 * renames a bone fails loudly instead of forking the labels.
 */

// FMA ids + English names: partof_parts_list_e.txt (BP3D 4.0, PART-OF tree).
// Element files: partof_element_parts.txt. Both fetched 2026-09-17.
export const ATLAS_STRUCTURES: AtlasStructure[] = [
  { id: 'femur-r', bpId: 'BP10053', file: 'FJ3365.mz3', entry: E('right femur', 'FMA24474') },
  { id: 'femur-l', bpId: 'BP10115', file: 'FJ3259.mz3', entry: E('left femur', 'FMA24475') },
  { id: 'tibia-r', bpId: 'BP9559', file: 'FJ3387.mz3', entry: E('right tibia', 'FMA24477') },
  { id: 'tibia-l', bpId: 'BP10195', file: 'FJ3282.mz3', entry: E('left tibia', 'FMA24478') },
  { id: 'fibula-r', bpId: 'BP9550', file: 'FJ3366.mz3', entry: E('right fibula', 'FMA24480') },
  { id: 'fibula-l', bpId: 'BP9685', file: 'FJ3260.mz3', entry: E('left fibula', 'FMA24481') },
  { id: 'humerus-r', bpId: 'BP10197', file: 'FJ3368.mz3', entry: E('right humerus', 'FMA23130') },
  { id: 'humerus-l', bpId: 'BP10189', file: 'FJ3262.mz3', entry: E('left humerus', 'FMA23131') },
  { id: 'radius-r', bpId: 'BP9783', file: 'FJ3349.mz3', entry: E('right radius', 'FMA23464') },
  { id: 'radius-l', bpId: 'BP10123', file: 'FJ3277.mz3', entry: E('left radius', 'FMA23465') },
  { id: 'ulna-r', bpId: 'BP9679', file: 'FJ3391.mz3', entry: E('right ulna', 'FMA23467') },
  { id: 'ulna-l', bpId: 'BP10130', file: 'FJ3286.mz3', entry: E('left ulna', 'FMA23468') },
  { id: 'patella-r', bpId: 'BP9739', file: 'FJ3381.mz3', entry: E('right patella', 'FMA24486') },
  { id: 'patella-l', bpId: 'BP9728', file: 'FJ3275.mz3', entry: E('left patella', 'FMA24487') },
  { id: 'clavicle-r', bpId: 'BP10225', file: 'FJ3362.mz3', entry: E('right clavicle', 'FMA13322') },
  { id: 'clavicle-l', bpId: 'BP10007', file: 'FJ3237.mz3', entry: E('left clavicle', 'FMA13323') },
  { id: 'scapula-r', bpId: 'BP10144', file: 'FJ3384.mz3', entry: E('right scapula', 'FMA13395') },
  { id: 'scapula-l', bpId: 'BP10159', file: 'FJ3279.mz3', entry: E('left scapula', 'FMA13396') },
  {
    id: 'sternum', bpId: 'BP9392', file: 'FJ3178.mz3', entry: E('sternum', 'FMA7485'),
    members: ['FJ3153.mz3', 'FJ3178.mz3', 'FJ3290.mz3'],
  },
  { id: 'mandible', bpId: 'BP9617', file: 'FJ3289.mz3', entry: E('mandible', 'FMA52748') },
  // A2: ribs (12R + 12L, one file each), pelvis, sacrum, skull.
  { id: 'rib-r1', bpId: 'BP9714', file: 'FJ3334.mz3', entry: E('right first rib', 'FMA7857') },
  { id: 'rib-r2', bpId: 'BP10229', file: 'FJ3336.mz3', entry: E('right second rib', 'FMA7882') },
  { id: 'rib-r3', bpId: 'BP10077', file: 'FJ3338.mz3', entry: E('right third rib', 'FMA7909') },
  { id: 'rib-r4', bpId: 'BP10139', file: 'FJ3340.mz3', entry: E('right fourth rib', 'FMA7957') },
  { id: 'rib-r5', bpId: 'BP9975', file: 'FJ3342.mz3', entry: E('right fifth rib', 'FMA8066') },
  { id: 'rib-r6', bpId: 'BP10033', file: 'FJ3344.mz3', entry: E('right sixth rib', 'FMA8175') },
  { id: 'rib-r7', bpId: 'BP9669', file: 'FJ3346.mz3', entry: E('right seventh rib', 'FMA8229') },
  { id: 'rib-r8', bpId: 'BP10133', file: 'FJ3347.mz3', entry: E('right eighth rib', 'FMA8283') },
  { id: 'rib-r9', bpId: 'BP10184', file: 'FJ3348.mz3', entry: E('right ninth rib', 'FMA8364') },
  { id: 'rib-r10', bpId: 'BP9749', file: 'FJ3330.mz3', entry: E('right tenth rib', 'FMA8445') },
  { id: 'rib-r11', bpId: 'BP10071', file: 'FJ3331.mz3', entry: E('right eleventh rib', 'FMA8531') },
  { id: 'rib-r12', bpId: 'BP10213', file: 'FJ3332.mz3', entry: E('right twelfth rib', 'FMA8533') },
  { id: 'rib-l1', bpId: 'BP9978', file: 'FJ3228.mz3', entry: E('left first rib', 'FMA7987') },
  { id: 'rib-l2', bpId: 'BP10089', file: 'FJ3229.mz3', entry: E('left second rib', 'FMA8012') },
  { id: 'rib-l3', bpId: 'BP9720', file: 'FJ3230.mz3', entry: E('left third rib', 'FMA8039') },
  { id: 'rib-l4', bpId: 'BP9589', file: 'FJ3231.mz3', entry: E('left fourth rib', 'FMA8148') },
  { id: 'rib-l5', bpId: 'BP9794', file: 'FJ3232.mz3', entry: E('left fifth rib', 'FMA8093') },
  { id: 'rib-l6', bpId: 'BP10114', file: 'FJ3233.mz3', entry: E('left sixth rib', 'FMA8202') },
  { id: 'rib-l7', bpId: 'BP10209', file: 'FJ3234.mz3', entry: E('left seventh rib', 'FMA8256') },
  { id: 'rib-l8', bpId: 'BP9918', file: 'FJ3235.mz3', entry: E('left eighth rib', 'FMA8310') },
  { id: 'rib-l9', bpId: 'BP9773', file: 'FJ3236.mz3', entry: E('left ninth rib', 'FMA8391') },
  { id: 'rib-l10', bpId: 'BP10173', file: 'FJ3225.mz3', entry: E('left tenth rib', 'FMA8472') },
  { id: 'rib-l11', bpId: 'BP10142', file: 'FJ3226.mz3', entry: E('left eleventh rib', 'FMA8532') },
  { id: 'rib-l12', bpId: 'BP10125', file: 'FJ3227.mz3', entry: E('left twelfth rib', 'FMA8534') },
  {
    id: 'pelvis', bpId: 'BP9535', file: 'FJ2815.mz3', entry: E('pelvis', 'FMA9578'),
    members: ['FJ1426.mz3', 'FJ1426M.mz3', 'FJ1428.mz3', 'FJ1428M.mz3', 'FJ2815.mz3', 'FJ3152.mz3', 'FJ3288.mz3', 'FJ3393.mz3'],
  },
  { id: 'sacrum', bpId: 'BP10178', file: 'FJ3393.mz3', entry: E('sacrum', 'FMA16202') },
  {
    id: 'skull', bpId: 'BP9486', file: 'FJ1282.mz3', entry: E('skull', 'FMA46565'),
    members: ['FJ1282.mz3', 'FJ1285.mz3', 'FJ1286.mz3', 'FJ1289.mz3', 'FJ1297.mz3', 'FJ1299.mz3', 'FJ1305.mz3', 'FJ1317.mz3', 'FJ1320.mz3', 'FJ1331.mz3', 'FJ1336.mz3', 'FJ1337.mz3', 'FJ1340.mz3', 'FJ1348.mz3', 'FJ1350.mz3', 'FJ1356.mz3', 'FJ1368.mz3', 'FJ1371.mz3', 'FJ1382.mz3', 'FJ2772.mz3', 'FJ3199.mz3', 'FJ3200.mz3', 'FJ3201.mz3', 'FJ3263.mz3', 'FJ3265.mz3', 'FJ3269.mz3', 'FJ3272.mz3', 'FJ3273.mz3', 'FJ3274.mz3', 'FJ3281.mz3', 'FJ3287.mz3', 'FJ3289.mz3', 'FJ3309.mz3', 'FJ3369.mz3', 'FJ3371.mz3', 'FJ3375.mz3', 'FJ3378.mz3', 'FJ3379.mz3', 'FJ3380.mz3', 'FJ3386.mz3', 'FJ3392.mz3', 'FJ3394.mz3', 'FJ3395.mz3'],
  },
];

/** Atlas-local mm bounding boxes (min,max per axis), measured from the
 *  vendored meshes — drives fitMeshToBox-style framing without a volume. */
export interface AtlasBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export const ATLAS_BOUNDS: Record<string, AtlasBounds> = {
  'femur-r': { min: [-150, -112, 368], max: [-32, -50, 834] },
  'femur-l': { min: [32, -112, 368], max: [150, -49, 834] },
  'tibia-r': { min: [-109, -115, -6], max: [-35, -52, 374] },
  'tibia-l': { min: [35, -115, -6], max: [109, -52, 374] },
  'fibula-r': { min: [-120, -78, -25], max: [-84, -48, 359] },
  'fibula-l': { min: [85, -78, -25], max: [120, -49, 359] },
  'humerus-r': { min: [-241, -100, 1029], max: [-140, -51, 1337] },
  'humerus-l': { min: [140, -100, 1029], max: [241, -51, 1337] },
  'radius-r': { min: [-280, -127, 806], max: [-220, -61, 1035] },
  'radius-l': { min: [220, -127, 806], max: [279, -61, 1035] },
  'ulna-r': { min: [-247, -123, 805], max: [-197, -45, 1052] },
  'ulna-l': { min: [197, -123, 805], max: [247, -45, 1052] },
  'patella-r': { min: [-102, -123, 361], max: [-61, -101, 401] },
  'patella-l': { min: [61, -123, 361], max: [102, -101, 401] },
  'clavicle-r': { min: [-145, -147, 1309], max: [-10, -54, 1355] },
  'clavicle-l': { min: [8, -147, 1309], max: [144, -54, 1355] },
  'scapula-r': { min: [-166, -103, 1184], max: [-57, 5, 1350] },
  'scapula-l': { min: [57, -103, 1184], max: [166, 5, 1350] },
  sternum: { min: [-27, -214, 1164], max: [27, -131, 1325] },
  mandible: { min: [-54, -174, 1422], max: [53, -90, 1506] },
  'rib-r1': { min: [-70, -130, 1310], max: [-15, -64, 1370] },
  'rib-r2': { min: [-97, -167, 1274], max: [-16, -51, 1359] },
  'rib-r3': { min: [-109, -179, 1244], max: [-14, -37, 1336] },
  'rib-r4': { min: [-118, -192, 1211], max: [-15, -23, 1315] },
  'rib-r5': { min: [-127, -198, 1172], max: [-15, -13, 1291] },
  'rib-r6': { min: [-134, -194, 1138], max: [-15, -4, 1266] },
  'rib-r7': { min: [-137, -180, 1105], max: [-14, -4, 1240] },
  'rib-r8': { min: [-133, -163, 1075], max: [-14, -5, 1211] },
  'rib-r9': { min: [-129, -136, 1050], max: [-16, -8, 1185] },
  'rib-r10': { min: [-124, -118, 1023], max: [-17, -11, 1159] },
  'rib-r11': { min: [-111, -96, 1008], max: [-18, -18, 1122] },
  'rib-r12': { min: [-87, -66, 1011], max: [-18, -28, 1089] },
  'rib-l1': { min: [14, -130, 1310], max: [68, -64, 1370] },
  'rib-l2': { min: [15, -167, 1274], max: [96, -51, 1359] },
  'rib-l3': { min: [13, -179, 1244], max: [108, -37, 1336] },
  'rib-l4': { min: [13, -192, 1211], max: [116, -23, 1315] },
  'rib-l5': { min: [14, -198, 1172], max: [126, -13, 1291] },
  'rib-l6': { min: [13, -193, 1138], max: [133, -4, 1267] },
  'rib-l7': { min: [12, -180, 1105], max: [136, -4, 1240] },
  'rib-l8': { min: [12, -163, 1075], max: [132, -5, 1211] },
  'rib-l9': { min: [15, -136, 1050], max: [128, -8, 1185] },
  'rib-l10': { min: [16, -118, 1023], max: [122, -11, 1159] },
  'rib-l11': { min: [16, -96, 1008], max: [110, -18, 1122] },
  'rib-l12': { min: [17, -66, 1011], max: [85, -28, 1089] },
  pelvis: { min: [-145, -187, 752], max: [145, 7, 958] },
  sacrum: { min: [-60, -81, 783], max: [58, 7, 927] },
  skull: { min: [-76, -191, 1422], max: [75, 18, 1636] },
};

/** Look up a structure by UI id. Unknown ids are null (caller stays loud). */
export function atlasById(id: string): AtlasStructure | null {
  return ATLAS_STRUCTURES.find((s) => s.id === id) ?? null;
}

export interface AtlasTermHit {
  term: string;
  bpId: string | null;
}

export function resolveAtlasTerms(byFma: (fma: string) => AtlasTermHit | null): string[] {
  const drift: string[] = [];
  for (const s of ATLAS_STRUCTURES) {
    const t = byFma(s.entry.source_version);
    if (!t) {
      drift.push(`${s.id}: ${s.entry.source_version} missing from term table`);
      continue;
    }
    if (t.term !== s.entry.term) drift.push(`${s.id}: term "${s.entry.term}" != table "${t.term}"`);
    if (s.bpId && t.bpId !== s.bpId) drift.push(`${s.id}: bpId "${s.bpId}" != table "${t.bpId}"`);
  }
  return drift;
}
