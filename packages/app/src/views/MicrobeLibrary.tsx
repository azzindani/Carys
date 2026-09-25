// H8 microbiology library, in the Learn route: a card per virus family and
// per bacterium (structure, genome, morphology, Gram stain, examples), its
// PDB structures one click away in the Protein route (a capsid in the
// Capsid mode, anything else in the Model mode), its Learn bundles, and
// where its text comes from, with the licence. Education only.
import { useState } from 'react';
import type { JSX } from 'react';
import { MICROBE_CARDS, bundleById, microbeById, type StructureLink } from '@carys/volume-core';
import { EDUCATION_BADGE } from '@carys/study';
import { setStatus } from '../lib/status';
import { Chip, DarkSelect, IconBtn } from '../ui/primitives';

const LICENCE: Record<string, string> = { 'CC-BY-4.0': 'CC BY 4.0', 'CC0-1.0': 'CC0 1.0', MIT: 'MIT' };

export function MicrobeLibrary({ onOpenStructure, onOpenBundle }: {
  onOpenStructure: (link: StructureLink) => void;
  onOpenBundle: (id: string) => void;
}): JSX.Element {
  const [sel, setSel] = useState(MICROBE_CARDS[0]!.id);
  const c = microbeById(sel);
  const group = (kind: 'virus-family' | 'bacterium'): JSX.Element[] =>
    MICROBE_CARDS.filter((x) => x.kind === kind).map((x) => <option key={x.id} value={x.id}>{x.name}</option>);

  return (
    <>
      <div className="dock" id="dock-microbes">
        <div className="grp">
          <span className="lbl">Microbe</span>
          <DarkSelect id="microbe-card" value={sel} ariaLabel="Microbiology card"
            title="Virus families and bacteria: structure, genome, morphology, Gram stain, examples"
            onChange={(v) => {
              if (!microbeById(v)) {
                setStatus(`unknown microbiology card: ${v}`);
                return;
              }
              setSel(v);
            }}>
            <optgroup label="Virus families">{group('virus-family')}</optgroup>
            <optgroup label="Bacteria">{group('bacterium')}</optgroup>
          </DarkSelect>
        </div>
        <div className="grp">
          <Chip><span id="ro-microbe">{c
            ? `${c.kind === 'virus-family' ? 'virus family' : 'bacterium'} · ${c.structures.length} structure${c.structures.length > 1 ? 's' : ''}${c.bundles.length ? ` · ${c.bundles.length} bundle${c.bundles.length > 1 ? 's' : ''}` : ''}`
            : '—'}</span></Chip>
        </div>
      </div>
      {c && (
        <div id="view-microbes" className="panes" data-testid="microbes">
          <div className="pane" id="pane-microbe-card">
            <div className="pane-head"><span className="name"><i>{c.name}</i></span></div>
            <dl className="kv" id="microbe-kv">
              <div className="mrow"><dt>structure</dt><dd>{c.structure}</dd></div>
              <div className="mrow"><dt>genome</dt><dd>{c.genome}</dd></div>
              <div className="mrow"><dt>morphology</dt><dd>{c.morphology}</dd></div>
              <div className="mrow"><dt>Gram stain</dt><dd id="microbe-gram">{c.gram}</dd></div>
              <div className="mrow"><dt>examples</dt><dd>{c.examples.join(' · ')}</dd></div>
            </dl>
            <div className="grp">
              <span className="lbl">Structures</span>
              {c.structures.map((s) => (
                <IconBtn key={`${s.kind}-${s.pdbId}`} title={`Open ${s.pdbId}, ${s.label}, in the Protein view`}
                  onClick={() => onOpenStructure(s)}>
                  <span data-structure={s.pdbId} data-structure-kind={s.kind}>{s.pdbId}{s.kind === 'capsid' ? ' capsid' : ''}</span>
                </IconBtn>
              ))}
            </div>
            {c.bundles.length > 0 && (
              <div className="grp">
                <span className="lbl">Learn</span>
                {c.bundles.map((id) => (
                  <IconBtn key={id} title={`Open the bundle: ${bundleById(id)?.title ?? id}`} onClick={() => onOpenBundle(id)}>
                    <span data-bundle={id}>{bundleById(id)?.title ?? id}</span>
                  </IconBtn>
                ))}
              </div>
            )}
            <div className="hint" id="microbe-src">
              {`Text: ${c.text.source} (${LICENCE[c.text.licence]}). References: ${c.references
                .map((r) => `${r.label}${r.doi ? `, doi:${r.doi}` : ''} (${LICENCE[r.licence]})`).join(' · ')}. ${EDUCATION_BADGE}`}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
