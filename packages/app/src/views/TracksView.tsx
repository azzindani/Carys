import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { inferFileFormat, parseBed, parseCodonMap, parseGff, parseVcfDepth, translateGtfCds, variantToResidue, type CodonEntry, type TranscriptMap, type VariantDepth } from '@carys/io';
import { audit } from '@carys/study';
import {
  bpPerPixel, knownTrackTypes, lociOverlap, locusString, parseLocusString,
  preprocessTrackConfig, registerTrackClass, type Locus,
} from '@carys/volume-core';
import { queueResidueLink } from '../lib/linkBus';
import { setStatus } from '../lib/status';
import { toast } from '../lib/toasts';
import { Chip, DarkSelect, IconBtn } from '../ui/primitives';

interface Row { chr: string; start: number; end: number; label: string; pos?: number }

const MAX_ROWS = 100;

export function TracksView(): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [locusText, setLocusText] = useState('');
  const [locus, setLocus] = useState<Locus | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  // Codon map: caller-supplied genomic→residue bridge (no backend
  // alignment). Null = none uploaded; variant rows show residue chips only
  // when a map is present. A new VCF keeps the map (same assembly); a new
  // map relinks the open rows.
  const [codonMap, setCodonMap] = useState<CodonEntry[] | null>(null);
  const [mapName, setMapName] = useState('');
  const [mapOrdinal, setMapOrdinal] = useState(false);
  const [depths, setDepths] = useState<VariantDepth[]>([]);
  // G1 transcripts: GTF CDS translation (GTF CDS rows → per-transcript
  // codon maps) so variant↔residue links need no caller-supplied map.
  // Empty = none uploaded; picked transcript becomes the codon map
  // (chain = transcript_id, resSeq = transcript-codon ordinal 1-based).
  const [transcripts, setTranscripts] = useState<TranscriptMap[]>([]);
  const [txName, setTxName] = useState('');
  const [txId, setTxId] = useState('');
  const [txPartial, setTxPartial] = useState('');
  const [txPartials, setTxPartials] = useState<Record<string, number>>({});
  useEffect(() => {
    registerTrackClass('annotation', 'bed');
    registerTrackClass('annotation', 'gff');
    setClasses(knownTrackTypes());
  }, []);

  const openFile = (text: string, label: string): void => {
    try {
      const fmt = inferFileFormat(label);
      let parsed: Row[];
      if (fmt === 'bed') {
        parsed = parseBed(text).map((f) => ({ chr: f.chr, start: f.start, end: f.end, label: f.name ?? '.' }));
      } else if (fmt === 'gff') {
        // GFF is 1-based inclusive: normalize to 0-based half-open like BED.
        parsed = parseGff(text).map((f) => ({ chr: f.seqid, start: f.start - 1, end: f.end, label: `${f.type} ${f.attributes['ID'] ?? ''}`.trim() }));
      } else if (fmt === 'vcf') {
        // VCF: 1-based point variants → 1bp rows; label carries REF>ALT +
        // depth (unknown depth prints ?, never 0). Depths retained for the
        // residue link (pos rides the row for the codon-map lookup).
        const vs = parseVcfDepth(text);
        setDepths(vs);
        parsed = vs.map((v) => ({
          chr: v.chrom, start: v.pos - 1, end: v.pos, pos: v.pos,
          label: `${v.ref}>${v.alt}${v.depth !== null ? ` DP${v.depth}${v.altFrac !== null ? ` ${(v.altFrac * 100).toFixed(0)}%` : ''}` : ' DP?'}`,
        }));
      } else {
        setStatus(`tracks: .bed/.gff/.vcf only (got ${label})`);
        return;
      }
      if (fmt !== 'vcf') setDepths([]);
      const cfg = preprocessTrackConfig({ type: 'annotation', name: label, format: fmt });
      setRows(parsed);
      setName(cfg.name);
      if (parsed.length > 0) {
        // Open on everything the file has on its first chromosome. The locus
        // used to be the first feature's own extent, so a freshly loaded
        // file listed one feature and hid the rest ("2 features · 1 in locus").
        const first = parsed[0]!;
        const same = parsed.filter((r) => r.chr === first.chr);
        const loc: Locus = {
          chr: first.chr,
          start: Math.min(...same.map((r) => r.start)),
          end: Math.max(...same.map((r) => r.end)),
        };
        setLocus(loc);
        setLocusText(locusString(loc));
      } else {
        setLocus(null);
        setLocusText('');
      }
      toast(`Tracks: ${parsed.length} features from ${label}`);
    } catch (err) {
      setStatus(`tracks load failed: ${(err as Error).message}`, 'error');
    }
  };

  const applyLocus = (): void => {
    const loc = parseLocusString(locusText);
    if (!loc) { setStatus(`bad locus (want chr:start-end, got "${locusText}")`); return; }
    setLocus(loc);
  };

  const openCodonMap = (text: string, label: string): void => {
    try {
      const map = parseCodonMap(text);
      setCodonMap(map);
      setMapName(label);
      setMapOrdinal(false);
      toast(`Codon map: ${map.length} interval(s) from ${label}`);
      setStatus(`codon map ${label}: ${map.length} interval(s) — variant rows now link to residues`);
    } catch (err) {
      setStatus(`codon map rejected: ${(err as Error).message}`, 'error');
    }
  };

  /** G1: upload a GTF, translate its CDS rows into per-transcript codon
   *  maps, pick the first transcript (picker re-picks). The active map is
   *  the transcript's entries; chips read transcript-ordinal residues. */
  const openGtf = (text: string, label: string): void => {
    try {
      const { transcripts: tx, partialCodons } = translateGtfCds(text);
      if (tx.length === 0) {
        setStatus(`gtf ${label}: no CDS rows — nothing to translate`);
        return;
      }
      setTranscripts(tx);
      setTxName(label);
      const first = tx[0]!;
      setTxId(first.transcriptId);
      setCodonMap(first.entries);
      setMapName(label);
      setMapOrdinal(true);
      const part = partialCodons.find((p) => p.transcriptId === first.transcriptId);
      setTxPartial(part ? ` · +${part.leftoverBp}bp untranslated` : '');
      setTxPartials(Object.fromEntries(partialCodons.map((p) => [p.transcriptId, p.leftoverBp])));
      audit('seg.import', 'tracks', `GTF CDS ${label}: ${tx.length} transcript(s), picked ${first.transcriptId} (${first.entries.length} codons)`);
      toast(`GTF: ${tx.length} transcript(s) from ${label} — picked ${first.transcriptId}`);
      setStatus(`gtf ${label}: ${tx.length} transcript(s) — ${first.transcriptId} active (${first.entries.length} codons, transcript-ordinal residues)`);
    } catch (err) {
      setStatus(`gtf rejected: ${(err as Error).message}`, 'error');
    }
  };

  /** G1: transcript picker — swap the active map to the chosen
   *  transcript's entries (relinks the open rows; audit carries the key). */
  const pickTranscript = (tid: string): void => {
    const t = transcripts.find((x) => x.transcriptId === tid);
    if (!t) { setStatus(`unknown transcript ${tid}`); return; }
    setTxId(tid);
    setCodonMap(t.entries);
    setMapName(txName);
    setMapOrdinal(true);
    const left = txPartials[tid];
    setTxPartial(left ? ` · +${left}bp untranslated` : '');
    audit('seg.import', 'tracks', `GTF transcript ${tid} (${t.entries.length} codons${t.geneId ? `, gene ${t.geneId}` : ''})`);
    setStatus(`transcript ${tid}: ${t.entries.length} codons — variant rows relinked (transcript-ordinal)`);
  };

  /** Variant row → protein: resolve through the codon map, queue the jump,
   *  and hand off to the protein view (hash route; the view consumes the
   *  queued link). Unmapped rows announce the miss loudly, never silently. */
  const jumpToResidue = (row: Row): void => {
    if (!codonMap) {
      setStatus('upload a codon-map JSON first — variants have no residue targets without one');
      return;
    }
    if (row.pos === undefined) {
      setStatus('only VCF variant rows link to residues');
      return;
    }
    let target: { chain: string; resSeq: number } | null = null;
    try {
      target = variantToResidue(codonMap, row.chr, row.pos);
    } catch (err) {
      setStatus(`residue link failed: ${(err as Error).message}`, 'error');
      return;
    }
    if (!target) {
      setStatus(`no residue for ${row.chr}:${row.pos} — outside the codon map intervals`);
      return;
    }
    const depth = depths.find((d) => d.chrom === row.chr && d.pos === row.pos);
    const ctx = depth ? ` ${depth.ref}>${depth.alt}${depth.depth !== null ? ` DP${depth.depth}` : ''}` : '';
    queueResidueLink({ chain: target.chain, resSeq: target.resSeq, label: `${row.chr}:${row.pos}${ctx}` });
    window.location.hash = '#/protein';
    toast(`Variant ${row.chr}:${row.pos} → ${target.chain}:${target.resSeq}`);
  };

  const inLocus = locus ? rows.filter((r) => lociOverlap(locus, r)) : rows;
  const bpp = locus ? bpPerPixel(locus, 640) : 0;
  const residueOf = (row: Row): { chain: string; resSeq: number } | null => {
    if (!codonMap || row.pos === undefined) return null;
    try {
      return variantToResidue(codonMap, row.chr, row.pos);
    } catch {
      return null;
    }
  };

  return (
    <>
      <div className="view-title" id="title-tracks">
        <h1>Tracks</h1>
        <p>{name || 'load a .bed/.gff/.vcf — feature table filtered by locus (igv.js parsers + reference-frame math)'}</p>
      </div>
      <div className="dock" id="dock-tracks">
        <div className="grp">
          <label className="iconbtn" htmlFor="track-upload" title="Open a .bed/.gff/.gff3/.vcf file">Open track</label>
          <input
            type="file" id="track-upload" accept=".bed,.gff,.gff3,.gtf,.vcf" hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void f.text().then((t) => openFile(t, f.name));
            }}
          />
        </div>
        <div className="sep" />
        <div className="grp">
          <span className="lbl">Locus</span>
          <input id="locus" className="urlinput" value={locusText} placeholder="chr1:1000-2000"
            aria-label="Genomic locus" title="chr:start-end (1-based, commas ok)"
            onChange={(e) => setLocusText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLocus(); }} />
          <IconBtn title="Filter features to this locus" onClick={applyLocus}>Go</IconBtn>
        </div>
        <div className="sep" />
        <div className="grp">
          <label className="iconbtn" htmlFor="codon-upload" title="Open a codon-map JSON (genomic intervals → chain+residue)">Codon map</label>
          <input
            type="file" id="codon-upload" accept=".json,application/json" hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void f.text().then((t) => openCodonMap(t, f.name));
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </div>
        <div className="grp">
          <label className="iconbtn" htmlFor="gtf-upload" title="Open a GTF (CDS rows → per-transcript codon maps)">GTF CDS</label>
          <input
            type="file" id="gtf-upload" accept=".gtf,.gff,.gff3" hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void f.text().then((t) => openGtf(t, f.name));
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </div>
        {mapName && (
          <div className="grp">
            <Chip title={mapOrdinal ? 'Transcript-ordinal residues: codon 1 = first translated codon' : 'Active codon map'}>
              <span id="ro-codonmap">{mapOrdinal ? `${txId} · ` : ''}{mapName} · {codonMap?.length ?? 0} intervals{mapOrdinal ? ' · transcript-ordinal' : ''}{txPartial}</span>
            </Chip>
          </div>
        )}
        {transcripts.length > 0 && (
          <div className="grp">
            <DarkSelect value={txId} title="Translated transcript (CDS → codons)" ariaLabel="Transcript"
              onChange={pickTranscript}>
              {transcripts.map((t) => (
                <option key={t.transcriptId} value={t.transcriptId}>
                  {t.transcriptId} · {t.entries.length} codons{t.geneId ? ` · ${t.geneId}` : ''}
                </option>
              ))}
            </DarkSelect>
          </div>
        )}
        <div className="sep" />
        <div className="grp">
          <Chip><span id="ro-tracks">{rows.length} features · {inLocus.length} in locus{bpp > 0 ? ` · ${bpp.toFixed(1)} bp/px` : ''}</span></Chip>
        </div>
        <div className="sep" />
        <div className="grp">
          <Chip><span id="ro-tracktypes" title="Registered track classes">{classes.length > 0 ? classes.join(', ') : '—'}</span></Chip>
        </div>
      </div>
      <div id="view-tracks" className="panes" data-testid="tracks">
        <div className="pane" id="pane-tracks">
          <div className="pane-head"><span className="name">Features</span></div>
          <div className="stage">
            {inLocus.length === 0 && <p className="hint">No features loaded.</p>}
            <dl className="kv" id="track-list">
              {inLocus.length === 0 ? null : inLocus.slice(0, MAX_ROWS).map((r, i) => {
                const target = residueOf(r);
                return (
                  <div className="mrow" key={i} data-chr={r.chr}>
                    <dt>{r.chr}:{r.start}–{r.end}</dt>
                    <dd>
                      {r.label}
                      {target && (
                        <button
                          className="reslink" data-res={`${target.chain}:${target.resSeq}`}
                          title={`Show ${target.chain} residue ${target.resSeq} in the protein view`}
                          onClick={() => jumpToResidue(r)}
                        >
                          → {target.chain}:{target.resSeq}
                        </button>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {inLocus.length > MAX_ROWS && <div className="hint">…{inLocus.length - MAX_ROWS} more</div>}
          </div>
        </div>
      </div>
    </>
  );
}
