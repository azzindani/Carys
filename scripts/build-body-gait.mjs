// The gait motions digest: a mean walking and a mean
// running cycle from two CC BY 4.0 gait data sets, written as BVH for the
// H5 rig to play.
//
//   npx tsc -b && node scripts/build-body-gait.mjs   → digests/gait-motions/
//
// Sources (figshare, CC BY 4.0, pinned versions): Fukuchi, Fukuchi & Duarte,
// "A public data set of running biomechanics…" (2017, 10.6084/m9.figshare.
// 4543435.v5): treadmill running at 3.5 m/s; and "A public data set of
// overground and treadmill walking kinematics and kinetics of healthy
// individuals" (2018, 10.6084/m9.figshare.5722711.v6): treadmill walking
// at each subject's comfortable speed (trial T05). Downloads cache in
// .cache/gait (gitignored); the walking archive's members are read by byte
// range, not the 690 MB zip. Deterministic.
//
// Each subject's hip, knee and ankle angles over a gait cycle (0–100%, the
// right heel strike to the next, each side to its own) are averaged across
// subjects. The data follow the ISB axes: Z flexion (hip and knee flexion,
// ankle dorsiflexion positive), X adduction, Y internal rotation. Kept:
// flexion of all three and the hip's ab/adduction; the rotations carry
// marker offsets of up to 25° (the knee's Y sits near −22° all cycle) and
// are left out, as are the pelvis and the upper body (not in the data).
// The cycle's duration and the left side's phase come from the marker
// trials of MARKER_SUBJECTS subjects (the heel's fore-aft swing on the
// treadmill); a foot is in contact where its vertical ground force is over
// CONTACT_N_PER_KG.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import {
  footSlip, groundRoot, parseBvh, plantRoot, retargetFrame, solePoints, unpackBody, writeBvh,
} from '../packages/render-cpu/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'gait');
const OUT = join(ROOT, 'digests', 'gait-motions');
const RUN = { article: 4543435, version: 5, doi: '10.6084/m9.figshare.4543435.v5' };
const WALK = { article: 5722711, version: 6, doi: '10.6084/m9.figshare.5722711.v6', zip: 'WBDSascii.zip' };
const MARKER_SUBJECTS = 10;
/** The rig's frame (BodyParts3D): z up, the body facing −y. BVH: Y up,
 *  facing +Z, X to the left. */
const toBp = (v) => [v[0], -v[2], v[1]];
/** A sole: the foot bones' vertices this near their lowest (mm); a sole
 *  point on the ground within SLIP_TOL_MM counts as grounded. */
const SOLE_MM = 15, SLIP_TOL_MM = 10;
const G_MM_S2 = 9810;
const CONTACT_N_PER_KG = 0.5;
const FRAMES = 100;

mkdirSync(CACHE, { recursive: true });

// ---- downloads --------------------------------------------------------------
async function cached(name, get) {
  const file = join(CACHE, name);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(await get()));
  return readFileSync(file, 'utf8');
}
/** A fetch that answers (a range's 206 too), the body read whole; retried
 *  on a dropped connection, the last failure thrown. */
async function fetchOk(url, init, tries = 4) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, init);
      if (!r.ok && r.status !== 206) throw new Error(`build-body-gait: ${url} ${r.status}`);
      const body = await r.arrayBuffer();
      return { url: r.url, headers: r.headers, arrayBuffer: async () => body };
    } catch (e) {
      if (k >= tries || String(e.message).startsWith('build-body-gait')) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * k));
    }
  }
}
async function article(a) {
  const meta = JSON.parse(await cached(`figshare-${a.article}-v${a.version}.json`, async () => (await fetchOk(`https://api.figshare.com/v2/articles/${a.article}/versions/${a.version}`)).arrayBuffer()));
  if (meta.license?.name !== 'CC BY 4.0') throw new Error(`build-body-gait: ${a.article} is ${meta.license?.name}, not CC BY 4.0`);
  if (!meta.citation?.includes(a.doi)) throw new Error(`build-body-gait: ${a.article}'s citation lacks its DOI`);
  return meta;
}
/** A file's download link; where a name repeats (the running set has two
 *  RBDSinfo.txt, the later covering all its subjects), the latest upload. */
const fileUrl = (meta, name) => {
  const f = meta.files.filter((x) => x.name === name).sort((a, b) => b.id - a.id)[0];
  if (!f) throw new Error(`build-body-gait: no ${name} in ${meta.id}`);
  return f.download_url;
};

