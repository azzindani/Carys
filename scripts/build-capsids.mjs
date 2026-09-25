// The virus capsid digest (H7, docs/PHASES.md): seven icosahedral capsids
// from the Protein Data Bank (CC0 1.0), each vendored as RCSB serves its
// asymmetric unit (NAME.cif.gz, byte for byte), plus capsids.json with what
// the tests hold the expansion to.
//
//   npx tsc -b && node scripts/build-capsids.mjs   → digests/rcsb-capsids/
//
// For every entry the build expands assembly 1 with volume-core's
// expansion and checks it against RCSB twice: the atom count against the
// data API's rcsb_assembly_info.atom_count, and every atom of every copy
// against RCSB's own expanded file (NAME-assembly1.cif.gz, chains named
// "A", "A-2", …), the largest deviation recorded and held under
// MAX_DEVIATION_A. The first and last atom of each copy in RCSB's file go
// into capsids.json, so the unit tests can hold every copy to RCSB without
// the 5–60 MB assembly files. Downloads cache in .cache/capsids.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';
import {
  assemblyCopies, beadsOf, cifCategories, cifTokens, expandPoints, parseAssemblyCif,
} from '../packages/volume-core/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'capsids');
const OUT = join(ROOT, 'digests', 'rcsb-capsids');
const ASSEMBLY = '1';
const MAX_DEVIATION_A = 0.01;

/** The capsids, largest first. name and lattice are written here (the
 *  triangulation number from the chain count: 60·T subunits, picornavirus
 *  VP1–VP3 as a pseudo T=3); everything else is read from the entry. */
const ENTRIES = [
  { key: 'sv40', pdbId: '1SVA', name: 'SV40 (simian virus 40)', lattice: 'T=7d' },
  { key: 'norwalk', pdbId: '1IHM', name: 'Norwalk virus (norovirus)', lattice: 'T=3' },
  { key: 'polio', pdbId: '2PLV', name: 'Poliovirus type 1', lattice: 'pseudo T=3' },
  { key: 'rhino', pdbId: '4RHV', name: 'Human rhinovirus 14', lattice: 'pseudo T=3' },
  { key: 'hbv', pdbId: '1QGT', name: 'Hepatitis B virus core', lattice: 'T=4' },
  { key: 'ms2', pdbId: '2MS2', name: 'Bacteriophage MS2', lattice: 'T=3' },
  { key: 'spmv', pdbId: '1STM', name: 'Satellite panicum mosaic virus', lattice: 'T=1' },
];

mkdirSync(CACHE, { recursive: true });

