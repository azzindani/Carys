# Deployment

Carys is static files. Production is one nginx container with no
application server, no database and no secrets baked in. This document
covers:

- the image;
- its configuration;
- the production site at carys.casava.space;
- running and checking it.

## The image

`Dockerfile` has two stages.

1. **build** (`node:20.20.2-alpine3.22`) runs `npm ci`, then the gate:
   `tsc -b`, lint, the unit suites, `typecheck:app` and the app build. A
   failing check fails the image build. `.dockerignore` drops `samples/`, so
   suites that need a fixture skip here and say so
   ([TESTING.md](TESTING.md)).
2. **serve** (`nginx:1.27.4-alpine3.21`) is what ships:
   - `deploy/nginx.conf` replaces the stock config;
   - `deploy/start.sh` is the entry point;
   - `deploy/gate.js` is the access gate;
   - the Vite bundle, `digests/`, `README.md` and `docs/THIRD-PARTY.md` make
     up the web root.

   The app's JS, CSS, SVG, JSON and HTML are pre-compressed at `gzip -9` for
   `gzip_static`.

What the container serves, all from one origin:

| Path | Content |
|---|---|
| `/` | 302 to `/packages/app/dist/` |
| `/packages/app/dist/` | The app. The Vite `base` is this path, so it cannot move without a rebuild. |
| `/digests/` | The data sets the app fetches at runtime: atlases, structures, motion, catalogs ([DATA.md](DATA.md)) |
| `/samples/` | The sample set, a read-only mount. It is empty and 404s when nothing is mounted. |
| `/README.md`, `/THIRD-PARTY.md` | The overview and the third-party notices |
| `/healthz` | `ok`, answered by nginx itself. Always public. |

How the container runs:

- It runs as the unprivileged `nginx` user and listens on **8080**. Binding
  below 1024 needs a capability that rootless runtimes and Kubernetes'
  restricted profile withhold.
- Every path nginx writes is under `/tmp`, and the web root is root-owned
  and read-only to the server. The container therefore runs with a read-only
  root filesystem, a tmpfs on `/tmp` and every capability dropped.

### Build and run

```bash
docker build -t carys .

# open, with the local sample set, locked down as production runs it
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --cap-drop ALL \
  -v "$PWD/samples:/usr/share/nginx/html/samples:ro" carys
# http://localhost:8080/
```

Each build runs the whole sample-free gate. On a shared host, run it with
`nice -n 10`.

## Configuration

The container reads two variables. The production scripts read three more.

| Variable | Read by | Meaning |
|---|---|---|
| `CARYS_ACCESS_KEY` | container (`start.sh`, `gate.js`) | Turns the access gate on. It must be 32 to 256 characters of `[A-Za-z0-9_-]`; `openssl rand -hex 32` makes one. When it is unset the site is open, which suits local runs and CI, and the container logs that it is open. The production compose file refuses to start without a key. |
| `CARYS_CONNECT_SRC` | container (`start.sh`) | The origins the app may fetch from, space-separated, e.g. `https://pacs.example.org https://*.s3.example.com`. Unset, any `https:` origin plus `http://localhost:*` and `http://127.0.0.1:*` is allowed. Every token is checked before nginx starts: a typo, or a `;` that would smuggle in a directive, stops the container with exit 64. A host left out is refused by the browser, and that includes the IDR stores the Cells catalog uses. |
| `CARYS_SAMPLES` | `deploy/up.sh`, compose | The host directory mounted read-only as `/samples/`. The default is `/srv/carys/samples`. |
| `CARYS_PORT` | `deploy/up.sh`, compose | The loopback port for host checks. The default is `8090`. |
| `CARYS_SAMPLES_DIR` | `npm run gen:*` | Where the sample generators write, instead of the repo's `samples/`. |

A PACS on plain `http://` elsewhere on the network needs its origin in
`CARYS_CONNECT_SRC`. If Carys itself is served over HTTPS, that PACS also
needs TLS: browsers block mixed content whatever the CSP allows.

## Production: carys.casava.space

```
browser ──https──▶ caddy-router (:80/:443, TLS, HSTS)      /root/caddy-router
                        │  network carys_edge
                        ▼
                   carys-app-1:8080 (nginx: gate, CSP, cache, compression)
                        │  read-only mount
                        ▼
                   /srv/carys/samples
```

- **The router** is the host's shared Caddy (`/root/caddy-router`, its own
  git repo). It serves every site on this machine and owns ports 80 and 443
  and TLS.
  - Carys is one site block. It proxies to `carys-app-1:8080`, adds HSTS, and
    removes the `token` query parameter from its access log.
  - The router reaches the container over the `carys_edge` network, which
    holds nothing else.
- **The app container** is `deploy/docker-compose.yml`, project `carys`,
  service `app`, container `carys-app-1`, image `carys:prod`.
  - It runs read-only, with a tmpfs `/tmp`, all capabilities dropped and
    `no-new-privileges`.
  - It is limited to one CPU and 256 MB.
  - It is published only on `127.0.0.1:8090`, for checks from the host.
  - Logs rotate at 10 MB × 5.