/** A member of a remote zip, read by byte range: the central directory from
 *  the end (read once a zip), then the member's local header and data. The
 *  link is followed afresh for every range: figshare's signed storage links
 *  last seconds. */
const directories = new Map();
async function zipMember(url, name) {
  const range = async (a, b) => new Uint8Array(await (await fetchOk(url, { headers: { Range: `bytes=${a}-${b}` } })).arrayBuffer());
  if (!directories.has(url)) {
    const head = await fetchOk(url, { headers: { Range: 'bytes=0-0' } });
    const size = Number(head.headers.get('content-range').split('/')[1]);
    const tail = await range(Math.max(0, size - 65557), size - 1), dv = new DataView(tail.buffer);
    let e = tail.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('build-body-gait: no zip end record');
    let cdSize = dv.getUint32(e + 12, true), cdAt = dv.getUint32(e + 16, true);
    if (cdAt === 0xffffffff) { // zip64
      const loc = e - 20, z = dv.getUint32(loc + 8, true) + dv.getUint32(loc + 12, true) * 2 ** 32;
      const rec = await range(z, z + 55), rv = new DataView(rec.buffer);
      cdSize = Number(rv.getBigUint64(40, true)); cdAt = Number(rv.getBigUint64(48, true));
    }
    directories.set(url, await range(cdAt, cdAt + cdSize - 1));
  }
  const cd = directories.get(url), cv = new DataView(cd.buffer);
  for (let p = 0; p < cd.length;) {
    const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
    const n = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nl));
    if (n === name) {
      let comp = cv.getUint32(p + 20, true), off = cv.getUint32(p + 42, true);
      const method = cv.getUint16(p + 10, true);
      for (let x = p + 46 + nl; x < p + 46 + nl + xl;) { // zip64 extra
        const id = cv.getUint16(x, true), len = cv.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (cv.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (comp === 0xffffffff) { comp = Number(cv.getBigUint64(q, true)); q += 8; }
          if (off === 0xffffffff) off = Number(cv.getBigUint64(q, true));
        }
        x += 4 + len;
      }
      const lh = await range(off, off + 29), lv = new DataView(lh.buffer);
      const at = off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
      const data = await range(at, at + comp - 1);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`build-body-gait: ${name} compression ${method}`);
      return inflateRawSync(data);
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error(`build-body-gait: no ${name} in the zip`);
}

/** A tab- or comma-separated table: its header and numeric rows. */
function table(text, sep = '\t') {
  const lines = text.trim().split(/\r?\n/), head = lines[0].split(sep).map((s) => s.trim());
  const rows = lines.slice(1).map((l) => l.split(sep).map(Number));
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`build-body-gait: no column ${name}`);
    return rows.map((r) => r[i]);
  };
  return { head, rows, col };
}

// ---- the cycle's duration and the left side's phase, from the heels -----------
/** On a treadmill a heel swings forward and is carried back at the belt's
 *  speed, most of the cycle: the heel strike is its most forward point.
 *  Strides between successive right strikes, the left's lag as a fraction. */
function heelTiming(mkr, heel) {
  const t = mkr.col('Time'), dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  const strikes = (side) => {
    const x = mkr.col(`${heel(side)}X`), v = x.slice(1).map((q, i) => q - x[i]);
    const back = Math.sign([...v].sort((a, b) => a - b)[v.length >> 1]);
    // forward = against the belt; a strike where forward motion turns back
    const fwd = x.map((q) => -back * q), out = [];
    const W = Math.round(0.25 / dt);
    for (let i = W; i < fwd.length - W; i++) {
      let top = true;
      for (let k = i - W; k <= i + W; k++) if (fwd[k] > fwd[i]) { top = false; break; }
      if (top && (!out.length || i - out[out.length - 1] > W)) out.push(i);
    }
    return out.map((i) => i * dt);
  };
  const R = strikes('R'), L = strikes('L');
  const strides = R.slice(1).map((s, i) => s - R[i]);
  const T = strides.sort((a, b) => a - b)[strides.length >> 1];
  const lags = R.slice(0, -1).map((r) => { const l = L.find((q) => q > r); return l === undefined ? NaN : (l - r) / T; }).filter((q) => q > 0 && q < 1);
  return { stride: T, lag: lags.sort((a, b) => a - b)[lags.length >> 1], strides: strides.length };
}
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;

