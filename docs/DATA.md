# Data

Carys uses data in two places:

- **Data sets** (`digests/`): committed to the repository, shipped in the
  image and fetched by the app at runtime. These are the atlases,
  structures, motion and catalogs.
- **The sample set** (`samples/`): imaging the worklist opens. It is never
  committed or baked into an image, and is mounted read-only where it is
  served.

## Policy

- **Licences.** Only data licensed **CC0** or **CC BY 4.0** is published,
  whether shipped in the image or served from a deployment's sample set.
  CC BY data carries its attribution where the app shows it: the atlas
  credit lines, each body part's and HRA organ's card, and the capsid and
  microbe views.
- **Provenance.** Every data set records where it came from in a
  `SOURCES.json` beside it:
  - the source URL;
  - the retrieval date;
  - the SPDX licence;
  - a version pin;
  - an entry count.

  `DIGESTS.json` at the repo root registers every data set with its licence
  and status. Tests check the registry against the files, and the Report
  route prints the registry.
- **No patient data.** The repository holds none. Its sample volumes are
  synthetic, written by the repo's own generators.

## Data sets shipped in the image

`digests/` is copied into the image whole and served at `/digests/`.

| Data set | Contents | Licence | Source |
|---|---|---|---|
| `bodyparts3d-body` | 2,234 BodyParts3D element meshes, one file per body system, with an index of every part (FMA id, name, system) | CC BY 4.0 | BodyParts3D 4.0, DBCLS |
| `bodyparts3d-longbones` | 96 long-bone meshes | CC BY 4.0 | BodyParts3D 4.0 |
| `bodyparts3d-terms` | 1,368 PART-OF and IS-A concepts, used by the atlas search | CC BY 4.0 | BodyParts3D 4.0 |
| `hra-organs` | HuBMAP Human Reference Atlas male reference organs, fitted and bent into the BodyParts3D body, with a citation per organ | CC BY 4.0 | HuBMAP HRA 3D reference library |
| `body-rig` | The skeleton rig and skin weights fitted to both body data sets | CC BY 4.0 (derived from BodyParts3D and HRA) | Built by `scripts/build-body-rig.mjs` |
| `gait-motions` | Walking and running cycles, averaged and retargeted to the rig | CC BY 4.0 | figshare 5722711 v6 and 4543435 v5 |
| `rcsb-capsids` | Seven virus capsid entries (1SVA, 1IHM, 2PLV, 4RHV, 1QGT, 2MS2, 1STM) | CC0 | RCSB PDB |
| `rcsb-pathogens` | Five teaching structures (6M0J, 6W41, 1QGT, 4OZF, 1BV1) | CC0 | RCSB PDB |
| `microbe-library` | Microbiology cards and their structures. Card text is from CC BY 4.0 articles, each licence checked at Crossref; the structures are PDB entries. | CC BY 4.0 (text), CC0 (structures) | Journal of General Virology articles, RCSB PDB |
| `idr-screens` | Metadata for two IDR idr0083 images. The pixels stay on IDR's servers. | CC BY 4.0 | Image Data Resource |
| `openneuro-ds000001` | Provenance only. The two cropped volumes are in the sample set. | CC0 | OpenNeuro ds000001 1.0.0 |

`idr-catalog` in the registry (CC0) is the table of public IDR OME-Zarr
stores in `packages/io/src/idr-catalog.ts`. Its pixels stay remote too.

Tests hold the rule: every row of `DIGESTS.json` and of the report's
attribution table must be `CC0-1.0` or `CC-BY-4.0`
(`study/src/test/sources.test.ts`, `report.test.ts`).

### Rebuilding a data set

The build scripts are deterministic. Each one checks its inputs before
writing: hashes, entry counts, and licences at the source.

| Script | Writes |
|---|---|
| `scripts/build-body-atlas.mjs` | `bodyparts3d-body` |
| `scripts/build-body-hra.mjs` | `hra-organs` |
| `scripts/build-body-rig.mjs` | `body-rig` |
| `scripts/build-body-gait.mjs` | `gait-motions` |
| `scripts/build-capsids.mjs` | `rcsb-capsids` (checks every expansion against RCSB's own assembly files) |
| `scripts/build-microbes.mjs` | `microbe-library` (checks each DOI's licence at Crossref, and each PDB entry's author and organism at RCSB) |

A rebuild changes the data set's pins. The app refuses a rig fitted to other
pins, and the digest tests fail until the recorded counts and hashes agree.

## The sample set

The Studies route opens volumes from `/samples/`.
`packages/testkit/samples.manifest.json` names every file of a complete set
with its size and SHA-256.

- **Synthetic files.** These are written by the generators with the
  repo's own writers, and are deterministic: a rerun produces byte-identical
  files.

  | Script | Writes |
  |---|---|
  | `gen:phantom` | Head phantoms (skull, grey and white matter, ventricles, an enhancing lesion, at real Hounsfield values) as NIfTI |
  | `gen:ct` | The same head as a 120-slice DICOM series |
  | `gen:cells`, `gen:plate` | OME-Zarr cells and a plate |
  | `gen:ometiff`, `gen:tczyx` | Small OME-TIFFs |
  | `gen:precomputed` | A Neuroglancer precomputed volume |

  `npm run gen:samples` runs the phantom, CT, cells and plate generators.
  `CARYS_SAMPLES_DIR=<dir>` sends the output somewhere other than
  `samples/`. Use it for any directory that already holds a real set,
  because `gen:phantom` writes under the names of real catalog studies.
- **Real public files.** These are the public data behind the catalog's
  other studies: CT, MRI, cardiac, spine, liver, tumour and structure
  files. They are for local testing only. Their licences vary and most are
  not verified, so they are never committed and never published. Without
  them, the worklist says which studies need real data.

`npm run samples:check` compares a directory with the manifest. It lists
each missing, short or changed file, with the command or source that fills
it. `npm run samples:manifest` rewrites the manifest after an intended
change.

### What production publishes

`deploy/up.sh` builds the production sample set in `/srv/carys/samples`
from two parts:

1. the synthetic set, generated there with `CARYS_SAMPLES_DIR`;
2. the real files whose licence is recorded as CC0: the OpenNeuro ds000001
   crops (`openneuro_ds000001_t1-crop.nii`, `openneuro_ds000001_bold-f0.nii`)
   and PDB 1CRN (`1crn.pdb`). Each is copied only if its SHA-256 matches the
   manifest.

No other real file is published. Adding one means first recording its
licence in a `SOURCES.json`, and the licence must be CC0 or CC BY 4.0.
