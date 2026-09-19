import { spawn } from 'node:child_process';
const server = spawn('python3', ['-m', 'http.server', '8130', '--directory', '.'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const BASE = `http://localhost:8130/packages/app/dist/index.html`;
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /^\d+ \/ \d+/.test(document.getElementById('ro-axial')?.textContent ?? ''), null, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 8000));
  const { readFileSync } = await import('node:fs');
  const b64 = readFileSync('/tmp/wire-us.dcm').toString('base64');
  // monkeypatch Worker to capture the parse worker's reply for the US upload
  await page.evaluate(() => {
    window.__replies = [];
    const Orig = window.Worker;
    window.Worker = function (url, opts) {
      const w = new Orig(url, opts);
      w.addEventListener('message', (e) => {
        window.__replies.push(JSON.stringify(e.data).slice(0, 200));
      });
      return w;
    };
    window.Worker.prototype = Orig.prototype;
  });
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'wire-us.dcm', { type: 'application/dicom' });
    const input = document.querySelector('input#upload');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, b64);
  await new Promise((r) => setTimeout(r, 5000));
  console.log('REPLIES:', await page.evaluate(() => JSON.stringify(window.__replies.slice(0, 4))));
  console.log('STATUS:', (await page.locator('#status-text').textContent()).slice(0, 100));
  await browser.close();
} catch (e) { console.log('ERR:', String(e).slice(0, 500)); }
server.kill(); process.exit(0);