/** A fetch that answers, retried on a dropped connection. */
async function fetchOk(url, tries = 4) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`build-capsids: ${url} ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries || String(e.message).startsWith('build-capsids')) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * k));
    }
  }
}
async function cached(name, url) {
  const file = join(CACHE, name);
  if (!existsSync(file)) writeFileSync(file, await fetchOk(url));
  return file;
}

/** Whitespace tokens of one CIF row, quotes kept together. */
const rowTokens = (line) => (line.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((t) => (/^['"]/.test(t) ? t.slice(1, -1) : t));

/** RCSB's expanded assembly: coordinates per chain name, in file order. */
async function rcsbAssembly(file) {
  const tags = [];
  const chains = new Map();
  let rows = 0;
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.startsWith('_atom_site.')) { tags.push(line.trim()); continue; }
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const t = rowTokens(line);
    if (t.length !== tags.length) throw new Error(`build-capsids: ${file} row ${rows} has ${t.length} of ${tags.length} values`);
    const col = (tag) => t[tags.indexOf(`_atom_site.${tag}`)];
    const label = col('label_asym_id');
    let list = chains.get(label);
    if (!list) chains.set(label, (list = []));
    list.push(Number(col('Cartn_x')), Number(col('Cartn_y')), Number(col('Cartn_z')));
    rows++;
  }
  return { rows, chains };
}

const first = (rows) => rows[0] ?? {};

/** "Stehle, T. et al. (1996) Structure 4, 165. doi:…" from the primary citation. */
function citationOf(cats) {
  const c = cats.get('citation').find((r) => r.id === 'primary');
  if (!c) throw new Error('build-capsids: no primary citation');
  const authors = cats.get('citation_author').filter((a) => a.citation_id === 'primary')
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  const who = authors.length === 0 ? '' : `${authors[0].name}${authors.length > 1 ? ' et al.' : ''} `;
  const known = (v) => v && v !== '?' && v !== '.';
  const doi = known(c.pdbx_database_id_DOI) ? ` doi:${c.pdbx_database_id_DOI}` : '';
  const where = [c.journal_abbrev, c.journal_volume].filter(known).join(' ');
  const title = c.title.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return `${who}(${c.year}) ${title}. ${where}${known(c.page_first) ? `, ${c.page_first}` : ''}.${doi}`;
}

const entries = [];
const sources = [];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const e of ENTRIES) {
  const t0 = Date.now();
  const gz = readFileSync(await cached(`${e.pdbId}.cif.gz`, `https://files.rcsb.org/download/${e.pdbId}.cif.gz`));
  const text = gunzipSync(gz).toString('utf8');
  const info = JSON.parse(readFileSync(await cached(`${e.pdbId}-assembly${ASSEMBLY}.json`, `https://data.rcsb.org/rest/v1/core/assembly/${e.pdbId}/${ASSEMBLY}`), 'utf8'));
  const rcsbAtomCount = info.rcsb_assembly_info?.atom_count;
  if (!Number.isInteger(rcsbAtomCount)) throw new Error(`build-capsids: ${e.pdbId} has no rcsb_assembly_info.atom_count`);

  const unit = parseAssemblyCif(text);
  if (unit.id !== e.pdbId) throw new Error(`build-capsids: ${e.pdbId}.cif.gz is entry ${unit.id}`);
  const def = unit.assemblies.find((a) => a.id === ASSEMBLY);
  if (!def) throw new Error(`build-capsids: ${e.pdbId} has no assembly ${ASSEMBLY}`);
  const copies = assemblyCopies(def, unit.asymIds, unit.operators);
  const atoms = expandPoints(unit, copies);
  if (atoms.count !== rcsbAtomCount) throw new Error(`build-capsids: ${e.pdbId} expands to ${atoms.count} atoms, RCSB says ${rcsbAtomCount}`);

  // every atom of every copy against RCSB's own expansion
  const rcsb = await rcsbAssembly(await cached(`${e.pdbId}-assembly${ASSEMBLY}.cif.gz`, `https://files.rcsb.org/download/${e.pdbId}-assembly${ASSEMBLY}.cif.gz`));
  if (rcsb.rows !== atoms.count) throw new Error(`build-capsids: RCSB's ${e.pdbId} assembly file has ${rcsb.rows} atoms, the expansion ${atoms.count}`);
  let maxDev = 0, k = 0;
  const refs = [];
  copies.forEach((c, ci) => {
    const theirs = rcsb.chains.get(c.label);
    if (!theirs) throw new Error(`build-capsids: RCSB's ${e.pdbId} assembly has no chain ${c.label}`);
    const start = k;
    while (k < atoms.count && atoms.copy[k] === ci) k++;
    if (theirs.length !== (k - start) * 3) throw new Error(`build-capsids: ${e.pdbId} ${c.label} has ${theirs.length / 3} atoms at RCSB, ${k - start} here`);
    for (let a = start; a < k; a++) {
      const j = (a - start) * 3;
      const d = Math.hypot(atoms.x[a] - theirs[j], atoms.y[a] - theirs[j + 1], atoms.z[a] - theirs[j + 2]);
      if (d > maxDev) maxDev = d;
    }
    refs.push([c.label, ...theirs.slice(0, 3), ...theirs.slice(-3)]);
  });
  if (!(maxDev < MAX_DEVIATION_A)) throw new Error(`build-capsids: ${e.pdbId} deviates ${maxDev} Å from RCSB's assembly`);

  const residues = expandPoints(beadsOf(unit, unit.residue), copies).count;
  const chains = expandPoints(beadsOf(unit, unit.polymerChain), copies).count;
  const cats = cifCategories(cifTokens(text), [
    'citation', 'citation_author', 'refine', 'reflns', 'em_3d_reconstruction',
    'entity_src_nat', 'entity_src_gen', 'pdbx_audit_revision_history',
  ]);
  const organism = first(cats.get('entity_src_nat')).pdbx_organism_scientific
    ?? first(cats.get('entity_src_gen')).pdbx_gene_src_scientific_name ?? '';
  const res = Number(first(cats.get('refine')).ls_d_res_high ?? first(cats.get('reflns')).d_resolution_high
    ?? first(cats.get('em_3d_reconstruction')).resolution);
  const revs = cats.get('pdbx_audit_revision_history');
  const rev = revs[revs.length - 1];
  const revision = rev ? `${rev.major_revision}.${rev.minor_revision} (${rev.revision_date})` : '';
  const file = `${e.pdbId}.cif.gz`;
  writeFileSync(join(OUT, file), gz);
  entries.push({
    key: e.key, pdbId: e.pdbId, file,
    sha256: createHash('sha256').update(gz).digest('hex'),
    name: e.name, organism: organism === '?' ? '' : organism, lattice: e.lattice,
    title: unit.title, revision,
    resolutionA: Number.isFinite(res) ? res : null,
    citation: citationOf(cats),
    assemblyId: ASSEMBLY, assemblyDetails: def.details,
    rcsbAtomCount, asuAtoms: unit.count, operators: copies.length / def.gens.reduce((n, g) => n + g.asyms.length, 0),
    atoms: atoms.count, residues, chains, copies: copies.length,
    maxDeviationA: Number(maxDev.toFixed(6)),
    refs,
  });
  sources.push({
    entry_count: 1, license_spdx: 'CC0-1.0', retrieved_date: new Date().toISOString().slice(0, 10),
    source_url: `https://www.rcsb.org/structure/${e.pdbId}`,
    version_pin: `PDB-${e.pdbId}${revision ? ` rev ${revision.split(' ')[0]}` : ''}`,
    citation: entries.at(-1).citation,
  });
  console.log(`${e.pdbId} ${e.key}: ${atoms.count} atoms (RCSB ${rcsbAtomCount}), ${residues} residues, ${chains} chains, ${copies.length} copies, max deviation ${maxDev.toFixed(4)} Å, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

writeFileSync(join(OUT, 'capsids.json'), `${JSON.stringify({
  format: 'carys-capsids/1',
  pin: `PDB-${ENTRIES.map((e) => e.pdbId).join('-')}`,
  attribution: 'Structures from the Protein Data Bank (PDB archive, CC0 1.0), assemblies expanded by Carys',
  maxDeviationA: MAX_DEVIATION_A,
  entries,
})}\n`);
writeFileSync(join(OUT, 'SOURCES.json'), `${JSON.stringify({ digest: 'rcsb-capsids', format: 'carys-sources/1', sources }, null, 1)}\n`);
console.log(`wrote ${entries.length} capsids to ${OUT}`);
