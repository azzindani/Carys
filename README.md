# Carys — single CPU-only spatial viewer (prototype)

**Location:** this repository — nothing outside it.
**Rule for this prototype:** no GPU, no backend. Static TypeScript + Web Workers + WASM, served as static files (an nginx image in production). Live at **https://carys.casava.space** (see Production).

## Vision

One tool, one selection model, many loaders:

```
DICOM / NIfTI / OME-Zarr / PDB/mmCIF / FASTA / VCF  →  core volume/atom/cell model  →  CPU render  →  Canvas2D
```

Multimodal = features, not apps:
- voxel ↔ residue ↔ cell share one annotation model (mask + label + measurement)
- same brush, same undo, same export (NIfTI / STL / CSV / PNG / HTML report)
- sequence ↔ 3D highlight, channel ↔ cell table, baseline ↔ follow-up diff

## Why CPU-only

- Sandbox here has 4 vCPU, 15 GiB RAM, no GPU — so the prototype must run there.
- Clinical / field / classroom machines are the same: weak GPU, strong need.
- Proven: Papaya (pure JS orthogonal viewer), ITK-WASM (SIMD + thread pool, still CPU), tiled OME-Zarr slicing.

## Packages (monorepo under `packages/`)

```
packages/
  io/          DICOM series sort, NIfTI, OME-Zarr chunks, PDB/mmCIF, FASTA/VCF parsers
  volume-core/ dims/spacing/origin/dtype, spatial index, selection model
  render-cpu/  MPR reslice, MIP/minIP, software raycast, marching-cubes (WASM), tile slicer
  editor-seg/  threshold, region-grow, watershed, connected-components, brush + undo
  measure/     length, angle, volume, histogram, profile line
  testkit/     test-only: locates samples/ fixtures, decides skip vs fail
  ui/          4-pane layout, tracks, toolbar, report export (static only)
```

## Repos to digest (in order)

1. `rii-mango/Papaya + Daikon + NIFTI-Reader-JS` — CPU volume model to copy
2. `niivue/niivue + CACTAS` — NIfTI/mesh/overlay handling, drawing extension
3. `cornerstonejs/cornerstone3D + @itk-wasm/dicom` — `readImageDicomFileSeries`, tools
4. `Kitware/VolView` — architecture only (skip its GPU path)
5. `hms-dbmi/viv + vizarr` — OME-Zarr loader (replace deck.gl layer with CPU slicer)
6. `google/neuroglancer` — 4-pane linked navigation pattern
7. `molstar/molstar + pdbe-molstar + rcsb-molstar` — sequence→3D selection, superposition
8. `nglviewer/ngl` — simpler fallback reference for small proteins
9. `igvteam/igv.js + jbrowse-components + gosling.js` — genome tracks (Phase 2)

See `docs/` for architecture, CPU rendering recipe, phases, and tunnel preview.

## Run (dev)

```bash
npm run ci       # what CI runs: build + typecheck + lint + unit + markers + app build
npm run verify   # the full gate: adds e2e and REQUIRES samples/ (see below)
npm run lint     # eslint, type-aware; --max-warnings 0
npm run audit:a11y # axe-core WCAG 2.1 A/AA over every route, both breakpoints
npm run test:unit  # unit suites; fixture-backed ones skip without samples/
npm run gen:samples # synthetic volumes into samples/ — do this first on a fresh clone
npm run serve    # static root on :8000
# open http://localhost:8000/packages/app/dist/  (the app; run build:app first)
# legacy static shell: http://localhost:8000/packages/ui/
```

### Opening your own data

**Open** (beside the file tabs) or drag onto the viewer: NIfTI (`.nii`, `.nii.gz`), NRRD,
OME-TIFF, meshes (STL/MZ3/GIFTI), tracts (TCK/TRK/TRX) — and DICOM, by
content rather than extension, so an extensionless PACS export or CD folder
works. Drop a whole study folder: its files are grouped into the series they
really are (by Series UID, orientation and matrix), ordered by position, and
each opens as its own entry; a localizer never lands inside the axial stack.

What the viewer guarantees about geometry, and says on the image when it
cannot:

- **Orientation.** A volume whose file carries it (NIfTI qform/sform, DICOM
  Image Orientation/Position) is shown in radiological convention — patient
  right on screen left, anterior up, superior up — with R/L, A/P, S/I at the
  pane edges. Without it, the image is shown as stored, with no letters and
  an "orientation unknown" caution.
- **Proportions.** Reformats, the 3D surface and the volume render are drawn
  in millimetres, so thick-slice series are not squashed.
- **Honesty about stacks.** Non-contiguous slices, a tilted gantry and
  repeated positions (e.g. DCE phases) are flagged in amber on the viewport:
  reformats of those are approximate.
- **Round trips.** An exported mask `.nii` goes back onto the source file's
  grid with its affine, so it overlays the scan in ITK-SNAP, 3D Slicer or
  nibabel.

### Fixtures and what runs without them

`samples/` is ~343MB of vendored imaging, mounted rather than committed
(`samples/.gitkeep`) — 343MB does not belong in git and the privacy note
forbids patient data in the repo. A clean clone has none, so **run
`npm run gen:samples` first**: it writes synthetic phantoms with the repo's
own writers (a head CT as NIfTI *and* as a 120-slice DICOM series, plus
OME-Zarr cells and a plate) — enough to drive every route and the 3D
surface, with no patient data. Then:

- **`npm run ci` / `npm run test:unit`** — suites that need a fixture **skip**,
  and the run prints the skip count. Green here means green, not "nothing ran":
  a skip is reported as a skip, never as a pass.
- **`npm run test:geometry`** — the geometry guarantees above, on the real
  samples (part of `test:e2e`).