- **The sample set** is `/srv/carys/samples`. It holds the synthetic set,
  generated with `CARYS_SAMPLES_DIR`, plus only the real files whose licence
  is CC0: the OpenNeuro ds000001 crops and PDB 1CRN, each hash-checked
  against the samples manifest before it is copied. See [DATA.md](DATA.md).

### Deploy and redeploy

```bash
sh deploy/up.sh
```

The script is safe to rerun. It:

1. creates `deploy/.env` with a new `CARYS_ACCESS_KEY` on the first run,
   with mode 600 (the file is gitignored and dockerignored, and its contents
   are never printed);
2. generates the synthetic sample set into `CARYS_SAMPLES` if it is not
   there, then copies in the CC0 files after checking their hashes;
3. builds `carys:prod`, which runs the gate;
4. starts the container with `docker compose up -d --no-build`;
5. waits for `/healthz` on loopback, then checks the public name: `/healthz`
   must answer, and the app must refuse a caller with no key (401).

Redeploy after a change the same way. The image is rebuilt and the sample
set is kept.

### Access

The gate follows Thoth's token model and runs inside nginx through njs
(`deploy/gate.js`). [SECURITY.md](SECURITY.md) describes the design.

- **Browser:** open `https://carys.casava.space/?token=<key>` once. The
  response sets a signed session cookie and redirects to the same address
  without the token. The session lasts 30 days and is renewed on each page
  load.
- **Scripts:** send `Authorization: Bearer <key>`.
- **Without either,** the site answers with a 401 page and no password
  prompt. `/healthz` stays public.
- **Reading the key:** on the host, `cat deploy/.env`.
- **Rotating the key:** replace the value in `deploy/.env` (for example with
  `openssl rand -hex 32`) and rerun `sh deploy/up.sh`. Every existing session
  stops working, because its signature no longer verifies. Share the new
  `?token=` link again.

### Verify a deployment

The browser checks need Playwright's Chromium (`npx playwright install
chromium`). Export the key first:

```bash
set -a; . deploy/.env; set +a
CARYS_URL=https://carys.casava.space npm run test:image      # gate, headers, cache, types, every route under the CSP
CARYS_URL=https://carys.casava.space npm run test:synthetic  # boot, keyboard, DICOM→3D, worklist (logs in with ?token=)
```

`test:image` checks the gate's contract before anything else:

- the 401 page;
- the `?token=` login and its redirect;
- the cookie's signature and expiry;
- Bearer access.

It then repeats every check through the gate.

### Pause and resume

To pause and free the disk:

```bash
docker rm -f carys-app-1
docker image rm carys:prod
```

Use `docker rm`, not `docker compose down`. `down` would also try to remove
`carys_edge`, which the router is attached to.

While Carys is paused, the router answers 502 for carys.casava.space. Every
other site on the router is unaffected.

To resume, run `sh deploy/up.sh`. The key in `deploy/.env` and the sample
set in `/srv/carys/samples` survive a pause.

### Changing the router

Every site on this host goes through the router, so change it without
downtime:

1. Back up the file: `cp /root/caddy-router/Caddyfile
   /root/caddy-router/Caddyfile.bak.<date>`.
2. Edit it in place. The file is bind-mounted into the container, so an
   editor that saves a new file in its place leaves the router reading the
   old one.
3. Validate: `docker exec caddy-router caddy validate --config /etc/caddy/Caddyfile`.
4. Reload: `docker exec caddy-router caddy reload --config /etc/caddy/Caddyfile`.

Never restart or recreate the router container.

The router's compose file declares `carys_edge` as an external network, so
the network must exist whenever the router is recreated. If it is ever
deleted:

```bash
docker network create carys_edge
docker network connect carys_edge caddy-router
```

### Troubleshooting

| Symptom | Check |
|---|---|
| The site answers 502 | Is the container running (`docker ps --filter name=carys-app-1`)? Is the router on the network (`docker network inspect carys_edge`)? |
| The container exits at start | `docker logs carys-app-1`. `start.sh` names the bad `CARYS_CONNECT_SRC` token or the malformed key, and exits 64. |
| The right link returns 401 | The key was rotated and the link is old. Use the current key from `deploy/.env`. |
| A route shows a "reload" card after a redeploy | The tab holds an old `index.html` that names chunks the new image no longer has. Reloading fixes it. `index.html` is always revalidated, so a new tab never sees this. |
| `up.sh` stops with "does not match its manifest hash" | A real sample differs from the file the manifest recorded. It is not published until that is resolved ([DATA.md](DATA.md)). |

## Hosting elsewhere

Any static server can host Carys, provided it serves these from one origin,
at the same paths:

- `packages/app/dist/` (from `npm run build:app`);
- `digests/`;
- optionally, `samples/`.

`deploy/nginx.conf` is the reference for what such a server must add:

- the CSP and other security headers;
- MIME types for `.nii`, `.dcm`, `.nrrd`, `.mz3` and Zarr's dotfile
  metadata;
- the cache policy: hashed assets immutable, everything else revalidated.

The dev server (`npm run serve`, Python's `http.server`) sends none of these
headers, so it is for development only.
