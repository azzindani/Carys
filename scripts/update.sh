#!/usr/bin/env bash
# Carys update: rebuild + restart the static server, KEEP the tunnel.
# Same public URL, fresh bits. Logs in .deploy/.
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-8000}"
mkdir -p .deploy

if [ ! -f LIVE_URL.txt ]; then
  echo "no LIVE_URL.txt — run npm run deploy first"
  exit 1
fi
if ! pgrep -f "cloudflared tunnel --url http://localhost:${PORT}" >/dev/null; then
  echo "tunnel is dead — run npm run deploy for a fresh URL"
  exit 1
fi

echo "==> rebuilding engine + app"
npm run build >/dev/null 2>&1 || { echo "engine build FAILED"; exit 1; }
npm run build:app >/dev/null 2>&1 || { echo "app build FAILED"; exit 1; }

echo "==> restarting static server (:${PORT}), tunnel untouched"
pkill -f "http.server ${PORT} --directory ." 2>/dev/null || true
sleep 1
nohup python3 -m http.server "${PORT}" --directory . > .deploy/server.log 2>&1 &
sleep 2
curl -sf "http://localhost:${PORT}/" -o /dev/null || { echo "server did not come up"; exit 1; }

echo "LIVE (unchanged): $(cat LIVE_URL.txt)"
