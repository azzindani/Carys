// Screen-space depth cues (F7, docs/PHASES.md): a post-pass over the
// rasterizer's depth and normal buffers. Ambient occlusion darkens
// crevices and contact; silhouettes mark where one surface passes in front
// of another. Orthographic view space: x right, y up, z towards the
// viewer; a pixel nothing drew on has depth −∞.
//
// Occlusion is the normal-oriented estimator of McGuire et al. 2011 ("The
// Alchemy screen-space ambient obscurance algorithm"): samples on a spiral
// in a screen disc, each read back from the depth buffer to a point, and
// every point above the tangent plane occludes by its cosine, fading to
// nothing at the radius. The spiral's angle turns over a 4×4 tile and a
// depth-aware blur spanning the tile averages it out, so the result is
// deterministic: no noise, no shimmer between frames.

/** What the rasterizer knows per pixel. */
export interface GBuffer {
  width: number;
  height: number;
  /** view z (larger = nearer), −∞ where nothing drew */
  depth: Float32Array;
  /** unit view-space normal */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

export interface AoOpts {
  /** sampling disc radius, pixels */
  radiusPx: number;
  /** world units one pixel spans (orthographic: the same everywhere) */
  unitPerPx: number;
  /** darkening at full occlusion; 1 − strength × mean occlusion, clamped */
  strength: number;
}

const SAMPLES = 12;
/** Turns of the sample spiral: coprime with SAMPLES so no two samples align. */
const TURNS = 5;
/** A sample this close to the tangent plane (cosine) does not occlude: flat
 *  surfaces stay unshaded despite depth rounding. */
const BIAS = 0.05;
const TILE = 4;

/**
 * Per-pixel ambient light factor in [0, 1]: 1 unoccluded (and on the
 * background), lower in crevices. Throws `ao-radius` for a disc that
 * samples nothing.
 */
export function ambientOcclusion(g: GBuffer, o: AoOpts): Float32Array {
  const { width: W, height: H, depth: D, nx: NX, ny: NY, nz: NZ } = g;
  if (!(o.radiusPx >= 1) || !(o.unitPerPx > 0)) throw new RangeError(`ao-radius: ${o.radiusPx} px at ${o.unitPerPx} per px`);
  const u = o.unitPerPx, R2 = (o.radiusPx * u) ** 2;
  // the spiral for each tile phase, as whole-pixel offsets; phases are
  // scrambled so neighbouring pixels sample different directions
  const offX = new Int32Array(TILE * TILE * SAMPLES), offY = new Int32Array(TILE * TILE * SAMPLES);
  for (let k = 0; k < TILE * TILE; k++) {
    const phase = (2 * Math.PI * ((k * 7) % (TILE * TILE))) / (TILE * TILE);
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i + 0.5) / SAMPLES;
      const th = 2 * Math.PI * a * TURNS + phase;
      offX[k * SAMPLES + i] = Math.round(a * o.radiusPx * Math.cos(th));
      offY[k * SAMPLES + i] = Math.round(a * o.radiusPx * Math.sin(th));
    }
  }
  const raw = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, z = D[p]!;
      if (z === -Infinity) continue;
      const nx = NX[p]!, ny = NY[p]!, nz = NZ[p]!;
      const base = ((y % TILE) * TILE + (x % TILE)) * SAMPLES;
      let sum = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const dx = offX[base + i]!, dy = offY[base + i]!;
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const zq = D[qy * W + qx]!;
        if (zq === -Infinity) continue;
        // from this pixel's point to the sample's, screen y pointing down
        const vx = dx * u, vy = -dy * u, vz = zq - z;
        const d2 = vx * vx + vy * vy + vz * vz;
        if (d2 >= R2 || d2 === 0) continue;
        const c = (vx * nx + vy * ny + vz * nz) / Math.sqrt(d2) - BIAS;
        if (c > 0) sum += c * (1 - d2 / R2);
      }
      raw[p] = Math.max(0, 1 - (o.strength * sum) / SAMPLES);
    }
  }
  // Blur across one tile period, horizontally then vertically: taps −2..2
  // weighted ½,1,1,1,½ average any 4-periodic pattern exactly. Taps on
  // another surface (a depth step past the radius) are left out.
  const tol = Math.sqrt(R2);
  const pass = (src: Float32Array, sx: number, sy: number): Float32Array => {
    const dst = new Float32Array(src);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, z = D[p]!;
        if (z === -Infinity) continue;
        let acc = 0, wsum = 0;
        for (let t = -2; t <= 2; t++) {
          const qx = x + t * sx, qy = y + t * sy;
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const q = qy * W + qx;
          if (!(Math.abs(D[q]! - z) < tol)) continue;
          const w = t === -2 || t === 2 ? 0.5 : 1;
          acc += w * src[q]!; wsum += w;
        }
        dst[p] = acc / wsum;
      }
    }
    return dst;
  };
  return pass(pass(raw, 1, 0), 0, 1);
}

/**
 * 1 on the near side of every depth step: a drawn pixel with a neighbour
 * within `reach` pixels (along x or y) that is background or farther than
 * `gap` world units.
 */
export function silhouettes(depth: Float32Array, W: number, H: number, reach: number, gap: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, far = depth[p]! - gap;
      if (depth[p] === -Infinity) continue;
      for (let r = 1; r <= reach && !out[p]; r++) {
        if ((x >= r && depth[p - r]! < far) || (x + r < W && depth[p + r]! < far)
          || (y >= r && depth[p - r * W]! < far) || (y + r < H && depth[p + r * W]! < far)) out[p] = 1;
      }
    }
  }
  return out;
}