- **`npm run test:synthetic`** — the e2e legs that need only what
  `gen:samples` writes (boot, keyboard, DICOM→3D with the CT presets, the
  worklist's availability). CI runs it on every push after generating the
  set; it passes the same on the real one.
- **`npm run verify`** — sets `CARYS_REQUIRE_SAMPLES=1`, which turns a missing
  fixture into a **failure**. Use it before a release, with samples mounted; a
  half-populated `samples/` fails loudly instead of quietly thinning coverage.
- **`npm run samples:check`** (first step of `verify`) — compares `samples/`
  with `packages/testkit/samples.manifest.json`, which names every file of a
  complete set with its size and SHA-256, and lists everything missing, short
  or changed, each with the command or data source that fills it. After
  changing the set on purpose, `npm run samples:manifest` rewrites it.

`@carys/testkit` is the one place that decides which of the two you get.

## Run (production Docker)

```bash
docker build -t carys:latest .
docker run --rm -p 8080:8080 \
  -v /path/to/samples:/usr/share/nginx/html/samples:ro \
  carys:latest
# open http://localhost:8080/   (302 to the app at /packages/app/dist/)
```

Multi-stage image (pinned `node:20` build, `nginx:1.27` serve, non-root
`nginx` user, healthcheck on `/healthz`). The server listens on **8080**, not
80: a non-root process cannot bind below 1024 on runtimes that withhold that
capability. Every path nginx writes is under `/tmp`, so the container also
runs locked down:

```bash
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --cap-drop ALL \
  -v /path/to/samples:/usr/share/nginx/html/samples:ro carys:latest
```

Samples are never baked in — mount read-only. No GPU, no backend, no secrets
in the image, and no third-party requests: fonts are bundled, so the app runs
on an air-gapped network and no page view reaches Google. The image ships the
React app, `digests/` (Atlas, Learn and the pathogen structures fetch it) and
nothing else; the legacy static shell (`packages/ui`) is a dev page under
`npm run serve`.

`deploy/nginx.conf` is the whole server config: gzip (imaging included), a
cache policy (hashed assets immutable for a year, `index.html` always
revalidated, `samples/` private and short-lived), types for `.nii` `.dcm`
`.nrrd` `.mz3` and zarr metadata, and security headers. The CSP allows
scripts, styles, fonts and workers from the image's own origin only;
`connect-src` also allows any `https:` origin (plus `http://localhost` /
`127.0.0.1`) because the app opens OME-Zarr stores and DICOMweb endpoints the
user types in. A site that can name its hosts narrows it at start-up:

```bash
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --cap-drop ALL \
  -e CARYS_CONNECT_SRC="https://pacs.example.org https://*.s3.example.com" carys:latest
```

`deploy/start.sh` checks every token (a scheme such as `https:`, or an origin
with an optional `*.` subdomain, port and path) and refuses to start on
anything else, so a typo cannot ship a broken policy and a `;` cannot smuggle
a directive in. Hosts left out are refused by the browser, the Cells
catalog's IDR stores included. A PACS on plain `http://` elsewhere on the LAN
goes in the same list — `deploy/nginx.conf` explains the trade.

The build layer runs `tsc -b`, lint, the unit suites, `typecheck:app` and the
app build, all without `samples/` (`.dockerignore` drops it). CI builds the
image on every push, then runs it and points `npm run test:image` at it:
headers, cache and compression over HTTP, then Chromium boots the app and
visits every route under the real CSP. The image used to build green and exit
at start-up, because nothing ever ran it.

## Production (carys.casava.space)

This host serves Carys at **https://carys.casava.space**, behind the shared
Caddy router in `/root/caddy-router` (repo `Caddy_Router`), which owns :80,
:443 and TLS. It's the same arrangement as Thoth:

```bash
sh deploy/up.sh    # sample set, image, compose up, health + public check
```

- `deploy/docker-compose.yml` (project `carys`) runs one container,
  `carys-app-1`, from `carys:prod`. It runs locked down: read-only root,
  tmpfs `/tmp`, all capabilities dropped, no-new-privileges, one CPU and
  256 MB. Its only network is `carys_edge`. The router joins that network
  and proxies `carys.casava.space` to `carys-app-1:8080`, adding HSTS.
  nginx owns everything else: CSP, cache policy, compression. The loopback
  port `127.0.0.1:8090` is for host checks.
- The site is public on purpose. It has no backend and no secrets, and
  uploads never leave the browser.
- The sample set is `/srv/carys/samples` (`CARYS_SAMPLES`), mounted
  read-only. It holds the synthetic phantoms, generated there with
  `CARYS_SAMPLES_DIR`, so a real `samples/` is never written over. It also
  holds the real files whose licence is known to be CC0: the OpenNeuro
  ds000001 crops and PDB 1CRN, each checked against its hash in the samples
  manifest before copying. No other real sample is published, because its
  licence is unverified; the worklist says "needs real data" for those.
- Redeploy after a change with `sh deploy/up.sh`: it rebuilds the image,
  which re-runs the gate, and keeps the sample set.
- Check the live site with
  `CARYS_URL=https://carys.casava.space npm run test:image` (headers, types,
  every route under the CSP) and
  `CARYS_URL=https://carys.casava.space npm run test:synthetic` (boot,
  keyboard, DICOM→3D, worklist).
- The router side is one site block in `/root/caddy-router/Caddyfile` plus
  `carys_edge` in its compose networks. If the network is ever deleted,
  reattach it without restarting the router:
  `docker network connect carys_edge caddy-router`.

## Privacy note

Default dev model here (`muse-spark-1.3-contributor`) trains on prompts. Prototype with mock / public data (e.g. OpenNeuro, PDB 4HHB, OME-NGFF samples). No patient data, rotate any keys after.
