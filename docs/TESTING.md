# Testing

Rendering and parsing are pinned by unit tests. User flows are pinned by
browser suites. Architecture rules are pinned by checks over the source
tree. A suite that cannot run reports a **skip**, never a pass
([CODING-STANDARDS.md](CODING-STANDARDS.md) §29).

## Gates

| Command | When | What it runs |
|---|---|---|
| `npx tsc -b` (`npm run build`) | Every change | Compiles every package, tests included |
| `npm run ci` | Before every commit; CI on every push | `build` → `typecheck:app` → `lint` → `test:unit` → `test:markers` → `build:app` → `check:entry` → `audit:a11y` |
| `npm run verify` | Before a release, with a complete sample set | `samples:check` → `build` → every unit suite with `CARYS_REQUIRE_SAMPLES=1` → `test:e2e` |
| `npm run test:image` | CI on every push; after a deploy | The production image over HTTP and in Chromium ([DEPLOYMENT.md](DEPLOYMENT.md#verify-a-deployment)) |

These steps are part of `ci` as well:

- **`lint`** is ESLint with type-aware rules and `--max-warnings 0`.
- **`check:entry`** fails when the built entry chunk exceeds its byte
  budget, or when it contains a decoder's string literal. The viewer boots
  with NIfTI only, and every other format loads on first use.
- **`audit:a11y`** runs axe-core against WCAG 2.1 A and AA over the eight
  routes at desktop and mobile widths. It also runs a keyboard audit (a full
  Tab cycle with visible focus and no traps) and a reduced-motion audit.

On a shared or CPU-limited machine, run the heavy ones with `nice -n 10`,
one at a time.

## CI

`.github/workflows/ci.yml` runs three jobs on every push and pull request.

1. **gates** runs `npm run ci` on a runner with no sample set, so the
   suites that need fixtures skip, and it prints the skip count.
2. **synthetic** runs `npm run gen:samples`, then `test:synthetic`.
3. **image** builds the Dockerfile, which runs the sample-free gate in its
   build stage. It then:
   - starts the image locked down (read-only, tmpfs `/tmp`, no
     capabilities) and waits for Docker to report it healthy;
   - runs `test:image` against it, first open, then with an access key
     through the gate;
   - checks that a per-site `CARYS_CONNECT_SRC` lands in the CSP, and that
     a value carrying `;` stops the container.

The browser suites that need real imaging (`wire`, `journeys`, `geometry`)
are not in CI, because the real sample set is never committed. They run
locally under `npm run verify`.

## Unit suites

Every package has `src/test/*.test.ts`, compiled to `dist/test/` and run with
`node --test`. `npm run test:unit` runs them all. The main kinds are:

- **Golden hashes.** These pin render math: reslice, MIP, the raycaster,
  surfaces, shading, labels and picks. A change in output is a change in
  the hash, which is reviewed on purpose, never updated in passing.
- **Accuracy in millimetres.** Analytic phantoms (a sphere, an ellipsoid, a
  torus) sampled on isotropic and thick-slice grids score every surface
  path against the true surface for distance, volume and normals.
- **Hostile input.** `corrupt.test.ts` in `io` and in `render-cpu` feeds
  every format truncated and malformed bytes, and expects a named error. The
  DICOMweb multipart parser is fuzzed.
- **Data sets.** The digest tests check each file in `digests/` against the
  counts and pins recorded in its `SOURCES.json` and in `DIGESTS.json`.
- **Architecture.** `volume-core/src/test/verify.test.ts` checks four rules:
  - no source file over 700 lines;
  - no DOM globals in the engine packages;
  - no WebGL or three.js import anywhere;
  - every project a source header ports from is listed in
    [THIRD-PARTY.md](THIRD-PARTY.md).

### Fixtures: skip or fail

Tests that read `samples/` go through `@carys/testkit`, which decides what a
missing fixture means.

- By default the test **skips**, and the run's `# skipped` count says how
  many did. This is what CI and a fresh clone see.
- With `CARYS_REQUIRE_SAMPLES=1` (set by `npm run verify`), the test
  **fails**. A half-populated sample set therefore fails loudly instead of
  quietly thinning coverage.

`npm run samples:check` compares `samples/` with
`packages/testkit/samples.manifest.json`. For each missing or changed file,
it names what fills it ([DATA.md](DATA.md#the-sample-set)).

## Browser suites

Browser suites live in `test/e2e/`. They use Playwright with Chromium
(`npx playwright install chromium`). `CARYS_CHROMIUM` points them at another
Chromium binary instead. Most serve the repo root themselves, so run
`npm run build:app` first. Every suite fails loudly and prints `PASS` when it
passes.

| Script | Command | Proves |
|---|---|---|
| `smoke.mjs` | `test:e2e` | The legacy static shell loads and its modules resolve |
| `markers.mjs` | `test:markers` | Every id and selector the suites use exists in the markup |
| `undo.mjs` | `test:undo` | Protein selection, cell view state and the mask all undo through one shared stack |
| `wire.mjs` | `test:wire` | Every engine feature is reachable from the UI: formats, tools, pop-outs, exports |
| `synthetic.mjs` | `test:synthetic` | Boot, keyboard slicing, DICOM → 3D with the CT presets, and the worklist, using generated samples only. `CARYS_URL` points it at a deployment. |
| `journeys.mjs` | `test:journeys` | Whole tasks end to end, not just reachability |
| `geometry.mjs` | `test:geometry` | Radiological orientation, true proportions in millimetres, series grouping, and masks exported onto the source grid |
| `a11y.mjs` | `audit:a11y` | WCAG 2.1 A and AA, keyboard and reduced motion (uses `keyboard.mjs`) |
| `image.mjs` | `test:image` | The production image: the gate, headers, cache policy, MIME types and compression, then every route under the real CSP |
| `pacs-verify.mjs` | `test:pacs` | The DICOMweb path against a mock server: add an endpoint, search, pull a series into the viewer |

`test:e2e` chains `smoke`, `markers`, `undo`, `wire`, `synthetic`,
`journeys` and `geometry`. `popout.mjs` and `browser.mjs` are helpers the
suites share.

Three tools assert nothing and are for review only:

- `test:shots` saves screenshots of shell states;
- `audit:mobile` writes a touch-viewport report with screenshots;
- `demo` records videos of three flows.

## Fixtures

Every test input comes from one of four sources. A more realistic source
never silently replaces a simpler one: bit-exact fixtures stay bit-exact.

1. **Hand-rolled bytes.** `packages/*/src/test/fixtures*.ts` and the inline
   builders in the DICOM codec tests. These cover single-tag boundaries:
   - odd lengths and truncated sequences;
   - an empty basic offset table and bad offsets;
   - corrupt PackBits and truncated JPEG-LS streams.

   They are small enough to read, and every byte is intentional.
2. **Generated volumes.** `npm run gen:samples` and the other `gen:*`
   scripts write deterministic synthetic data with the repo's own writers
   ([DATA.md](DATA.md#the-sample-set)).
3. **The DICOM foundry.** `test/e2e/foundry.py` uses pydicom to write the
   committed files in `test/e2e/foundry/*.dcm`:
   - implicit VR and deflated transfer syntax;
   - ultrasound regions and tomosynthesis geometry;
   - real CharLS JPEG-LS streams and hand-packed RLE frames;
   - rescale phantoms.

   The UIDs are fixed and there are no timestamps, so
   `npm run gen:foundry` regenerates them byte for byte. This is tooling
   only: `packages/` never imports it. JPEG 2000 has no encoder here, so it
   stays unsupported.
4. **Pinned public data.** The data sets in `digests/` and the real files
   in a complete sample set, each pinned by hash or count.

The sources check each other:

- **`npm run xval`** reads every sample DICOM and every foundry file with
  both pydicom and Carys' parser, and fails on any disagreement over a tag
  or the geometry.
- **`npm run parity`** compares Carys' slice order and stack geometry with
  dcm2niix, and skips when dcm2niix is not installed.

These Python tools need `pydicom`. They are for local checks and are not
part of `ci`.
