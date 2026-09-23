import type { Nifti1Header } from '@carys/io';
import { frameDiff } from '@carys/measure';
import { decodeNiiFrame } from './loaders';
import { paintBus } from './paintBus';
import { session } from './session';
import { getUi, setUi } from './store';
import { setStatus } from './status';
import { bump } from './version';

/** Cine transport (OHIF's Cine player): frame switching + interval
 *  playback. Two sources, one rail: the 4D NIfTI path replays retained
 *  raw bytes, the DICOM upload path replays decoded frame pixels.
 *  Split out of sessionOps by responsibility (rule 1: time lives here,
 *  opens/imports live there). */

/** Fastest playback the transport offers (fps). One bound for the FPS
 *  slider and for a file's own rate: ultrasound records 20–30 fps, and a
 *  slider that stopped at 12 clamped a file's 26 to 12 behind its back. */
export const CINE_MAX_FPS = 30;

type CineSource =
  | { kind: 'nii'; raw: { hdr: Nifti1Header; buf: ArrayBuffer } }
  | { kind: 'dcm'; id: object };

/** Current playable source (null = single frame, nothing to play). */
function cineSource(): CineSource | null {
  if (session.rawNii && session.timeNt > 1) return { kind: 'nii', raw: session.rawNii };
  if (session.dcmFrames && session.timeNt > 1) return { kind: 'dcm', id: session.dcmFrames };
  return null;
}

/** Switch the displayed cine frame (mask keeps overlaying the current frame). */
export function setTimeFrame(t: number): void {
  const src = cineSource();
  if (!src || !session.img) return;
  const frames = src.kind === 'nii' ? src.raw.hdr.nt : session.dcmFrames!.frames.length;
  const tc = Math.min(frames - 1, Math.max(0, Math.floor(t)));
  const v = src.kind === 'nii'
    ? decodeNiiFrame(src.raw.hdr, src.raw.buf, tc)
    : { dims: session.img.dims, data: session.dcmFrames!.frames[tc]!, spacing: session.img.spacing };
  session.img = v;
  session.timeT = tc;
  if (session.baseFrame && tc > 0) {
    const d = frameDiff(v.data, session.baseFrame);
    session.timeDiff = { meanAbs: d.meanAbs, changedFrac: d.changedFrac };
    setStatus(`t=${tc}/${frames - 1} · Δ vs f0: mean ${d.meanAbs.toFixed(1)} · ${(d.changedFrac * 100).toFixed(1)}% changed`);
  } else {
    session.timeDiff = null;
    setStatus(tc === 0 ? `t=0/${frames - 1} (baseline)` : `t=${tc}/${frames - 1}`);
  }
  setUi({});
  bump();
}

/** Cine transport: interval playback over the retained frames. The
 *  timer owns nothing: it self-stops when the series changes underneath
 *  it, so no stop call is needed on series switch. */
let cineTimer: ReturnType<typeof setInterval> | null = null;
let cineSrc: CineSource | null = null;

export function isCinePlaying(): boolean {
  return cineTimer !== null;
}

export function stopCine(): void {
  if (cineTimer !== null) {
    clearInterval(cineTimer);
    cineTimer = null;
    cineSrc = null;
  }
}

/** Restart a running cine at the current fps (FPS slider while playing). */
export function retimeCine(): void {
  if (cineTimer === null || cineSrc === null) return;
  clearInterval(cineTimer);
  cineTimer = null;
  const src = cineSrc;
  cineSrc = null;
  startCine(src);
}

function startCine(src: CineSource): void {
  cineSrc = src;
  const period = Math.max(1, Math.round(1000 / Math.max(1, getUi().cineFps)));
  cineTimer = setInterval(() => {
    // series switched, frames gone, or single frame: die quietly
    const now = cineSource();
    const same = now && now.kind === src.kind && (src.kind === 'nii'
      ? (now as { kind: 'nii'; raw: unknown }).raw === src.raw
      : (now as { kind: 'dcm'; id: unknown }).id === src.id);
    if (!same) {
      stopCine();
      bump();
      return;
    }
    setTimeFrame((session.timeT + 1) % session.timeNt);
    paintBus.mpr();
  }, period);
}

export function toggleCine(): void {
  if (cineTimer !== null) {
    stopCine();
    setStatus('cine paused');
    setUi({});
    bump();
    return;
  }
  const src = cineSource();
  if (!src) {
    setStatus('cine needs a multi-frame series');
    return;
  }
  startCine(src);
  setStatus(`cine playing @ ${getUi().cineFps} fps`);
  setUi({});
  bump();
}
