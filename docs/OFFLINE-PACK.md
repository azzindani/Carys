# F1 offline teaching pack: run the viewer from file:// with zero backend

The static bundle already needs no server for pixels it holds (vendored
digests + samples ship as files). This page lists what works offline, what
does not, and the one-command pack that proves it.

## What works from file:// today

- Atlas (47 BodyParts3D meshes + FMA terms + brain labels): all vendored
  under `digests/` + `packages/app/dist`, fetched by relative URL.
- Learn (bundles, plane drills, measurement trainer, K4 self-test): pure
  engine + vendored tables, no network.
- Report + teaching sheets + sidecars: downloads via Blob URLs (no server).
- Samples under `samples/` (NIfTI, DICOM, zarr demo stores): relative fetch.

## What needs network (loud, never silent)

- IDR screens (EBI bucket zarr mirrors): remote by design; the catalog
  names the codec + the open path fails loud offline.
- PACS panel: no backend in the static prototype by scope.
- `serve` / tunnel deploy: convenience only, not a dependency.

## Build the pack (one command, verified 2026-09-17)

```
npm run build && npm run build:app
python3 -c "import shutil,pathlib; ..."
```

Artifacts: `packages/app/dist/` (the bundle) + `digests/` (vendored
knowledge) + `samples/` (pixels) + `DIGESTS.json` (registry). Copy those
four onto any static host (or open `packages/app/dist/index.html` from
`file://`) — the Learn + Atlas + Report flows run with no backend.

## Provenance in the pack

`DIGESTS.json` (X1 registry) + per-digest `SOURCES.json` + the report
attribution table (X4) travel with the pack, so the offline copy carries
the same license story as the repo.
