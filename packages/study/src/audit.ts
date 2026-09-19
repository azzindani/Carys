// Audit trail: who measured what, when. Append-only event log over the
// session (measurement created/deleted, mask op, calibration, compare,
// import/export) with ISO timestamps + series + actor. Local-only, capped
// length (ring), JSON-serializable for the sidecar/report. No backend —
// the multi-user signature half stays out (product + auth decision).
export type AuditAction =
  | 'measure.create' | 'measure.delete'
  | 'mask.op' | 'mask.clear' | 'mask.undo'
  | 'spacing.calibrate'
  | 'compare.set' | 'compare.clear'
  | 'seg.import' | 'seg.export'
  | 'read.read' | 'read.sign' | 'read.unlock'
  | 'report.export' | 'sidecar.export'
  | 'quiz.answer';

export interface AuditEvent {
  seq: number;
  at: string;
  actor: string;
  action: AuditAction;
  series: string;
  detail: string;
}

const CAP = 500;

let seq = 0;
const log: AuditEvent[] = [];

/** Record one event (actor defaults to the local user). Returns the event. */
export function audit(
  action: AuditAction, series: string, detail = '', actor = 'local',
): AuditEvent {
  seq++;
  const ev: AuditEvent = {
    seq, at: new Date().toISOString(), actor, action, series, detail,
  };
  log.push(ev);
  while (log.length > CAP) log.shift();
  return ev;
}

/** Snapshot of the trail (oldest first). */
export function auditTrail(): AuditEvent[] {
  return log.slice();
}

/** Events for one series (or all when omitted). */
export function auditFor(series?: string): AuditEvent[] {
  if (!series) return auditTrail();
  return log.filter((e) => e.series === series);
}

/** JSON export (report attachment). */
export function auditToJSON(events: AuditEvent[] = log): string {
  return JSON.stringify(events, null, 2);
}

/** Reset (tests + new session). Returns the dropped count. */
export function auditClear(): number {
  const n = log.length;
  log.length = 0;
  return n;
}
