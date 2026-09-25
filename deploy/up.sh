#!/bin/sh
# Carys production on this host: https://carys.casava.space through the
# shared Caddy router (/root/caddy-router), the arrangement Thoth uses.
# Run from anywhere; rerun to redeploy (the image is rebuilt, the sample set
# is kept).
#
#   sh deploy/up.sh
#
# 1. The sample set the site serves (CARYS_SAMPLES, default /srv/carys/samples):
#    the repo's synthetic phantoms, plus the real files whose licence the repo
#    records as CC0 (OpenNeuro ds000001 crops, digests/openneuro-ds000001) or
#    that the PDB publishes as CC0 (1CRN), each checked against its hash in
#    packages/testkit/samples.manifest.json. Every other real sample stays
#    unpublished: its licence is unverified, and the worklist says so.
# 2. The image (Dockerfile, which runs the gate in its build stage), then
#    `docker compose up` (project `carys`) on the `carys_edge` network.
# 3. Checks: health over loopback, then the site over its public name.
set -eu
cd "$(dirname "$0")/.."

SAMPLES="${CARYS_SAMPLES:-/srv/carys/samples}"
PORT="${CARYS_PORT:-8090}"
# published as-is: CC0 recorded in the repo (OpenNeuro) or by the PDB (1CRN)
CC0="openneuro_ds000001_t1-crop.nii openneuro_ds000001_bold-f0.nii 1crn.pdb"

if [ ! -d "$SAMPLES/ct-head-series" ]; then
  echo "== generating the synthetic sample set into $SAMPLES =="
  # the generators import the io writers
  npm run -s build
  for g in gen:samples gen:ometiff gen:tczyx gen:precomputed; do
    CARYS_SAMPLES_DIR="$SAMPLES" npm run -s "$g"
  done
fi
for f in $CC0; do
  [ -f "$SAMPLES/$f" ] && continue
  if [ ! -f "samples/$f" ]; then
    echo "note: samples/$f is not on this host; the site will say it needs real data"
    continue
  fi
  want=$(node -e "const m=require('./packages/testkit/samples.manifest.json');const e=m.files.find((x)=>x.path===process.argv[1]);process.stdout.write(e?e.sha256:'')" "$f")
  have=$(sha256sum "samples/$f" | cut -d' ' -f1)
  if [ "$want" != "$have" ]; then
    echo "samples/$f does not match its manifest hash; not publishing it" >&2
    exit 1
  fi
  cp "samples/$f" "$SAMPLES/$f"
done
# the container reads as nginx, not root
chmod -R a+rX "$SAMPLES"

echo "== building carys:prod =="
docker build -t carys:prod .

echo "== starting (project carys) =="
CARYS_SAMPLES="$SAMPLES" CARYS_PORT="$PORT" docker compose -f deploy/docker-compose.yml up -d --no-build

for i in $(seq 1 30); do
  curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$PORT/healthz" && break
  sleep 2
done
curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$PORT/healthz" || { echo "not healthy on :$PORT" >&2; docker logs carys-app-1 2>&1 | tail -20; exit 1; }
echo "healthy on 127.0.0.1:$PORT"

# The router must have joined carys_edge (docker network connect carys_edge
# caddy-router) and carry the carys.casava.space block; see README.
if curl -fsS -m 10 -o /dev/null https://carys.casava.space/healthz; then
  echo "LIVE: https://carys.casava.space/"
else
  echo "up locally, but https://carys.casava.space/healthz does not answer yet: check the router (README, Production)"
fi
