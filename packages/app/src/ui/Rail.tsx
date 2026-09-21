import type { JSX } from 'react';
import type { Route } from '../lib/router';
import { Tip } from './primitives';
import {
  IconAtlas, IconCells, IconLearn, IconProtein, IconReport,
  IconStudies, IconTracks, IconViewer,
} from './Icons';

/** The eight destinations, in workflow order: find a study, read it, write
 *  it up, then the specialised viewers. One list, used by the desktop rail
 *  and the mobile nav sheet alike — no second copy to drift (§4). */
export const ROUTES: { id: Route; label: string; short: string; hint: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'worklist', label: 'Studies', short: 'Studies', hint: 'Study worklist', icon: IconStudies },
  { id: 'viewer', label: 'Viewer', short: 'Viewer', hint: 'MPR + 3D viewports', icon: IconViewer },
  { id: 'report', label: 'Report', short: 'Report', hint: 'Validation + report for the open series', icon: IconReport },
  { id: 'protein', label: 'Protein', short: 'Protein', hint: 'Protein structure + sequence view', icon: IconProtein },
  { id: 'cells', label: 'Cells', short: 'Cells', hint: 'OME-Zarr channels + stats', icon: IconCells },
  { id: 'tracks', label: 'Tracks', short: 'Tracks', hint: 'Genome tracks + locus filter', icon: IconTracks },
  { id: 'atlas', label: 'Atlas', short: 'Atlas', hint: 'Anatomy atlas (BodyParts3D long bones, education overlay)', icon: IconAtlas },
  { id: 'learn', label: 'Learn', short: 'Learn', hint: 'Mechanism-of-disease bundles (teaching)', icon: IconLearn },
];

/** Desktop/tablet navigation rail. Icon-first with a label under each glyph,
 *  collapsing to icons alone as the viewport narrows. */
export function Rail({ route, go }: { route: Route; go: (r: Route) => void }): JSX.Element {
  return (
    <nav className="rail" aria-label="Main">
      <button className="rail-mark" onClick={() => go('viewer')} title="Carys" aria-label="Carys — go to viewer">
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ stroke: 'var(--color-on-accent)' }}>
          <rect x="1" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="1" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="1" y="8" width="5" height="5" rx="1.2" strokeWidth="1.5" />
          <rect x="8" y="8" width="5" height="5" rx="2.5" style={{ fill: 'var(--color-on-accent)' }} stroke="none" />
        </svg>
      </button>
      {ROUTES.map(({ id, label, short, hint, icon: Icon }) => (
        <Tip key={id} label={hint}>
          <button
            className="rail-btn" onClick={() => go(id)} title={hint}
            aria-current={route === id ? 'page' : undefined} aria-label={label}
          >
            <Icon />
            <span className="rl">{short}</span>
          </button>
        </Tip>
      ))}
      <span className="rail-spacer" />
    </nav>
  );
}
