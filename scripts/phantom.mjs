// The synthetic head phantom, shared by every generator that needs one.
//
// Lifted out of gen-phantom.mjs when the CT series generator needed the same
// anatomy: one body, two containers (NIfTI volume, DICOM slice stack), so the
// 3D surface extracted from a .nii and from a .dcm series is provably the same
// shape and not two hand-tuned approximations (§4).
//
// No patient data ever enters the repo (README privacy note).

/** Deterministic noise: a plain LCG, so reruns are byte-identical. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Squared normalised distance inside an axis-aligned ellipsoid. */
export const ell = (x, y, z, cx, cy, cz, rx, ry, rz) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;

/**
 * A head-shaped phantom: skull shell, brain, paired ventricles and one
 * off-centre lesion.
 *
 * Intensities are real Hounsfield values (air -1000, CSF ~10, white ~30,
 * grey ~42, lesion ~72, bone ~1100) so the stock window/level presets land on
 * actual contrast, and so an isosurface at a bone threshold finds a skull
 * rather than a blob. An earlier pass used arbitrary values around 300 and
 * every soft tissue clipped to white under a soft-tissue window.
 */
export function head(nx, ny, nz, seed) {
  const img = new Float32Array(nx * ny * nz);
  const seg = new Uint8Array(nx * ny * nz);
  const rand = rng(seed);
  const cx = nx / 2, cy = ny / 2, cz = nz / 2;
  // Anterior-right so it is obvious which way the volume faces, and at the
  // depth the catalog's axialFrac opens on, so the mask overlay is on screen
  // the moment the study loads rather than a slider hunt away.
  const lx = cx + nx * 0.14, ly = cy - ny * 0.1, lz = nz * 0.72;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = z * nx * ny + y * nx + x;
        const skull = ell(x, y, z, cx, cy, cz, nx * 0.44, ny * 0.38, nz * 0.42);
        if (skull > 1) { img[i] = -1000; continue; }   // air outside the head
        const brain = ell(x, y, z, cx, cy, cz, nx * 0.39, ny * 0.33, nz * 0.37);
        let v;
        if (brain > 1) {
          v = 1050 + rand() * 150;                     // cortical bone
        } else {
          // grey/white contrast from a smooth field, plus scanner-ish noise
          const gw = Math.sin(x * 0.19) * Math.cos(y * 0.17) * Math.sin(z * 0.15);
          v = 36 + gw * 7 + (rand() - 0.5) * 3;        // white ~30, grey ~43
          const vent = Math.min(
            ell(x, y, z, cx - nx * 0.06, cy, cz, nx * 0.05, ny * 0.14, nz * 0.07),
            ell(x, y, z, cx + nx * 0.06, cy, cz, nx * 0.05, ny * 0.14, nz * 0.07),
          );
          if (vent <= 1) v = 8 + rand() * 6;           // CSF
        }
        if (ell(x, y, z, lx, ly, lz, nx * 0.09, ny * 0.08, nz * 0.08) <= 1) {
          v = 72 + rand() * 10;                        // enhancing lesion
          seg[i] = 1;
        }
        img[i] = v;
      }
    }
  }
  return { img, seg };
}
