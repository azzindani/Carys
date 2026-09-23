// The 3D views' clip (F13) from the UI's fractions to a renderer's Clip:
// the surface takes it in mm, the volume render in voxels, so the caller
// passes the volume's extent in those units. Nothing to cut gives
// undefined, and the renders stay exactly as they were. The raycaster
// samples voxel centres at integers, half a voxel off the meshes' frame
// (voxel i spans [i, i + 1]), so it takes `shift` −0.5 to cut in the same
// place.
import type { Clip } from '@carys/render-cpu';
import type { Clip3d } from './types';

type V3 = [number, number, number];

/** Nothing cut: the state a session starts in and Reset returns to. */
export const CLIP_OFF: Clip3d = { on: false, plane: 'none', at: 0.5, flip: false, box: [0, 1, 0, 1, 0, 1] };

/** Axis each plane cuts across: axial z, coronal y, sagittal x. */
const AXIS = { axial: 2, coronal: 1, sagittal: 0 } as const;

export function clipOf(c: Clip3d, extent: V3, shift = 0): Clip | undefined {
  if (!c.on) return undefined;
  const out: Clip = {};
  const b = c.box;
  if (b.some((v, i) => v !== (i % 2 === 0 ? 0 : 1))) {
    out.box = {
      min: [b[0] * extent[0] + shift, b[2] * extent[1] + shift, b[4] * extent[2] + shift],
      max: [b[1] * extent[0] + shift, b[3] * extent[1] + shift, b[5] * extent[2] + shift],
    };
  }
  if (c.plane !== 'none') {
    const a = AXIS[c.plane], normal: V3 = [0, 0, 0];
    // keep coordinate ≤ at·extent; flipped, keep ≥ (−p ≤ −at·extent)
    normal[a] = c.flip ? -1 : 1;
    out.plane = { normal, offset: (c.flip ? -1 : 1) * (c.at * extent[a] + shift) };
  }
  return out.box || out.plane ? out : undefined;
}
