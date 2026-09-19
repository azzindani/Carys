# Digest Group 12 — CPU 3D receipts (surface, nets, raster, STL, worker)

## surface.ts — cuberille boundary faces (no tables)
- Per exposed voxel face: quad → 2 tris, CCW-from-outside (test-verified:
  geometric normal == face normal on every triangle).

## surface-nets.ts — naive surface nets (no tables, smooth)
- Cell vertex = mean of interpolated zero-crossings; quads around
  sign-changing edges, flip-checked against outward hint; area-weighted
  smooth vertex normals. Proven: voxel→12 tris, sphere closed, normals unit.

## raster.ts — orthographic + Lambert + z-buffer + backface cull → RGBA.

## stl.ts — binary STL export + test-only re-parse inverse.
- Proven: skull mesh round-trips facet count + byte-exact vertices.

## Goldens (eyeballed + frozen)
- skull-orbit (39k, partial bone — seg covers lower skull only),
  brats-tumor-orbit (24k), skull-ct-smooth (117k, iso 250, 0.4s).

## extract.worker.js — real Web Worker, transferable buffers both ways,
- main-thread fallback; status line reports the path taken.