// ---- running ----------------------------------------------------------------
const runMeta = await article(RUN);
const runInfo = table(await cached('RBDSinfo.txt', async () => (await fetchOk(fileUrl(runMeta, 'RBDSinfo.txt'))).arrayBuffer()));
const runSubjects = [...new Set(runMeta.files.map((f) => f.name.match(/^RBDS(\d{3})processed\.txt$/)?.[1]).filter(Boolean))].sort();
const runCurves = [];
for (const s of runSubjects) {
  const p = table(await cached(`RBDS${s}processed.txt`, async () => (await fetchOk(fileUrl(runMeta, `RBDS${s}processed.txt`))).arrayBuffer()));
  runCurves.push({
    R: { hipFlex: p.col('RhipAngZ35'), hipAdd: p.col('RhipAngX35'), knee: p.col('RkneeAngZ35'), ankle: p.col('RankleAngZ35'), grf: p.col('RgrfY35') },
    L: { hipFlex: p.col('LhipAngZ35'), hipAdd: p.col('LhipAngX35'), knee: p.col('LkneeAngZ35'), ankle: p.col('LankleAngZ35'), grf: p.col('LgrfY35') },
  });
}
const runTiming = [];
for (const s of runSubjects.slice(0, MARKER_SUBJECTS)) {
  // the running marker set has three on each heel
  runTiming.push(heelTiming(table(await cached(`RBDS${s}runT35markers.txt`, async () => (await fetchOk(fileUrl(runMeta, `RBDS${s}runT35markers.txt`))).arrayBuffer())), (side) => `${side}.Heel.Bottom`));
}
const runHeight = mean(runSubjects.map((s) => {
  const row = runInfo.rows.find((r) => r[runInfo.head.indexOf('Subject')] === Number(s));
  if (!row) throw new Error(`build-body-gait: RBDSinfo.txt has no subject ${s}`);
  return row[runInfo.head.indexOf('Height')];
}));
console.log(`running: ${runCurves.length} subjects' cycles; stride ${median(runTiming.map((t) => t.stride)).toFixed(3)} s, left at ${median(runTiming.map((t) => t.lag)).toFixed(3)} (${MARKER_SUBJECTS} marker trials)`);

// ---- walking ----------------------------------------------------------------
const walkMeta = await article(WALK);
const walkInfoText = await cached('WBDSinfo.csv', async () => (await fetchOk(fileUrl(walkMeta, 'WBDSinfo.csv'))).arrayBuffer());
const walkRows = walkInfoText.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const walkSubjects = [...new Set(walkRows.filter((r) => /^WBDS\d+walkT05ang\.txt$/.test(r[1])).map((r) => r[1].match(/^WBDS(\d+)/)[1]))].sort();
const zipUrl = fileUrl(walkMeta, WALK.zip);
const member = (n) => cached(n, () => zipMember(zipUrl, `51subjs/${n}`));
const walkCurves = [], walkTiming = [];
for (const s of walkSubjects) {
  const a = table(await member(`WBDS${s}walkT05ang.txt`)), k = table(await member(`WBDS${s}walkT05knt.txt`));
  walkCurves.push({
    R: { hipFlex: a.col('RHipAngleZ'), hipAdd: a.col('RHipAngleX'), knee: a.col('RKneeAngleZ'), ankle: a.col('RAnkleAngleZ'), grf: k.col('RGRFY') },
    L: { hipFlex: a.col('LHipAngleZ'), hipAdd: a.col('LHipAngleX'), knee: a.col('LKneeAngleZ'), ankle: a.col('LAnkleAngleZ'), grf: k.col('LGRFY') },
  });
}
for (const s of walkSubjects.slice(0, MARKER_SUBJECTS)) walkTiming.push(heelTiming(table(await member(`WBDS${s}walkT05mkr.txt`)), (side) => `${side}.Heel`));
const walkOf = (s, i) => walkRows.find((r) => r[1] === `WBDS${s}walkT05mkr.txt`)?.[i];
const walkSpeed = mean(walkSubjects.map((s) => Number(walkOf(s, 11))).filter(Number.isFinite));
const walkHeight = mean(walkSubjects.map((s) => Number(walkOf(s, 4))).filter(Number.isFinite));
console.log(`walking: ${walkCurves.length} subjects' cycles at ${walkSpeed.toFixed(2)} m/s; stride ${median(walkTiming.map((t) => t.stride)).toFixed(3)} s, left at ${median(walkTiming.map((t) => t.lag)).toFixed(3)}`);

// ---- mean cycles, as BVH ----------------------------------------------------
/** The subjects' mean of a curve (101 samples, 0–100%), the left side moved
 *  by its phase so both legs share the right heel's cycle; FRAMES samples. */
