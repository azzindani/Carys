// Where the sample generators write: <repo>/samples, or CARYS_SAMPLES_DIR.
// The override exists because the phantoms reuse the catalog's real file
// names, so generating into the repo's samples/ over a real set destroys it;
// a deployment or a scratch check generates into a directory of its own.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function samplesDir(root) {
  const dir = process.env.CARYS_SAMPLES_DIR ? resolve(process.env.CARYS_SAMPLES_DIR) : join(root, 'samples');
  mkdirSync(dir, { recursive: true });
  return dir;
}
