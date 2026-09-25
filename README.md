# Carys

Carys is a medical and life-science imaging viewer that runs entirely in the
browser, on the CPU. It needs no GPU, no WebGL and no server-side code: the
production build is static files behind nginx. Scans, structures and cell
images open in the tab and stay there. Nothing a user opens is uploaded.

> **For education and research. Not for diagnosis or any other clinical
> use.** Carys has no regulatory clearance. Its measurements and renderings
> are there to learn and explore with.

Production: **https://carys.casava.space**. The site is token-gated and
currently paused. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) explains how to
resume and access it.

## What it does

The rail on the left has one route per task. Every route shares one data
model, so a selection, mask or measurement made in one view means the same
thing in the others.

| Route | What it is for |
|---|---|
| **Studies** | The worklist: the bundled studies, each showing whether its data is present, plus a DICOMweb client (QIDO search, then pull a series into the viewer). |
| **Viewer** | Axial, coronal and sagittal reformats with a 3D view: surface or volume render, cinematic lighting, clipping and a curved reformat. Segmentation (threshold, region grow, brush, flood fill, watershed split, fill between slices), measurements, compare and time series. Exports a NIfTI mask, STL, PNG or CSV. |
| **Report** | Validation checks and an HTML report of the study, its measurements and its data sources. |
| **Protein** | PDB and mmCIF structures: residue queries, ligand pockets, interface contacts, pLDDT colouring for predicted models, pathogen teaching structures, and whole virus capsids built from their biological assemblies. |
| **Cells** | OME-Zarr and OME-TIFF microscopy: channel compositing, plates and wells, per-channel statistics, and a catalog of public IDR screens. |
| **Tracks** | Genome tracks (FASTA, VCF, BED, GFF/GTF) with a locus search and filter. |
| **Atlas** | Brain region labels, and a whole-body atlas of 2,234 BodyParts3D structures by body system, with see-through layers, a posable skeleton, walking and running motion, and HuBMAP reference organs placed in the body. |
| **Learn** | Mechanism-of-disease bundles and a microbiology library whose structures open in Protein. |

### Opening your own data

Use **Open** beside the file tabs, or drop files onto the viewer.

- **Volumes:** NIfTI (`.nii`, `.nii.gz`), NRRD and OME-TIFF.
- **DICOM:** recognised by content, not extension, so an extensionless PACS
  export or a CD folder works. Dropping a whole study folder groups its files
  into their series by Series UID, orientation and matrix, orders each series
  by position, and opens each as its own entry. A localizer never lands in
  the axial stack.
  - Supported transfer syntaxes: implicit and explicit VR (little and big
    endian), deflated, RLE, JPEG Baseline 8-bit, JPEG Lossless (SOF3) and
    JPEG-LS lossless.
  - Anything else (JPEG 2000, JPEG-LS near-lossless, 12-bit baseline) is
    refused with a named error, not drawn wrong.
  - SEG and RTSTRUCT import as masks. DICOMDIR opens as an index.
- **Surfaces and tracts:** meshes (STL, MZ3, GIFTI) and tractography (TCK,
  TRK, TRX).
- **Other data:** structures open in Protein and sequence tracks in Tracks.
  OME-Zarr opens from a URL in Cells.

What the viewer guarantees about geometry, and what it says on the image when
it cannot:

- **Orientation.** A volume whose file records its orientation (NIfTI
  qform/sform, DICOM Image Orientation/Position) is shown in radiological
  convention: patient right on screen left, anterior up and superior up, with
  R/L, A/P and S/I at the pane edges. A volume without one is shown as stored,
  with no letters and an "orientation unknown" caution.
- **Proportions.** Reformats, the 3D surface and the volume render are drawn
  in millimetres, so thick-slice series are not squashed.
- **Honesty about stacks.** Non-contiguous slices, a tilted gantry and
  repeated positions (DCE phases, for example) are flagged in amber on the
  viewport. Reformats of those stacks are approximate.
- **Round trips.** An exported mask `.nii` goes back onto the source file's
  grid with its affine, so it overlays the scan in ITK-SNAP, 3D Slicer or
  nibabel.

## Run it

Requirements: Node 20, npm, and Python 3 for the local static server.

```bash
npm ci
npm run build        # compile the packages (the sample generators use them)
npm run gen:samples  # synthetic volumes into samples/: no patient data
npm run build:app    # the app bundle, packages/app/dist/
npm run serve        # the repo root on http://localhost:8000
```

Open http://localhost:8000/ (it redirects to the app). A fresh clone has no
imaging. `gen:samples` writes enough to drive every route:
- a head CT phantom as NIfTI and as a 120-slice DICOM series;
- OME-Zarr cells;
- a plate.

Studies that need real public data say so in the worklist.

To run the production container locally:

```bash
docker build -t carys .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --cap-drop ALL \
  -v "$PWD/samples:/usr/share/nginx/html/samples:ro" carys
```

Docker deployment, the access gate, the shared-router setup and operations
are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Packages, the data model, rendering on the CPU, the app shell and how it is served |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | The image, production at carys.casava.space, configuration, access keys, operations |
| [SECURITY.md](docs/SECURITY.md) | Threat model, CSP and headers, the access gate, container hardening, privacy |
| [DATA.md](docs/DATA.md) | Data licensing policy, the shipped data sets, the sample set and its manifest |
| [TESTING.md](docs/TESTING.md) | The gates, CI, unit and browser suites, fixtures |
| [CODING-STANDARDS.md](docs/CODING-STANDARDS.md) | The rules every change follows, and the checks that enforce them |
| [THIRD-PARTY.md](docs/THIRD-PARTY.md) | Bundled packages, fonts and ported code, with their licences |

## Privacy

- Files a user opens are read in the browser and never sent anywhere. The
  only outbound requests go to addresses the user types in: an OME-Zarr store
  or a DICOMweb endpoint.
- The app makes no third-party requests of its own. Fonts are bundled, and
  there are no analytics or trackers.
- The repository holds no patient data. Its sample volumes are synthetic,
  and each public data set it ships is listed with its licence in
  [docs/DATA.md](docs/DATA.md).
- Do not put patient data into issues, fixtures or commits.

## Licence

MIT, © 2026 azzindani ([LICENSE](LICENSE)). Bundled packages, fonts and code
ported from other projects keep their own licences, listed in
[docs/THIRD-PARTY.md](docs/THIRD-PARTY.md). Each data set's licence and
attribution is in [docs/DATA.md](docs/DATA.md) and the `SOURCES.json` beside
it.
