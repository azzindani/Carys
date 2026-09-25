# Carys — static production image (no GPU, no backend, no secrets).
# Stage 1 builds TypeScript; stage 2 serves static files via nginx.
# Samples are NOT baked in (343MB+): mount at /usr/share/nginx/html/samples.
# Server config (gzip, cache policy, CSP and friends): deploy/nginx.conf.
#
#   docker build -t carys:latest .
#   docker run --rm -p 8080:8080 \
#     -v /path/to/samples:/usr/share/nginx/html/samples:ro \
#     -e CARYS_CONNECT_SRC="https://pacs.example.org" \
#     carys:latest
#   (CARYS_CONNECT_SRC is optional: the hosts the app may fetch from; unset,
#   any https origin plus loopback — deploy/start.sh)
#   open http://localhost:8080/  (302 to the React app)

ARG NODE_TAG=20.20.2-alpine3.22
ARG NGINX_TAG=1.27.4-alpine3.21

FROM node:${NODE_TAG} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/testkit/package.json packages/testkit/
COPY packages/volume-core/package.json packages/volume-core/
COPY packages/io/package.json packages/io/
COPY packages/measure/package.json packages/measure/
COPY packages/render-cpu/package.json packages/render-cpu/
COPY packages/editor-seg/package.json packages/editor-seg/
COPY packages/study/package.json packages/study/
COPY packages/dicomweb/package.json packages/dicomweb/
COPY packages/app/package.json packages/app/
COPY packages/ui/package.json packages/ui/
RUN npm ci --no-audit --no-fund
COPY packages/ ./packages/
COPY eslint.config.js ./
# Committed inputs the gate reads and the build context was missing: the
# provenance registry (digests/ + DIGESTS.json), the third-party notices the
# architecture test checks source headers against (docs/THIRD-PARTY.md), and
# the hand-packed DICOM foundry frames (test/e2e/foundry). ~15MB. Of these,
# digests/ reaches the serve stage because the app fetches it at runtime, and
# the notices because they ship with the code they cover (below). These are repo content,
# always present in a checkout, not the mounted samples/ fixtures.
COPY DIGESTS.json ./
COPY digests/ ./digests/
COPY docs/ ./docs/
COPY test/e2e/foundry/ ./test/e2e/foundry/
# Sample-free gate. .dockerignore drops samples/, so anything that reads a
# fixture must skip rather than fail here: `@carys/testkit` decides, and the
# run reports the skips. (This claimed to be hermetic before it was — 20 tests
# read samples/ unguarded and 29 more read committed inputs the context never
# carried, so this layer could not build from a clean tree.)
# The full fixture set is `npm run verify`, which sets CARYS_REQUIRE_SAMPLES=1.
RUN npx tsc -b && npm run lint && npm run test:unit && npm run typecheck:app && npm run build:app

FROM nginx:${NGINX_TAG} AS serve
# The whole server config, replacing the stock one rather than adding a
# conf.d file: the stock nginx.conf is what put the pid and temp files where
# a non-root user cannot write (see the header of deploy/nginx.conf).
COPY deploy/nginx.conf /etc/nginx/nginx.conf
# Renders the per-site connect-src (CARYS_CONNECT_SRC) into /tmp, the one
# writable path, then execs nginx; nginx.conf includes what it wrote.
COPY deploy/start.sh /usr/local/bin/carys-start
# The njs access gate nginx.conf imports (off unless CARYS_ACCESS_KEY is set).
COPY deploy/gate.js /etc/nginx/carys-gate.js
# The base image's own site goes too: its "Welcome to nginx!" page would
# still answer /index.html, announcing the server to anyone who asks.
RUN rm /etc/nginx/conf.d/default.conf /usr/share/nginx/html/index.html /usr/share/nginx/html/50x.html \
 && chmod 0555 /usr/local/bin/carys-start
# The React app is the whole product: Vite bundles every package it uses, so
# the per-package tsc builds are not shipped. The legacy static shell
# (packages/ui) used to be, and never worked here: its import map points at
# /node_modules/, which no image holds, so all three of its pages died on
# their first module. It also runs only on inline script, which would mean a
# second, 'unsafe-inline' CSP on the same origin as the app and its saved PACS
# endpoints. It stays a dev page (`npm run serve`) and an e2e fixture.
COPY --from=build /app/packages/app/dist /usr/share/nginx/html/packages/app/dist
# Atlas, Learn and the pathogen structures fetch /digests/... at runtime. The
# image used to leave it out, so those routes would 404 on every mesh and term
# table in production; dev serves the whole repo root, which hid it.
COPY --from=build /app/digests /usr/share/nginx/html/digests
COPY README.md /usr/share/nginx/html/
# The licences of the bundled packages, fonts and ported code travel with it.
COPY docs/THIRD-PARTY.md /usr/share/nginx/html/
# Compress the app once, at -9, for gzip_static; nginx gzips anything else on
# the fly. Each .gz is written in the same layer as its source and nothing
# writes the web root afterwards, so the two cannot drift.
# The web root stays root-owned: the server only reads it, and a compromised
# worker should not be able to rewrite the app it serves. samples/ is created
# as the mount point, so an unmounted run 404s cleanly.
RUN find /usr/share/nginx/html/packages/app/dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' -o -name '*.html' \) \
      -size +1k -exec gzip -9 -k {} + \
 && mkdir -p /usr/share/nginx/html/samples
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# The base image's entrypoint runs a non-nginx command as given.
CMD ["/usr/local/bin/carys-start"]
