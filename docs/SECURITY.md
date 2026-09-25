# Security

Carys has no application server, database, user accounts or upload
endpoint. Production is nginx serving static files. The attack surface is:

- the browser app and the files it parses;
- the HTTP headers that constrain it;
- the access gate;
- the container.

## Threat model

| Asset | Threat | Defence |
|---|---|---|
| Data a user opens (possibly identifiable scans) | Leaves the browser | Files are read with the File API and parsed in the tab or a worker. Nothing is uploaded, and the app makes no third-party requests of its own. The CSP limits where scripts may connect. |
| The user's session in the app | Script injection through a crafted file or URL | A strict CSP: scripts from the site's own origin only, with no inline script, `eval` or `new Function`. Parsers treat every file as hostile and fail with named errors. |
| The deployment | Access without a key | The access gate below. `/healthz` is the only public path. |
| The access key | Leaking through logs, referrers or the address bar | The login redirect strips the token. Neither log records it. `Referrer-Policy: no-referrer`. |
| The host | A compromised nginx worker | The worker runs as non-root on a read-only filesystem, with no capabilities, on a network of its own, under CPU and memory limits. |

Carys is for education and research. It is not a clinical system and does
not claim the controls one needs, such as per-user identity, audit, or
access by role.

## In the browser

- **Hostile input.** Every decoder maps malformed or hostile bytes to a
  named error rather than a crash or an out-of-range read. `corrupt.test.ts`
  in `io` and in `render-cpu` proves this for every format, and the DICOMweb
  multipart parser is fuzzed (`dicomweb/src/test/fuzz.test.ts`).
- **No code from data.** The bundle contains no `eval`, no `new Function`,
  no WebAssembly and no inline script. That is why the CSP needs no
  `'unsafe-*'` source.
- **Storage.** `localStorage` keeps only two things: appearance preferences,
  and saved DICOMweb endpoints (a name and a base URL, with no credentials).
  Opened files, masks and measurements live in memory for the session.
- **De-identification.** The worklist can export a series with the DICOM
  PS3.15 Basic Application Confidentiality Profile applied (identity tags
  replaced or removed, UIDs re-rooted). Its tag table covers the profile's
  main identity tags, not every private tag. Review the output before
  sharing it.

## HTTP headers

`deploy/nginx.conf` sets these on every response, errors included, and
explains each one in place.

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' <sites>; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |

`connect-src` is the one relaxation. The app fetches stores the user types
in (OME-Zarr URLs, DICOMweb endpoints, the IDR mirrors), whose hosts cannot
be known at build time. By default it allows any `https:` origin plus
loopback. A site that can name its hosts sets `CARYS_CONNECT_SRC` and gets
exactly those ([DEPLOYMENT.md](DEPLOYMENT.md)). With the default,
`script-src` is the barrier: it lets no injected code run in the first
place.

TLS, HSTS and `upgrade-insecure-requests` belong to the proxy in front. In
production, Caddy terminates TLS and sends
`Strict-Transport-Security: max-age=31536000; includeSubDomains`.

`npm run test:image` loads every route in Chromium under the real headers
and fails on any CSP violation. CI runs it against the built image on every
push.

## Access gate

The gate is `deploy/gate.js`, run by nginx through njs. It follows Thoth's
token model. It is off unless `CARYS_ACCESS_KEY` is set, and the production
compose file will not start without a key.

- **Login.** `?token=<key>` is compared in constant time. A match gets a
  302 (`Cache-Control: no-store`) to the same URL without the token, and a
  session cookie. A wrong token gets a 401 rather than being ignored.
- **Session.** The cookie is `carys_session=<exp>.<sig>`, where `sig` is
  HMAC-SHA256 over `carys-session.<exp>` keyed with the access key. It is
  set with `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, and `Secure`
  when the proxy reports HTTPS. It expires after 30 days and is renewed on
  each page load, not on each asset.
- **Scripts.** `Authorization: Bearer <key>` passes without setting a
  cookie.
- **Refusal.** Any other request gets a plain 401 page. It sends no
  `WWW-Authenticate` header, because a browser password prompt could never
  accept a token. `/healthz` is exempt.
- **Revocation** is key rotation: a new key invalidates every session at
  once, because the old signatures no longer verify.

Limits, stated plainly:

- **There is one shared key.** The gate has no per-user identity, so it
  cannot say who accessed what. Revoking one person means rotating the key
  for everyone.
- **Sessions are stateless.** A stolen cookie is valid until it expires or
  the key is rotated.
- **Treat a login link like a password.** The redirect removes it from the
  address bar, but it can remain in browser history or wherever it was
  pasted.
- **Guessing is not rate-limited.** It is also infeasible: `deploy/up.sh`
  generates a 256-bit random key, and `start.sh` refuses any key shorter
  than 32 characters.

## Logs

- The nginx access log records `$uri`, the path without its query string,
  so a `?token=` login never reaches it. Headers, including
  `Authorization`, are not logged.
- The Caddy site block deletes the `token` query parameter from the
  router's access log.
- `/healthz` is not logged. Container logs rotate at 10 MB × 5.

## Container

- nginx runs as the unprivileged `nginx` user on port 8080.
- The root filesystem is read-only, with a tmpfs on `/tmp`. All
  capabilities are dropped and `no-new-privileges` is set. The container is
  limited to one CPU and 256 MB.
- The web root is root-owned, so a compromised worker cannot rewrite the
  app it serves.
- The stock nginx site and its welcome pages are removed, and
  `server_tokens` is off.
- The sample set is mounted read-only. `/samples/` is sent as
  `Cache-Control: private` so shared caches do not keep volumes.
- Network exposure is limited. The container's only network is
  `carys_edge`, shared with the router alone, and its published port is
  bound to `127.0.0.1`.
- The image holds no secrets. The key arrives as an environment variable at
  run time.

## Secrets

The deployment has one secret: `CARYS_ACCESS_KEY` in `deploy/.env`.

- The file has mode 600. It is listed in `.gitignore`, and also in
  `.dockerignore`, so it never enters a build context.
- `deploy/up.sh` creates the key and never prints it.
- Rotation is described in [DEPLOYMENT.md](DEPLOYMENT.md#access).

## Dependencies

- The browser bundle has three runtime dependencies: React, the Radix
  Popover and Tooltip primitives, and fflate ([THIRD-PARTY.md](THIRD-PARTY.md)).
- Every asset, fonts included, is served from the site's own origin. The
  app loads nothing from a CDN.
- Installs run `npm ci` from the committed lockfile, and the Node and nginx
  base images are pinned by tag.

## Reporting a vulnerability

Report a suspected vulnerability privately to the repository owner
(`azzindani` on GitHub), not in a public issue. Include the affected path
or file and the steps to reproduce it.
