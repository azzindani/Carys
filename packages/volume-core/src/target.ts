// Ported from RCSB rcsb-molstar selection.ts Target DTO (assembly-aware,
// smaller than PDBe's 30-field QueryParam). CPU-side address, no Mol*.

export interface Target {
  labelAsymId?: string;
  labelSeqId?: number;
  labelSeqRange?: [number, number];
  authSeqId?: number;
  labelCompId?: string;
  operatorName?: string;
  structOperId?: string;
  modelId?: number;
}

export type SelectTarget =
  | { kind: 'single'; target: Target }
  | { kind: 'range'; target: Target; to: Target };

export function normalizeTarget(t: Target): Target {
  return {
    ...t,
    operatorName: t.operatorName ?? (t.structOperId ? `ASM_${t.structOperId}` : undefined),
  };
}
