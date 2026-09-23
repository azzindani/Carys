// 3D → 2D picking (F12, docs/PHASES.md): a tap on the 3D view moves every
// pane to the point under it — the surface's nearest face, or where the
// volume render turns half opaque (render-cpu/pick.ts), past whatever the
// clip removed — and the status says what was hit. A surface is hit on its
// boundary, so the voxel taken is the first one of the structure a short
// way along the ray.
import { pickSurface, pickVolume, type PickHit, type TF } from '@carys/render-cpu';
import { clipOf } from '../lib/clip3d';
import { paintBus } from '../lib/paintBus';
import { physicalMesh, toMm, vrBounds } from '../lib/physical3d';
import { session } from '../lib/session';
import { setStatus } from '../lib/status';
import { getUi } from '../lib/store';

type V3 = [number, number, number];

export interface PickView {
  canvas: HTMLCanvasElement;
  orbit: number;
  tilt: number;
  zoom: number;
  /** the surface's orbit centre, voxels (a mask's box), or the volume's */
  center: V3 | null;
  /** what the volume render uses, when the canvas shows one */
  vr: { tf: TF; density: number; alphaStep: number };
}

/** How far past the hit (voxels) to look for the structure. */
const INSIDE_REACH = 2;
/** Finer than any render step: the pick finds the surface, not the lattice. */
const PICK_STEP = 1;

export function pick3d(view: PickView, clientX: number, clientY: number): void {
  const img = session.img;
  if (!img) return;
  const { canvas } = view;
  const r = canvas.getBoundingClientRect();
  const x = (clientX - r.left) * (canvas.width / r.width), y = (clientY - r.top) * (canvas.height / r.height);
  const sp: V3 = img.spacing ?? [1, 1, 1];
  const u = getUi();
  const mask = u.src === 'mask' ? session.editMask : null;
  const volume = u.render3d === 'volume';
  let hit: PickHit | null = null;
  if (volume) {
    hit = pickVolume({ dims: img.dims, data: mask ? Float64Array.from(mask) : img.data }, {
      width: canvas.width, height: canvas.height, angleY: view.orbit, tiltX: view.tilt, zoom: view.zoom,
      tf: view.vr.tf, density: view.vr.density, alphaStep: view.vr.alphaStep, step: PICK_STEP,
      spacing: sp, bounds: mask ? vrBounds(mask, img.dims) : null, clip: clipOf(u.clip3d, img.dims, -0.5),
    }, x, y);
  } else if (session.mesh) {
    // the surface is drawn in mm: pick it there, then back to voxels
    const box = toMm(img.dims, sp);
    const h = pickSurface(physicalMesh(session.mesh, sp), box, {
      width: canvas.width, height: canvas.height, angleY: view.orbit, tiltX: view.tilt, zoom: view.zoom,
      center: view.center ? toMm(view.center, sp) : undefined, clip: clipOf(u.clip3d, box),
    }, x, y);
    if (h) {
      const d: V3 = [h.dir[0] / sp[0], h.dir[1] / sp[1], h.dir[2] / sp[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      hit = { point: [h.point[0] / sp[0], h.point[1] / sp[1], h.point[2] / sp[2]], dir: [d[0] / l, d[1] / l, d[2] / l] };
    }
  }
  if (!hit) {
    setStatus(`3D pick on the ${volume ? 'volume render' : 'surface'}: nothing drawn under the pointer`);
    return;
  }
  const [nx, ny, nz] = img.dims;
  const at = (s: number): V3 => [
    Math.min(nx - 1, Math.max(0, Math.floor(hit.point[0] + hit.dir[0] * s))),
    Math.min(ny - 1, Math.max(0, Math.floor(hit.point[1] + hit.dir[1] * s))),
    Math.min(nz - 1, Math.max(0, Math.floor(hit.point[2] + hit.dir[2] * s))),
  ];
  const idx = (v: V3): number => (v[2] * ny + v[1]) * nx + v[0];
  // the structure: a labelled voxel for a mask, above the surface's
  // threshold for an image; a volume pick is already inside what it shows
  const inside = (v: V3): boolean => (mask ? mask[idx(v)]! > 0 : volume || img.data[idx(v)]! > u.threshold);
  let voxel = at(0.5);
  for (let s = 0; s <= INSIDE_REACH; s += 0.25) {
    if (inside(at(s))) { voxel = at(s); break; }
  }
  paintBus.jumpTo(voxel, !volume);
  const value = img.data[idx(voxel)]!;
  const label = session.editMask ? ` · label ${session.editMask[idx(voxel)]}` : '';
  setStatus(`3D pick on the ${volume ? 'volume render' : 'surface'} → voxel (${voxel.join(', ')}) · value ${Number.isInteger(value) ? value : value.toFixed(1)}${label}`);
}
