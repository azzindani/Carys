// Test-only: locate the sample volumes that some suites read.
//
// samples/ is 343MB of vendored imaging, gitignored and mounted rather than
// committed (see samples/.gitkeep). Tests that need it used to call
// readFileSync on it unguarded, so a clean clone — and the Docker build,
// whose .dockerignore drops samples/ — failed 20 tests that had nothing
// wrong with them. The few guarded suites did the opposite and returned
// early with a console.log, which node:test reports as a PASS: a skipped
// check wearing a green tick.
//
// Both are wrong in the same direction. A missing fixture is a skip, and it
// says so in the run's `# skipped` count. A fixture that is supposed to be
// there and isn't is a failure, which is what CARYS_REQUIRE_SAMPLES turns on
// for `npm run verify` — otherwise a half-populated samples/ would quietly
// skip real coverage and still look clean.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The samples root, resolved against the repo root the runner was started from. */
export const SAMPLES_DIR = join(process.cwd(), 'samples');

/** True when the run demands a complete fixture set (npm run verify). */
export function samplesRequired(): boolean {
  return process.env.CARYS_REQUIRE_SAMPLES === '1';
}

/**
 * Absolute path to a sample, or null when it is absent.
 * Throws instead of returning null when CARYS_REQUIRE_SAMPLES=1, so an
 * incomplete mount fails the run rather than thinning it out.
 */
export function sample(rel: string): string | null {
  const path = join(SAMPLES_DIR, rel);
  if (existsSync(path)) return path;
  if (samplesRequired()) {
    throw new Error(`CARYS_REQUIRE_SAMPLES=1 but samples/${rel} is missing`);
  }
  return null;
}

/**
 * node:test options that skip a test when its fixtures are absent.
 * Usage: `it('reads 1CRN', needs('1crn.pdb'), () => { ... })`
 */
export function needs(...rels: string[]): { skip?: string } {
  const missing = rels.filter((r) => !existsSync(join(SAMPLES_DIR, r)));
  if (missing.length === 0) return {};
  if (samplesRequired()) return {};
  return { skip: `needs samples/${missing.join(', samples/')}` };
}

/**
 * Names in samples/, or an empty list when the directory is absent.
 * The sweep suites enumerate the fixture set at module load; an unguarded
 * readdirSync there throws before a single test registers, which takes the
 * whole file down instead of skipping it.
 */
export function listSamples(pred?: (name: string) => boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(SAMPLES_DIR);
  } catch {
    // no samples/ mounted: an empty inventory, not an error (see `needsAny`)
    names = [];
  }
  return (pred ? names.filter(pred) : names).sort();
}

/**
 * node:test options that skip a whole sweep when its fixture kind is absent.
 * `what` names the kind for the skip message, e.g. 'NIfTI samples'.
 */
export function needsAny(what: string, found: readonly unknown[]): { skip?: string } {
  if (found.length > 0 || samplesRequired()) return {};
  return { skip: `needs samples/ (no ${what} found)` };
}
