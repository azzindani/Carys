// PS3.15 Basic Application Confidentiality Profile: tag-level action
// table (replace / remove / keep) + retain-safe-private allowlist. Operates
// on plain tag maps ({group+element hex → value}) so it stays decoupled
// from the binary walker — the app projects a Dataset into a map, runs
// this, and writes the actions back. Pure, no DOM.
//
// The table covers the profile's headline identity tags (patient, dates,
// times, UIDs get re-rooted by anonymize.ts, not here). Anything NOT in
// the table returns 'pass' — unknown tags are never touched by default,
// and the caller logs the untouched count.
export type DeidAction = 'replace' | 'remove' | 'keep' | 'pass';

/** Normalized 8-hex-digit tag key, e.g. "00100010". */
export function tagKey(group: number, element: number): string {
  return group.toString(16).padStart(4, '0') + element.toString(16).padStart(4, '0');
}

// Patient / physician / institution identity → replace with profile values.
const REPLACE = new Set([
  '00100010', // PatientName
  '00100020', // PatientID
  '00100030', // PatientBirthDate
  '00080080', // InstitutionName
  '00080081', // InstitutionAddress
  '00081048', // PhysiciansOfRecord
  '00081060', // NameOfPhysiciansReadingStudy
  '00081070', // OperatorsName
  '00101060', // PatientMotherBirthName
  '00400275', // RequestingPhysician (sequence — flagged, children untouched)
]);

// Dates/times → remove unless the profile retains them.
const DATES = new Set([
  '00080020', // StudyDate
  '00080021', // SeriesDate
  '00080030', // StudyTime
  '00080031', // SeriesTime
  '00100030', // PatientBirthDate (also replace-listed: remove wins when !keepDates)
  '00400002', // ScheduledProcedureStepStartDate
  '00400003', // ScheduledProcedureStepStartTime
]);

/** Safe-private allowlist (retain-safe-private option): vendor tags known
 *  harmless — everything else private (gggg odd) is removed. */
const SAFE_PRIVATE = new Set([
  '00191080', // Siemens B-value (diffusion — safe, documented example)
  '0019100c', // Siemens diffusion directionality
]);

export interface DeidResult {
  actions: Map<string, DeidAction>;
  replaced: number;
  removed: number;
  kept: number;
  untouched: number;
}

/**
 * Classify every tag in the map. `keepDates` retains DATES as keep;
 * `retainSafePrivate` keeps SAFE_PRIVATE privates, removes other privates.
 * UIDs (re-rooted downstream) and pixels always pass.
 */
export function classifyDeid(
  tags: Map<string, unknown>,
  opts: { keepDates?: boolean; retainSafePrivate?: boolean } = {},
): DeidResult {
  const { keepDates = false, retainSafePrivate = false } = opts;
  const actions = new Map<string, DeidAction>();
  let replaced = 0, removed = 0, kept = 0, untouched = 0;
  for (const key of tags.keys()) {
    const k = key.toLowerCase();
    let a: DeidAction;
    if (DATES.has(k.toUpperCase()) || k.toUpperCase() === '00100030') {
      a = keepDates ? 'keep' : (REPLACE.has(k.toUpperCase()) ? 'replace' : 'remove');
    } else if (REPLACE.has(k.toUpperCase())) {
      a = 'replace';
    } else if (parseInt(k.slice(0, 4), 16) % 2 === 1) {
      // odd group = private
      a = retainSafePrivate && SAFE_PRIVATE.has(k.toUpperCase()) ? 'keep' : 'remove';
    } else {
      a = 'pass';
    }
    // UIDs + pixel data always pass (re-rooted / kept downstream)
    if (/^(0020000d|0020000e|00080018|7fe00010)$/i.test(k)) a = 'pass';
    actions.set(key, a);
    if (a === 'replace') replaced++;
    else if (a === 'remove') removed++;
    else if (a === 'keep') kept++;
    else untouched++;
  }
  return { actions, replaced, removed, kept, untouched };
}