function meanCurve(curves, side, key, lag) {
  const out = new Float64Array(FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const pct = (((f / FRAMES) - (side === 'L' ? lag : 0) + 1) % 1) * 100, i = Math.floor(pct), u = pct - i;
    out[f] = mean(curves.map((c) => c[side][key][i] * (1 - u) + c[side][key][Math.min(100, i + 1)] * u));
  }
  return out;
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function motion(name, curves, timing, speed, height) {
  const lag = median(timing.map((t) => t.lag)), stride = median(timing.map((t) => t.stride));
  const m = {};
  for (const side of ['R', 'L']) for (const key of ['hipFlex', 'hipAdd', 'knee', 'ankle', 'grf']) m[`${side}${key}`] = meanCurve(curves, side, key, lag);
  // BVH: Y up, the body facing +Z, X to its left; each leg joint's channels
  // Zrotation Xrotation Yrotation (degrees). Flexion turns about X: the hip's
  // forward (+Z) is −X rotation, the knee's back is +X, the ankle's toes up
  // −X; adduction turns about Z toward the midline.
  const legs = (side, sgn) => ({
    name: `${side === 'L' ? 'Left' : 'Right'}UpLeg`, channels: ['Zrotation', 'Xrotation', 'Yrotation'],
    children: [{
      name: `${side === 'L' ? 'Left' : 'Right'}Leg`, channels: ['Zrotation', 'Xrotation', 'Yrotation'],
      children: [{ name: `${side === 'L' ? 'Left' : 'Right'}Foot`, channels: ['Zrotation', 'Xrotation', 'Yrotation'], children: [] }],
    }],
    frame: (f) => [
      [-sgn * m[`${side}hipAdd`][f], -m[`${side}hipFlex`][f], 0],
      [0, m[`${side}knee`][f], 0],
      [0, -m[`${side}ankle`][f], 0],
    ],
  });
  const L = legs('L', 1), R = legs('R', -1);
  const hierarchy = { name: 'Hips', channels: ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Xrotation', 'Yrotation'], children: [L, R].map(({ frame, ...j }) => j) };
  const angles = Array.from({ length: FRAMES }, (_, f) => [...L.frame(f).flat(), ...R.frame(f).flat()].map(r3));
  const contact = (side) => Array.from(m[`${side}grf`], (g) => (g > CONTACT_N_PER_KG ? 1 : 0));
  const contacts = { left: contact('L'), right: contact('R') };
  // on the H5 rig: the root's rise and fall that keeps the feet in contact on
  // the ground, into the root's Y (up) channel; then how far the feet slip
  const still = parseBvh(writeBvh({ root: hierarchy, frameTime: stride / FRAMES, frames: angles.map((a) => [0, 0, 0, 0, 0, 0, ...a]) }));
  const poses = still.frames.map((_, f) => retargetFrame(still, f, rig, toBp).pose);
  const rise = groundRoot(rig, poses, feet, contacts, stride / FRAMES, 2, ground, G_MM_S2);
  // across the ground, the move that keeps planted sole points planted; the
  // BVH root keeps it less the mean velocity (the cycle loops in place)
  const planted = plantRoot(rig, poses, rise, feet, contacts, stride / FRAMES, 2, ground, SLIP_TOL_MM);
  const frames = angles.map((a, f) => { const o = planted.offsets[f]; return [r3(o[0]), r3(o[2]), r3(-o[1]), 0, 0, 0, ...a]; });
  const bvh = writeBvh({ root: hierarchy, frameTime: stride / FRAMES, frames });
  const played = parseBvh(bvh), roots = played.frames.map((_, f) => retargetFrame(played, f, rig, toBp).root);
  const speedHere = -planted.velocity[1], scaled = (speed * 1000 * bodyHeightMm) / (height * 10);
  // measured on what is written (its frame time and velocity as rounded there), as the digest test measures it
  const slip = footSlip(rig, poses, roots, feet, contacts, played.frameTime, planted.velocity.map(r3), 2, ground, SLIP_TOL_MM);
  console.log(`  ${name} on the rig: rise ${Math.min(...rise).toFixed(1)}…${Math.max(...rise).toFixed(1)} mm; moves at ${(speedHere / 1000).toFixed(2)} m/s (the subjects' speed scaled by height ${(scaled / 1000).toFixed(2)}); the feet slip ${slip.left.toFixed(1)} and ${slip.right.toFixed(1)} mm a cycle`);
  return {
    bvh, slip, speedHere, info: {
      name, subjects: curves.length, speedMps: r3(speed), subjectHeightCm: r3(height), strideS: r3(stride), leftLag: r3(lag),
      markerTrials: timing.length, frames: FRAMES, contact: contacts,
      bodySpeedMps: r3(speedHere / 1000), scaledSpeedMps: r3(scaled / 1000), bodyVelocityMmS: planted.velocity.map(r3), slipMm: { left: r3(slip.left), right: r3(slip.right) },
    },
  };
}
// ---- the H5 rig, its feet and the body's height ----------------------------------
const rigFile = JSON.parse(readFileSync(join(ROOT, 'digests', 'body-rig', 'rig.json'), 'utf8'));
const rig = { segments: rigFile.segments, joints: rigFile.joints };
const bodyDir = join(ROOT, 'digests', 'bodyparts3d-body');
const bodyIx = JSON.parse(readFileSync(join(bodyDir, 'index.json'), 'utf8'));
const byEl = new Map();
for (const s of ['skeletal', 'integumentary']) for (const p of unpackBody(readFileSync(join(bodyDir, bodyIx.systems[s].file))).parts) byEl.set(p.element, p);
const footOf = (side) => {
  const seg = rigFile.segments.indexOf(`${side} foot`);
  const bones = Object.entries(rigFile.bones).filter(([, s]) => s === seg).map(([e]) => byEl.get(e).positions);
  return { seg, points: solePoints(bones, 2, SOLE_MM) };
};
const feet = { left: footOf('left'), right: footOf('right') };
const ground = Math.min(...[feet.left, feet.right].flatMap((f) => [...f.points].filter((_, i) => i % 3 === 2)));
const skin = [...byEl.values()].find((p) => p.name === 'skin');
let skinLo = Infinity, skinHi = -Infinity;
for (let i = 2; i < skin.positions.length; i += 3) { skinLo = Math.min(skinLo, skin.positions[i]); skinHi = Math.max(skinHi, skin.positions[i]); }
const bodyHeightMm = skinHi - skinLo;
console.log(`the body: ${(bodyHeightMm / 10).toFixed(1)} cm tall; soles of ${feet.left.points.length / 3} and ${feet.right.points.length / 3} points`);

const walk = motion('walk', walkCurves, walkTiming, walkSpeed, walkHeight);
const run = motion('run', runCurves, runTiming, 3.5, runHeight);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'walk.bvh'), walk.bvh);
writeFileSync(join(OUT, 'run.bvh'), run.bvh);
writeFileSync(join(OUT, 'gait.json'), JSON.stringify({
  format: 'carys-gait/1', pin: 'gait-motions-1', soleMm: SOLE_MM, slipTolMm: SLIP_TOL_MM,
  method: `per subject the hip, knee and ankle flexion and hip adduction over a gait cycle (ISB axes: Z flexion, X adduction), averaged across subjects; the left side moved by its measured phase; ${FRAMES} frames a cycle; the cycle's duration and the phase from the heels' fore-aft swing in ${MARKER_SUBJECTS} marker trials (median); a foot in contact where its mean vertical ground force exceeds ${CONTACT_N_PER_KG} N/kg. On the H5 rig: the root's rise and fall (its Y channel, mm) sets the lowest sole point of the feet in contact on the ground, a ballistic arc between; across the ground (its X and Z channels, less the mean velocity) the body moves as its grounded sole points slide back, so they stay planted; slip is the largest move across the ground of a sole point (bone vertices within ${SOLE_MM} mm of the sole) while its foot is in contact and it lies within ${SLIP_TOL_MM} mm of the ground`,
  motions: { walk: { file: 'walk.bvh', ...walk.info }, run: { file: 'run.bvh', ...run.info } },
}, null, 1) + '\n');
const cite = (meta, a, entries) => ({
  entry_count: entries, license_spdx: 'CC-BY-4.0', retrieved_date: '2026-09-24', source_url: `https://doi.org/${a.doi}`,
  version_pin: `figshare-${a.article}-v${a.version}`, citation: meta.citation, doi: `https://doi.org/${a.doi}`,
});
writeFileSync(join(OUT, 'SOURCES.json'), JSON.stringify({
  digest: 'gait-motions', format: 'carys-sources/1',
  sources: [cite(walkMeta, WALK, walkCurves.length), cite(runMeta, RUN, runCurves.length)],
}, null, 1) + '\n');
console.log(`digests/gait-motions: walk ${walk.info.strideS} s a stride, run ${run.info.strideS} s`);
