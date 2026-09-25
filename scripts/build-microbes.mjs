// The microbiology library's digest (H8, docs/PHASES.md): the bacterial
// PDB entries the cards link to, vendored as RCSB serves them (CC0), and
// library.json with what the build checked about every card's sources.
//
//   npx tsc -b && node scripts/build-microbes.mjs   → digests/microbe-library/
//
// The cards themselves are volume-core/microbes.ts. For each one the build
// checks that every DOI it was adapted from is CC BY 4.0 at Crossref (the
// licence rule: CC BY or CC0 only), that every PDB entry it cites has that
// first author in its primary citation, and that each bacterial entry's
// source organism is the card's species. Downloads cache in .cache/microbes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { MICROBE_CARDS, cifCategories, cifTokens, microbePdbIds, parseAssemblyCif } from '../packages/volume-core/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'microbes');
const OUT = join(ROOT, 'digests', 'microbe-library');
const CC_BY_4 = /^https?:\/\/creativecommons\.org\/licenses\/by\/4\.0\/?$/;
const TODAY = new Date().toISOString().slice(0, 10);

mkdirSync(CACHE, { recursive: true });

async function fetchOk(url, tries = 4) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`build-microbes: ${url} ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries || String(e.message).startsWith('build-microbes')) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * k));
    }
  }
}
async function cached(name, url) {
  const file = join(CACHE, name);
  if (!existsSync(file)) writeFileSync(file, await fetchOk(url));
  return readFileSync(file);
}
const fail = (why) => { throw new Error(`build-microbes: ${why}`); };

// ---- references: Crossref licences, PDB first authors ------------------------
const references = [];
const seen = new Set();
for (const card of MICROBE_CARDS) {
  for (const ref of card.references) {
    const key = ref.doi ?? ref.pdbId;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.doi) {
      const m = JSON.parse(await cached(`crossref-${ref.doi.replace(/\//g, '_')}.json`, `https://api.crossref.org/works/${ref.doi}`)).message;
      const licences = (m.license ?? []).map((l) => l.URL);
      if (!licences.some((u) => CC_BY_4.test(u))) fail(`${ref.doi} is licensed ${licences.join(', ') || 'nowhere'}, not CC BY 4.0`);
      if (ref.licence !== 'CC-BY-4.0') fail(`${ref.doi} is CC BY 4.0 but the card says ${ref.licence}`);
      const first = m.author?.[0]?.family ?? '';
      if (!ref.label.includes(first)) fail(`${ref.doi}'s first author ${first} is not in "${ref.label}"`);
      references.push({
        doi: ref.doi, title: m.title?.[0] ?? '', firstAuthor: first,
        year: m.issued?.['date-parts']?.[0]?.[0] ?? null, journal: m['container-title']?.[0] ?? '',
        volume: m.volume ?? '', pages: m.page ?? m['article-number'] ?? '', licenceUrl: licences.find((u) => CC_BY_4.test(u)),
      });
    } else if (ref.pdbId) {
      const e = JSON.parse(await cached(`${ref.pdbId}-entry.json`, `https://data.rcsb.org/rest/v1/core/entry/${ref.pdbId}`));
      const first = (e.rcsb_primary_citation?.rcsb_authors?.[0] ?? '').split(',')[0].trim();
      if (!first || !ref.label.includes(first)) fail(`PDB ${ref.pdbId}'s first author ${first || '(none)'} is not in "${ref.label}"`);
      if (ref.licence !== 'CC0-1.0') fail(`PDB ${ref.pdbId} is CC0 but the card says ${ref.licence}`);
      references.push({ pdbId: ref.pdbId, title: e.struct?.title ?? '', firstAuthor: first, year: e.rcsb_primary_citation?.year ?? null });
    } else fail(`a reference of ${card.id} names neither a DOI nor a PDB id`);
  }
}

// ---- the bacterial entries -----------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const structures = [];
for (const pdbId of microbePdbIds()) {
  const card = MICROBE_CARDS.find((c) => c.structures.some((s) => s.kind === 'microbe' && s.pdbId === pdbId));
  const gz = await cached(`${pdbId}.cif.gz`, `https://files.rcsb.org/download/${pdbId}.cif.gz`);
  const text = gunzipSync(gz).toString('utf8');
  const unit = parseAssemblyCif(text);
  if (unit.id !== pdbId) fail(`${pdbId}.cif.gz is entry ${unit.id}`);
  const cats = cifCategories(cifTokens(text), ['entity_src_nat', 'entity_src_gen', 'pdbx_entity_src_syn', 'pdbx_audit_revision_history', 'refine']);
  const organisms = [
    ...cats.get('entity_src_nat').map((r) => r.pdbx_organism_scientific),
    ...cats.get('entity_src_gen').map((r) => r.pdbx_gene_src_scientific_name),
  ].filter((o) => o && o !== '?');
  if (!organisms.some((o) => o.toLowerCase().startsWith(card.name.toLowerCase()))) {
    fail(`${pdbId}'s source organism (${organisms.join(', ') || 'none'}) is not ${card.name}`);
  }
  const revs = cats.get('pdbx_audit_revision_history');
  const rev = revs[revs.length - 1];
  const file = `${pdbId}.cif.gz`;
  writeFileSync(join(OUT, file), gz);
  structures.push({
    pdbId, file, card: card.id,
    sha256: createHash('sha256').update(gz).digest('hex'),
    title: unit.title, organism: organisms[0],
    revision: rev ? `${rev.major_revision}.${rev.minor_revision} (${rev.revision_date})` : '',
    resolutionA: Number(cats.get('refine')[0]?.ls_d_res_high) || null,
    atoms: unit.count, chains: unit.asymIds.filter((_, i) => unit.polymerChain.includes(i)).length,
    citation: references.find((r) => r.pdbId === pdbId)?.firstAuthor ?? '',
  });
  console.log(`${pdbId} ${card.id}: ${unit.title} · ${organisms[0]} · ${unit.count} atoms`);
}

const pin = `PDB-${structures.map((s) => s.pdbId).join('-')}`;
writeFileSync(join(OUT, 'library.json'), `${JSON.stringify({
  format: 'carys-microbes/1', pin,
  attribution: 'Bacterial structures from the Protein Data Bank (PDB archive, CC0 1.0); virus-family cards adapted from ICTV Virus Taxonomy Profiles (CC BY 4.0)',
  cards: MICROBE_CARDS.length, structures, references,
}, null, 1)}\n`);
writeFileSync(join(OUT, 'SOURCES.json'), `${JSON.stringify({
  digest: 'microbe-library', format: 'carys-sources/1',
  sources: [
    ...structures.map((s) => ({ entry_count: 1, license_spdx: 'CC0-1.0', retrieved_date: TODAY, source_url: `https://www.rcsb.org/structure/${s.pdbId}`, version_pin: `PDB-${s.pdbId}${s.revision ? ` rev ${s.revision.split(' ')[0]}` : ''}` })),
    ...references.filter((r) => r.doi).map((r) => ({ entry_count: 1, license_spdx: 'CC-BY-4.0', retrieved_date: TODAY, source_url: `https://doi.org/${r.doi}`, version_pin: `doi:${r.doi}`, citation: `${r.firstAuthor} et al. (${r.year}) ${r.title}. ${r.journal} ${r.volume}${r.pages ? `:${r.pages}` : ''}.` })),
  ],
}, null, 1)}\n`);
console.log(`wrote ${structures.length} structures and ${references.length} checked references (${MICROBE_CARDS.length} cards) to ${OUT}`);
