# Preview without Docker — static server + Cloudflare quick tunnel

This prototype is static files only. Serve the built `ui/` (or a demo HTML) and expose it with a Cloudflare quick tunnel. Nothing to install server-side, no image to build.

## 1. Serve locally (pick one, in `data/carys`)

```bash
# repo root (REQUIRED — pages import /packages/*/dist + /samples by absolute path)
npm run serve:root   # python3 -m http.server 8000 --directory .
```

Pages: `/packages/ui/slice.html` (MPR + paint), `/packages/ui/surface.html`
(3D orbit). `npm run serve` (old, serves `packages/ui` only) does NOT work
for these pages — imports resolve to 404.

Check: `curl -I http://localhost:8000/README.md` should return 200.

## 2. Open a quick tunnel (no account, no Docker)

```bash
# download once
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
chmod +x /tmp/cloudflared
# expose port 8000; you get a https://*.trycloudflare.com URL in the log
/tmp/cloudflared tunnel --url http://localhost:8000
```

Open the printed `https://<random>.trycloudflare.com` on your machine. That URL serves exactly what is in `data/carys/` — share screenshots, not patient data.

## 3. Sandbox notes (this container)

- 4 vCPU, ~7.5 GiB RAM free, 33 GiB disk free, no GPU — keep test volumes small (<200 MB).
- Swap is nearly full: run one thing at a time (server OR build, not both + tunnel at max load).
- Tunnel dies with the sandbox. For a stable URL later, use `cloudflared tunnel login` + named tunnel on your own machine — out of scope here.
- If the tunnel is slow, lower test data resolution first; the bottleneck is upload from here, not render.

## 4. What NOT to do here

- No `docker build / docker run` for this prototype (your call).
- No GPU inference (Fish Audio etc.) here — API/UI mocks only; inference lives on a GPU box.
- No real patient / secret data through the tunnel (contributor-tier model + public URL).
