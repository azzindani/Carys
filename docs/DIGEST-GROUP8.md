# Digest Group 8 — NGL full-clone protocol receipt

## NGL (nglviewer/ngl) v2.5.0 — TypeScript + GLSL, 333 src files / ~63k LOC
- stage/viewer/component/representation/buffer/shader + parser/structure/
  proxy/color/geometry/loader/selection.
- PORTED → `volume-core/protein.ts`:
  - Rep catalogue + defaults (spacefill, ball+stick, licorice, line,
    cartoon sstruc/0.7/aspect-5, trace chainname, tube, ribbon, backbone,
    point) + REP_DEFAULTS.
  - Param plumbing (sele/colorScheme/radiusType/Scale/aspectRatio/assembly)
    + ComponentSpec/RepresentationSpec layering.
  - RadiusFactory (vdw/covalent/bfactor/sstruc/size, clamp 10A).
  - Jmol element + sstruc color tables.
  - CPU projectAtoms + plddtColor (kept).
- SKIPPED: all shaders/impostors, three.js viewer/scene, buffers,
  surface/volume stack, trajectories/symmetry, measurement/UI reps,
  advanced colormakers (electrostatic/partialcharge/densityfit),
  MMTF special-casing, writers/datasources/streamers.
