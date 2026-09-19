#!/usr/bin/env bash
# Carys deploy: build everything, serve repo root on :8000, expose via
# Cloudflare quick tunnel, record the public URL in LIVE_URL.txt.
# Idempotent: kills previous server/tunnel first. Logs in .deploy/.
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-8000}"
mkdir -p .deploy

echo "==> building engine + app"
npm run build >/dev/null 2>&1 || { echo "engine build FAILED"; exit 1; }
npm run build:app >/dev/null 2>&1 || { echo "app build FAILED"; exit 1; }

echo "==> restarting static server (:${PORT})"
pkill -f "http.server ${PORT} --directory ." 2>/dev/null || true
sleep 1
nohup python3 -m http.server "${PORT}" --directory . > .deploy/server.log 2>&1 &
sleep 2
curl -sf "http://localhost:${PORT}/" -o /dev/null || { echo "server did not come up"; exit 1; }

echo "==> restarting tunnel"
pkill -f "cloudflared tunnel --url http://localhost:${PORT}" 2>/dev/null || true
sleep 1
nohup cloudflared tunnel --url "http://localhost:${PORT}" > .deploy/tunnel.log 2>&1 &
for i in $(seq 1 30); do
  URL=$(grep -oE "https://[a-z0-9-]+\\.trycloudflare\\.com" .deploy/tunnel.log 2>/dev/null | head -1)
  if [ -n "${URL}" ]; then
    echo "${URL}" > LIVE_URL.txt
    echo "LIVE: ${URL}"
    exit 0
  fi
  sleep 2
done
echo "tunnel did not come up; see .deploy/tunnel.log"
exit 1
